/**
 * TraceContext —— 一次请求的完整上下文
 *
 * 负责收集该请求下所有 span，并生成汇总信息。
 */

import type { SpanData, TraceSummary } from "./types.js";

export class TraceContext {
  readonly traceId: string;
  readonly accountId: string;
  readonly conversationId: string;
  private spans: SpanData[] = [];

  constructor(traceId: string, accountId: string, conversationId: string) {
    this.traceId = traceId;
    this.accountId = accountId;
    this.conversationId = conversationId;
  }

  addSpan(span: SpanData): void {
    this.spans.push(span);
  }

  getSpans(): SpanData[] {
    return this.spans;
  }

  /**
   * 生成汇总信息，用于 Trace 表落库 + 采样判定 + 质量信号。
   *
   * 聚合规则：
   * - llmRounds / inputTokens / outputTokens → 从 name === "llm.call" 的 span 中提取
   * - toolCalls → 从 name === "tool.execute" 的 span 中计数
   * - totalMs → 最早 span startTime 到最晚 span (startTime + duration) 的跨度
   * - hasError → 任意 span status === "error"
   * - error → 首个 error span 的错误信息
   * - stopReason → 最后一个 llm.call span 的 stopReason，无则 "unknown"
   */
  summarize(): TraceSummary {
    const llmSpans = this.spans.filter((s) => s.name === "llm.call");
    const toolSpans = this.spans.filter((s) => s.name === "tool.execute");

    let totalMs = 0;
    if (this.spans.length > 0) {
      const earliest = Math.min(...this.spans.map((s) => s.startTime));
      const latest = Math.max(
        ...this.spans.map((s) => s.startTime + s.duration),
      );
      totalMs = latest - earliest;
    }

    const errorSpan = this.spans.find((s) => s.status === "error");

    return {
      traceId: this.traceId,
      accountId: this.accountId,
      conversationId: this.conversationId,
      totalMs,
      llmRounds: llmSpans.length,
      toolCalls: toolSpans.length,
      inputTokens: llmSpans.reduce(
        (sum, s) => sum + (Number(s.attributes.inputTokens) || 0),
        0,
      ),
      outputTokens: llmSpans.reduce(
        (sum, s) => sum + (Number(s.attributes.outputTokens) || 0),
        0,
      ),
      stopReason:
        (llmSpans.at(-1)?.attributes.stopReason as string) ?? "unknown",
      hasError: this.spans.some((s) => s.status === "error"),
      error: errorSpan?.attributes.error as string | undefined,
    };
  }
}
