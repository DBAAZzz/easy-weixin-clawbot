/**
 * @clawbot/observability
 *
 * Agent 端到端可观测性系统——Tracing、Metrics、Sampling、Quality Signals。
 *
 * 使用方式（在 @clawbot/server 中）：
 *
 *   import {
 *     runWithTrace, withSpan, getTraceId,   // Tracing
 *     requestTotal, llmLatencyMs,           // Metrics
 *     shouldPersistTrace,                   // Sampling
 *     TraceQueue,                           // Storage
 *     sanitize,                             // PII 脱敏
 *     buildFlags,                           // 质量信号
 *   } from "@clawbot/observability";
 */

// ── Tracing ──
export {
  TraceContext,
  runWithTrace,
  getActiveTrace,
  getTraceId,
  withSpan,
  withSpanSync,
} from "./trace/index.js";
export type {
  SpanData,
  SpanContext,
  SpanAttributes,
  TraceSummary,
} from "./trace/index.js";

// ── Metrics ──
export {
  MetricsRegistry,
  registry,
  requestTotal,
  requestDurationMs,
  llmRoundsPerRequest,
  llmTokensInput,
  llmTokensOutput,
  llmLatencyMs,
  llmErrorsTotal,
  toolCallsTotal,
  toolLatencyMs,
  messageQueueDepth,
  activeConversations,
} from "./metrics/index.js";
export type { Counter, Histogram, Gauge } from "./metrics/index.js";

// ── Sampling ──
export {
  shouldPersistTrace,
  defaultSamplingConfig,
} from "./sampling/index.js";
export type { SamplingConfig } from "./sampling/index.js";

// ── Storage ──
export { TraceQueue } from "./storage/index.js";
export type {
  TraceWriter,
  TraceQueueItem,
  QueueOptions,
} from "./storage/index.js";

// ── Sanitize ──
export { sanitize, builtinRules } from "./sanitize/index.js";
export type { SanitizeRule } from "./sanitize/index.js";

// ── Quality ──
export { buildFlags, defaultThresholds } from "./quality/index.js";
export type { QualityFlag, QualityThresholds } from "./quality/index.js";
