/**
 * Trace / Span 核心数据结构
 */

/** Span 属性：可扩展的键值对 */
export type SpanAttributes = Record<string, string | number | boolean>;

/** 单个 Span 的运行时数据 */
export interface SpanData {
  spanId: string;
  parentSpanId: string | null;
  name: string;
  /** UTC 毫秒时间戳（Date.now()） */
  startTime: number;
  /** 耗时 ms */
  duration: number;
  status: "ok" | "error";
  attributes: SpanAttributes;
}

/** fn 内部可通过 SpanContext 追加后置 attributes（如 LLM 返回的 token 数） */
export interface SpanContext {
  addAttributes(attrs: SpanAttributes): void;
}

/** Trace 汇总信息，用于落库和采样判定 */
export interface TraceSummary {
  traceId: string;
  accountId: string;
  conversationId: string;
  totalMs: number;
  llmRounds: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  stopReason: string;
  hasError: boolean;
  error?: string;
}
