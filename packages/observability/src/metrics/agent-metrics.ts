/**
 * Agent 业务指标定义
 *
 * 预定义所有 Agent 相关的指标实例，上层直接 import 使用。
 * 指标列表参见设计文档 Metrics 章节。
 */

import { MetricsRegistry } from "./registry.js";

/** 全局指标注册表单例 */
export const registry = new MetricsRegistry();

// ── 请求指标 ──

export const requestTotal = registry.createCounter({
  name: "agent_request_total",
  help: "Total requests",
  labelNames: ["account", "status"],
});

export const requestDurationMs = registry.createHistogram({
  name: "agent_request_duration_ms",
  help: "End-to-end request duration",
  labelNames: [],
  buckets: [500, 1000, 2000, 5000, 10000, 30000],
});

// ── LLM 指标 ──

export const llmRoundsPerRequest = registry.createHistogram({
  name: "agent_llm_rounds_per_request",
  help: "LLM rounds per request",
  labelNames: [],
  buckets: [1, 2, 3, 5, 10],
});

export const llmTokensInput = registry.createCounter({
  name: "agent_llm_tokens_input",
  help: "Total input tokens",
  labelNames: [],
});

export const llmTokensOutput = registry.createCounter({
  name: "agent_llm_tokens_output",
  help: "Total output tokens",
  labelNames: [],
});

export const llmLatencyMs = registry.createHistogram({
  name: "agent_llm_latency_ms",
  help: "Single LLM call latency",
  labelNames: ["model"],
  buckets: [500, 1000, 2000, 5000, 10000],
});

export const llmErrorsTotal = registry.createCounter({
  name: "agent_llm_errors_total",
  help: "LLM errors",
  labelNames: ["error_type"],
});

// ── 工具指标 ──

export const toolCallsTotal = registry.createCounter({
  name: "agent_tool_calls_total",
  help: "Tool invocations",
  labelNames: ["tool_name", "status"],
});

export const toolLatencyMs = registry.createHistogram({
  name: "agent_tool_latency_ms",
  help: "Tool execution latency",
  labelNames: ["tool_name"],
  buckets: [50, 100, 250, 500, 1000, 5000],
});

// ── 上下文窗口指标 ──

export const contextTrimTotal = registry.createCounter({
  name: "agent_context_trim_total",
  help: "Context window trim events",
  labelNames: ["trim_level"],
});

export const contextTokensOriginal = registry.createHistogram({
  name: "agent_context_tokens_original",
  help: "Estimated tokens before trimming",
  labelNames: [],
  buckets: [1000, 5000, 10000, 30000, 60000, 120000, 200000],
});

export const contextTokensTrimmed = registry.createHistogram({
  name: "agent_context_tokens_trimmed",
  help: "Estimated tokens after trimming",
  labelNames: [],
  buckets: [1000, 5000, 10000, 30000, 60000, 120000, 200000],
});

export const contextMessagesDropped = registry.createHistogram({
  name: "agent_context_messages_dropped",
  help: "Number of messages dropped by sliding window",
  labelNames: [],
  buckets: [0, 5, 10, 20, 50, 100, 200],
});

// ── 系统指标 ──

export const messageQueueDepth = registry.createGauge({
  name: "agent_message_queue_depth",
  help: "Pending message queue depth",
  labelNames: [],
});

export const activeConversations = registry.createGauge({
  name: "agent_active_conversations",
  help: "Currently active conversations",
  labelNames: [],
});
