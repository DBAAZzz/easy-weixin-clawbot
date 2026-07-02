/**
 * Usage metering store — batched writes + 30-day overview aggregation.
 *
 * Append-only fact table, one row per model call. Decoupled from the
 * observability sampling pipeline; this is the canonical source for the usage
 * analytics page. Aggregation runs in-process (matching the observability
 * service) so there is no BigInt coercion to worry about.
 */

import type { RecordUsageParams } from "@clawbot/agent/ports";
import type { UsageOverview } from "@clawbot/shared";
import { log } from "../logger.js";
import { getPrisma } from "./prisma.js";

const TZ = "Asia/Shanghai";
const DAY_MS = 24 * 60 * 60 * 1000;
// 热力图按一年度展示活跃；token 折线与汇总指标看近 30 天。
const ACTIVITY_DAYS = 365;
const TOKEN_DAYS = 30;

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Calendar day (YYYY-MM-DD) in Asia/Shanghai. */
function toDay(date: Date): string {
  return dayFormatter.format(date);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Write queue ──────────────────────────────────────────────────────

const queue: RecordUsageParams[] = [];
let flushing = false;
let retryTimer: NodeJS.Timeout | null = null;

export function queueRecordUsage(params: RecordUsageParams): void {
  queue.push(params);
  void flushQueue();
}

async function flushQueue(): Promise<void> {
  if (flushing || queue.length === 0) return;
  flushing = true;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  const batch = queue.splice(0, queue.length);
  try {
    await getPrisma().usageEvent.createMany({
      data: batch.map((e) => ({
        accountId: e.accountId,
        conversationId: e.conversationId,
        requestId: e.requestId,
        model: e.model,
        provider: e.provider,
        inputTokens: e.inputTokens,
        outputTokens: e.outputTokens,
      })),
    });
  } catch (error) {
    queue.unshift(...batch);
    log.error("flushUsageQueue", error);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void flushQueue();
    }, 2_000);
    retryTimer.unref?.();
  } finally {
    flushing = false;
  }

  if (queue.length > 0 && !retryTimer) {
    void flushQueue();
  }
}

export function getPendingUsageWriteCount(): number {
  return queue.length;
}

export async function drainUsageQueue(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while ((queue.length > 0 || flushing) && Date.now() < deadline) {
    await flushQueue();
    if (queue.length > 0 || flushing) await delay(100);
  }
}

// ── Overview aggregation ─────────────────────────────────────────────

type Tokens = { input: number; output: number };

function addTokens(map: Map<string, Tokens>, key: string, input: number, output: number): void {
  const current = map.get(key);
  if (current) {
    current.input += input;
    current.output += output;
  } else {
    map.set(key, { input, output });
  }
}

/** Day axis (oldest → newest) of `count` calendar days ending today, in TZ. */
function buildDays(now: number, count: number): string[] {
  const days: string[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    days.push(toDay(new Date(now - i * DAY_MS)));
  }
  return days;
}

/** 一年度活跃热力图：按天的去重请求数 + 当日 token 总量，level 按年内峰值归一化。 */
function buildActivityDays(
  events: { createdAt: Date; requestId: string; inputTokens: number; outputTokens: number }[],
  days: string[],
): UsageOverview["activity_days"] {
  const inWindow = new Set(days);
  const requestsByDay = new Map<string, Set<string>>();
  const tokensByDay = new Map<string, number>();

  for (const e of events) {
    const day = toDay(e.createdAt);
    if (!inWindow.has(day)) continue;
    let requests = requestsByDay.get(day);
    if (!requests) requestsByDay.set(day, (requests = new Set()));
    requests.add(e.requestId);
    tokensByDay.set(day, (tokensByDay.get(day) ?? 0) + e.inputTokens + e.outputTokens);
  }

  const counts = days.map((day) => requestsByDay.get(day)?.size ?? 0);
  const maxRequests = Math.max(0, ...counts);

  return days.map((date, i) => {
    const request_count = counts[i];
    const level = (request_count === 0
      ? 0
      : Math.min(4, Math.ceil((request_count / maxRequests) * 4))) as 0 | 1 | 2 | 3 | 4;
    return { date, request_count, token_total: tokensByDay.get(date) ?? 0, level };
  });
}

export async function getUsageOverview(accountId?: string): Promise<UsageOverview> {
  const now = Date.now();
  const account = accountId ? { accountId } : {};

  const activityEvents = await getPrisma().usageEvent.findMany({
    where: { ...account, createdAt: { gte: new Date(now - ACTIVITY_DAYS * DAY_MS) } },
    select: { createdAt: true, requestId: true, inputTokens: true, outputTokens: true },
  });
  const tokenEvents = await getPrisma().usageEvent.findMany({
    where: { ...account, createdAt: { gte: new Date(now - TOKEN_DAYS * DAY_MS) } },
    select: { createdAt: true, requestId: true, model: true, inputTokens: true, outputTokens: true },
  });

  const activity_days = buildActivityDays(activityEvents, buildDays(now, ACTIVITY_DAYS));

  // ── Token 折线 + 汇总：近 30 天 ──
  const tokenDays = buildDays(now, TOKEN_DAYS);
  const inTokenWindow = new Set(tokenDays);
  const requestsByDay = new Map<string, Set<string>>();
  const tokensByDayModel = new Map<string, Map<string, Tokens>>();
  const tokensByModel = new Map<string, Tokens>();

  for (const e of tokenEvents) {
    const day = toDay(e.createdAt);
    if (!inTokenWindow.has(day)) continue;
    const model = e.model || "unknown";

    let requests = requestsByDay.get(day);
    if (!requests) requestsByDay.set(day, (requests = new Set()));
    requests.add(e.requestId);

    let byModel = tokensByDayModel.get(day);
    if (!byModel) tokensByDayModel.set(day, (byModel = new Map()));
    addTokens(byModel, model, e.inputTokens, e.outputTokens);

    addTokens(tokensByModel, model, e.inputTokens, e.outputTokens);
  }

  const token_series = tokenDays.flatMap((date) =>
    [...(tokensByDayModel.get(date) ?? [])].map(([model, { input, output }]) => ({
      date,
      model,
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
    })),
  );

  const tokenTotal = [...tokensByModel.values()].reduce((sum, t) => sum + t.input + t.output, 0);
  const model_totals = [...tokensByModel]
    .map(([model, { input, output }]) => ({
      model,
      input_tokens: input,
      output_tokens: output,
      total_tokens: input + output,
      ratio: tokenTotal === 0 ? 0 : (input + output) / tokenTotal,
    }))
    .sort((a, b) => b.total_tokens - a.total_tokens);

  const requests = tokenDays.reduce((sum, day) => sum + (requestsByDay.get(day)?.size ?? 0), 0);

  return {
    window: "30d",
    totals: {
      requests,
      token_total: tokenTotal,
      avg_daily_requests: Math.round(requests / TOKEN_DAYS),
      avg_daily_tokens: Math.round(tokenTotal / TOKEN_DAYS),
    },
    activity_days,
    token_series,
    model_totals,
  };
}
