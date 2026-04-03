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
