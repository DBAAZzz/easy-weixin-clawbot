import { Prisma } from "@prisma/client";
import {
  TraceQueue,
  buildFlags,
  defaultSamplingConfig,
  llmRoundsPerRequest,
  llmTokensInput,
  llmTokensOutput,
  registry,
  requestDurationMs,
  requestTotal,
  shouldPersistTrace,
  toolCallsTotal,
  toolLatencyMs,
  type SpanData,
  type TraceQueueItem,
  type TraceSummary,
  type TraceWriter,
} from "@clawbot/observability";
import type {
  ObservabilityOverview,
  ObservabilitySpanAttributeValue,
  ObservabilityTraceDetail,
  ObservabilityTraceSpan,
  ObservabilityTraceSummary,
  ObservabilityWindow,
  PaginatedResponse,
} from "@clawbot/shared";
import { getPrisma } from "../db/prisma.js";

const RESERVED_SPAN_ATTRIBUTE_KEYS = new Set([
  "toolName",
  "model",
  "inputTokens",
  "outputTokens",
  "stopReason",
  "error",
  "promptSnapshot",
  "completionSnapshot",
]);

interface PersistedSpanPayload {
  prompt?: string;
  completion?: string;
  attributes?: Record<string, ObservabilitySpanAttributeValue>;
}

export interface ListTraceQuery {
  window: ObservabilityWindow;
  limit: number;
  cursor?: number;
  accountId?: string;
  conversationId?: string;
  flag?: string;
  status?: "ok" | "error";
  query?: string;
}

export interface ObservabilityRouteService {
  getOverview(window: ObservabilityWindow): Promise<ObservabilityOverview>;
  listTraces(query: ListTraceQuery): Promise<PaginatedResponse<ObservabilityTraceSummary>>;
  getTrace(traceId: string): Promise<ObservabilityTraceDetail | null>;
  getMetricsText(): string;
}

export interface SamplingSettingsConsumer {
  setSamplingNormalRate(normalRate: number): void;
}

export interface ObservabilityService extends ObservabilityRouteService {
  queuePersistTrace(summary: TraceSummary, spans: SpanData[]): void;
  flush(): Promise<void>;
  getPendingWriteCount(): number;
  cleanupExpired(now?: Date): Promise<void>;
  getSamplingNormalRate(): number;
  setSamplingNormalRate(normalRate: number): void;
}

const WINDOW_MS: Record<ObservabilityWindow, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

const NORMAL_TRACE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FLAGGED_TRACE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

function getWindowStart(window: ObservabilityWindow): Date {
  return new Date(Date.now() - WINDOW_MS[window]);
}

function parseFlags(flags: string): string[] {
  return flags
    .split(",")
    .map((flag) => flag.trim())
    .filter(Boolean);
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[index] ?? sorted[sorted.length - 1] ?? 0;
}

function roundTo(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function estimateUsd(inputTokens: number, outputTokens: number): number {
  const inputRate = Number.parseFloat(process.env.LLM_COST_INPUT_PER_1K ?? "0");
  const outputRate = Number.parseFloat(process.env.LLM_COST_OUTPUT_PER_1K ?? "0");
  return roundTo((inputTokens / 1000) * inputRate + (outputTokens / 1000) * outputRate, 4);
}

function toTraceSummary(row: {
  id: bigint;
  traceId: string;
  accountId: string;
  conversationId: string;
  totalMs: number;
  llmRounds: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  error: string | null;
  flags: string;
  sampled: boolean;
  createdAt: Date;
}): ObservabilityTraceSummary {
  return {
    id: Number(row.id),
    trace_id: row.traceId,
    account_id: row.accountId,
    conversation_id: row.conversationId,
    total_ms: row.totalMs,
    llm_rounds: row.llmRounds,
    tool_calls: row.toolCalls,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    stop_reason: row.stopReason,
    error: row.error,
    flags: parseFlags(row.flags),
    sampled: row.sampled,
    created_at: row.createdAt.toISOString(),
  };
}

function toTraceSpan(row: {
  id: bigint;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  name: string;
  startTime: Date;
  durationMs: number;
  status: string;
  toolName: string | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  stopReason: string | null;
  errorMessage: string | null;
  payload: string | null;
}): ObservabilityTraceSpan {
  let payload: ObservabilityTraceSpan["payload"] = null;
  let attributes: ObservabilityTraceSpan["attributes"] = {};
  if (row.payload) {
    try {
      const parsed = JSON.parse(row.payload) as PersistedSpanPayload;
      payload = {
        prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
        completion: typeof parsed.completion === "string" ? parsed.completion : "",
      };
      attributes =
        parsed.attributes && typeof parsed.attributes === "object"
          ? Object.fromEntries(
              Object.entries(parsed.attributes).filter(
                ([, value]) =>
                  typeof value === "string" ||
                  typeof value === "number" ||
                  typeof value === "boolean",
              ),
            )
          : {};

      if (!payload.prompt && !payload.completion) {
        payload = null;
      }
    } catch {
      payload = {
        prompt: "",
        completion: row.payload,
      };
    }
  }

  return {
    id: Number(row.id),
    trace_id: row.traceId,
    span_id: row.spanId,
    parent_span_id: row.parentSpanId,
    name: row.name,
    start_time: row.startTime.toISOString(),
    duration_ms: row.durationMs,
    status: row.status === "error" ? "error" : "ok",
    tool_name: row.toolName,
    model: row.model,
    input_tokens: row.inputTokens,
    output_tokens: row.outputTokens,
    stop_reason: row.stopReason,
    error_message: row.errorMessage,
    attributes,
    payload,
  };
}

function extractCustomAttributes(
  attributes: SpanData["attributes"],
): Record<string, ObservabilitySpanAttributeValue> {
  return Object.fromEntries(
    Object.entries(attributes).filter(
      ([key, value]) =>
        !RESERVED_SPAN_ATTRIBUTE_KEYS.has(key) &&
        (typeof value === "string" ||
          typeof value === "number" ||
          typeof value === "boolean"),
    ),
  );
}

function serializeSpanPayload(attributes: SpanData["attributes"]): string | null {
  const payload: PersistedSpanPayload = {};

  if (typeof attributes.promptSnapshot === "string") {
    payload.prompt = attributes.promptSnapshot;
  }

  if (typeof attributes.completionSnapshot === "string") {
    payload.completion = attributes.completionSnapshot;
  }

  const customAttributes = extractCustomAttributes(attributes);
  if (Object.keys(customAttributes).length > 0) {
    payload.attributes = customAttributes;
  }

  return Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
}

function buildTraceWhere(query: ListTraceQuery): Prisma.TraceWhereInput {
  const since = getWindowStart(query.window);
  const search = query.query?.trim();

  return {
    createdAt: { gte: since },
    ...(query.cursor ? { id: { lt: BigInt(query.cursor) } } : {}),
    ...(query.accountId ? { accountId: query.accountId } : {}),
    ...(query.conversationId ? { conversationId: query.conversationId } : {}),
    ...(query.flag ? { flags: { contains: query.flag } } : {}),
    ...(query.status === "error"
      ? {
          OR: [{ error: { not: null } }, { flags: { contains: "error" } }],
        }
      : {}),
    ...(query.status === "ok"
      ? {
          AND: [{ error: null }, { NOT: { flags: { contains: "error" } } }],
        }
      : {}),
    ...(search
      ? {
          OR: [
            { traceId: { contains: search } },
            { accountId: { contains: search } },
            { conversationId: { contains: search } },
          ],
        }
      : {}),
  };
}

class PrismaTraceWriter implements TraceWriter {
  async writeTraces(items: TraceQueueItem[]): Promise<void> {
    if (items.length === 0) return;

    await getPrisma().trace.createMany({
      data: items.map((item) => ({
        traceId: item.summary.traceId,
        accountId: item.summary.accountId,
        conversationId: item.summary.conversationId,
        totalMs: item.summary.totalMs,
        llmRounds: item.summary.llmRounds,
        toolCalls: item.summary.toolCalls,
        inputTokens: item.summary.inputTokens,
        outputTokens: item.summary.outputTokens,
        stopReason: item.summary.stopReason,
        error: item.summary.error ?? null,
        flags: buildFlags(item.summary).join(","),
        sampled: item.sampled,
      })),
      skipDuplicates: true,
    });
  }

  async writeSpans(items: TraceQueueItem[]): Promise<void> {
    const rows = items.flatMap((item) =>
      item.spans.map((span) => ({
        traceId: item.summary.traceId,
        spanId: span.spanId,
        parentSpanId: span.parentSpanId,
        name: span.name,
        startTime: new Date(span.startTime),
        durationMs: span.duration,
        status: span.status,
        toolName:
          typeof span.attributes.toolName === "string" ? span.attributes.toolName : null,
        model: typeof span.attributes.model === "string" ? span.attributes.model : null,
        inputTokens:
          typeof span.attributes.inputTokens === "number" ? span.attributes.inputTokens : null,
        outputTokens:
          typeof span.attributes.outputTokens === "number" ? span.attributes.outputTokens : null,
        stopReason:
          typeof span.attributes.stopReason === "string" ? span.attributes.stopReason : null,
        errorMessage:
          typeof span.attributes.error === "string" ? span.attributes.error : null,
        payload: serializeSpanPayload(span.attributes),
      })),
    );

    if (rows.length === 0) return;

    await getPrisma().traceSpan.createMany({
      data: rows,
      skipDuplicates: true,
    });
  }
}

export function createObservabilityService(): ObservabilityService {
  const queue = new TraceQueue(new PrismaTraceWriter());
  const samplingConfig = { ...defaultSamplingConfig };

  return {
    queuePersistTrace(summary, spans) {
      const sampled = shouldPersistTrace(summary, samplingConfig);

      requestTotal.inc(
        { account: summary.accountId, status: summary.hasError ? "error" : "ok" },
        1,
      );
      requestDurationMs.observe({}, summary.totalMs);
      llmRoundsPerRequest.observe({}, summary.llmRounds);
      llmTokensInput.inc({}, summary.inputTokens);
      llmTokensOutput.inc({}, summary.outputTokens);

      queue.enqueue(summary, spans, sampled);
    },

    async flush() {
      await queue.flush();
    },

    getPendingWriteCount() {
      return queue.depth;
    },

    getSamplingNormalRate() {
      return samplingConfig.normalRate;
    },

    setSamplingNormalRate(normalRate) {
      samplingConfig.normalRate = normalRate;
    },

    getMetricsText() {
      return registry.dump();
    },

    async getOverview(window) {
      const since = getWindowStart(window);

      const traces = await getPrisma().trace.findMany({
        where: { createdAt: { gte: since } },
        select: {
          totalMs: true,
          inputTokens: true,
          outputTokens: true,
          flags: true,
          error: true,
          llmRounds: true,
          sampled: true,
        },
      });

      const toolSpans = await getPrisma().traceSpan.findMany({
        where: {
          name: "tool.execute",
          toolName: { not: null },
          trace: { createdAt: { gte: since } },
        },
        select: {
          toolName: true,
          durationMs: true,
          status: true,
        },
      });

      const requestCount = traces.length;
      const totalDuration = traces.reduce((sum, item) => sum + item.totalMs, 0);
      const totalInputTokens = traces.reduce((sum, item) => sum + item.inputTokens, 0);
      const totalOutputTokens = traces.reduce((sum, item) => sum + item.outputTokens, 0);
      const errorCount = traces.filter(
        (item) => item.error || parseFlags(item.flags).includes("error"),
      ).length;

      const latencyValues = traces.map((item) => item.totalMs);

      const roundBuckets = new Map<string, number>([
        ["1", 0],
        ["2", 0],
        ["3", 0],
        ["4+", 0],
      ]);
      for (const trace of traces) {
        const bucket =
          trace.llmRounds >= 4 ? "4+" : String(Math.max(1, trace.llmRounds || 1));
        roundBuckets.set(bucket, (roundBuckets.get(bucket) ?? 0) + 1);
      }

      const toolStats = new Map<
        string,
        { count: number; errors: number; durations: number[] }
      >();
      for (const span of toolSpans) {
        if (!span.toolName) continue;
        const current = toolStats.get(span.toolName) ?? {
          count: 0,
          errors: 0,
          durations: [],
        };
        current.count += 1;
        current.errors += span.status === "error" ? 1 : 0;
        current.durations.push(span.durationMs);
        toolStats.set(span.toolName, current);
      }

      const totalToolCalls = [...toolStats.values()].reduce((sum, item) => sum + item.count, 0);
      const flagStats = new Map<"error" | "max_rounds" | "slow" | "expensive", number>([
        ["error", 0],
        ["max_rounds", 0],
        ["slow", 0],
        ["expensive", 0],
      ]);
      for (const trace of traces) {
        for (const flag of parseFlags(trace.flags)) {
          if (
            flag === "error" ||
            flag === "max_rounds" ||
            flag === "slow" ||
            flag === "expensive"
          ) {
            flagStats.set(flag, (flagStats.get(flag) ?? 0) + 1);
          }
        }
      }

      return {
        window,
        totals: {
          requests: requestCount,
          avg_duration_ms: requestCount > 0 ? Math.round(totalDuration / requestCount) : 0,
          error_rate: requestCount > 0 ? roundTo(errorCount / requestCount, 4) : 0,
          token_total: totalInputTokens + totalOutputTokens,
          estimated_cost_usd: estimateUsd(totalInputTokens, totalOutputTokens),
          sampled_traces: traces.filter((trace) => trace.sampled).length,
        },
        latency_ms: {
          p50: percentile(latencyValues, 0.5),
          p95: percentile(latencyValues, 0.95),
          p99: percentile(latencyValues, 0.99),
        },
        round_distribution: [...roundBuckets.entries()].map(([bucket, count]) => ({
          bucket,
          count,
          ratio: requestCount > 0 ? roundTo(count / requestCount, 4) : 0,
        })),
        top_tools: [...toolStats.entries()]
          .sort((left, right) => right[1].count - left[1].count)
          .slice(0, 5)
          .map(([toolName, stats]) => ({
            tool_name: toolName,
            count: stats.count,
            ratio: totalToolCalls > 0 ? roundTo(stats.count / totalToolCalls, 4) : 0,
            error_rate: stats.count > 0 ? roundTo(stats.errors / stats.count, 4) : 0,
            p95_ms: percentile(stats.durations, 0.95),
          })),
        flag_counts: [...flagStats.entries()].map(([flag, count]) => ({
          flag,
          count,
          ratio: requestCount > 0 ? roundTo(count / requestCount, 4) : 0,
        })),
      };
    },

    async listTraces(query) {
      const rows = await getPrisma().trace.findMany({
        where: buildTraceWhere(query),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit + 1,
      });

      const hasMore = rows.length > query.limit;
      const visible = hasMore ? rows.slice(0, query.limit) : rows;

      return {
        data: visible.map(toTraceSummary),
        has_more: hasMore,
        next_cursor: hasMore ? Number(visible[visible.length - 1]?.id ?? 0) : undefined,
      };
    },

    async getTrace(traceId) {
      const trace = await getPrisma().trace.findUnique({
        where: { traceId },
      });
      if (!trace) return null;

      const spans = await getPrisma().traceSpan.findMany({
        where: { traceId },
        orderBy: [{ startTime: "asc" }, { id: "asc" }],
      });

      return {
        ...toTraceSummary(trace),
        spans: spans.map(toTraceSpan),
      };
    },

    async cleanupExpired(now = new Date()) {
      const normalCutoff = new Date(now.getTime() - NORMAL_TRACE_RETENTION_MS);
      const flaggedCutoff = new Date(now.getTime() - FLAGGED_TRACE_RETENTION_MS);

      await getPrisma().traceSpan.deleteMany({
        where: {
          OR: [
            {
              trace: {
                createdAt: { lt: normalCutoff },
                flags: "",
              },
            },
            {
              trace: {
                createdAt: { lt: flaggedCutoff },
              },
            },
          ],
        },
      });

      await getPrisma().trace.deleteMany({
        where: {
          createdAt: { lt: flaggedCutoff },
        },
      });
    },
  };
}

export const observabilityService = createObservabilityService();

export function recordToolMetric(
  toolName: string,
  status: "ok" | "error",
  latencyMs: number,
): void {
  toolCallsTotal.inc({ tool_name: toolName, status }, 1);
  toolLatencyMs.observe({ tool_name: toolName }, latencyMs);
}
