/**
 * AsyncLocalStorage 隐式上下文
 *
 * 核心机制：
 * - runWithTrace()  入口创建 trace 上下文，在回调作用域内隐式传播
 * - withSpan()      下游任意深度创建 span，自动维护父子关系
 * - getActiveTrace() / getTraceId()  下游读取当前上下文
 *
 * 并行安全：Promise.all 的每个分支各自持有独立的 store 快照，
 * 父子关系通过 currentSpanId 自动建立。
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { TraceContext } from "./context.js";
import type { SpanAttributes, SpanContext } from "./types.js";

// ── 内部类型 ──

interface TraceStore {
  trace: TraceContext;
  /** 当前活跃 span，自动成为新 span 的 parent */
  currentSpanId: string | null;
}

// ── 单例 storage ──

const storage = new AsyncLocalStorage<TraceStore>();

// ── 公开 API ──

/** 入口：创建 trace 并在回调作用域内隐式传播 */
export function runWithTrace<T>(
  accountId: string,
  conversationId: string,
  fn: () => T,
): T {
  const trace = new TraceContext(randomUUID(), accountId, conversationId);
  return storage.run({ trace, currentSpanId: null }, fn);
}

/** 获取当前 trace 上下文（无上下文时返回 undefined） */
export function getActiveTrace(): TraceContext | undefined {
  return storage.getStore()?.trace;
}

/** 获取当前 traceId（日志注入用，无上下文时返回 "no-trace"） */
export function getTraceId(): string {
  return storage.getStore()?.trace.traceId ?? "no-trace";
}

/**
 * 创建 span 并执行异步函数
 *
 * 关键设计：
 * 1. 从当前 store 读取 parentSpanId（自动建立父子关系）
 * 2. storage.run 创建新的子作用域，把自己的 spanId 设为 currentSpanId
 *    → fn 内部再调 withSpan 时，会自动以本 span 为 parent
 * 3. fn 通过 SpanContext.addAttributes() 追加后置属性（如 LLM token 数）
 * 4. addSpan 在 fn 结束后调用，此时 mergedAttrs 已包含所有后置属性
 */
export async function withSpan<T>(
  name: string,
  attributes: SpanAttributes,
  fn: (span: SpanContext) => Promise<T>,
): Promise<T> {
  const store = storage.getStore();
  if (!store) {
    return fn({ addAttributes: () => {} });
  }

  const spanId = randomUUID();
  const parentSpanId = store.currentSpanId;
  const startTime = Date.now();

  const mergedAttrs = { ...attributes };
  const spanCtx: SpanContext = {
    addAttributes(attrs) {
      Object.assign(mergedAttrs, attrs);
    },
  };

  try {
    const result = await storage.run(
      { trace: store.trace, currentSpanId: spanId },
      () => fn(spanCtx),
    );
    store.trace.addSpan({
      spanId,
      parentSpanId,
      name,
      startTime,
      duration: Date.now() - startTime,
      status: "ok",
      attributes: mergedAttrs,
    });
    return result;
  } catch (error) {
    store.trace.addSpan({
      spanId,
      parentSpanId,
      name,
      startTime,
      duration: Date.now() - startTime,
      status: "error",
      attributes: {
        ...mergedAttrs,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}

/** 同步版本，用于不需要 async 的场景（如命令拦截检查） */
export function withSpanSync<T>(
  name: string,
  attributes: SpanAttributes,
  fn: (span: SpanContext) => T,
): T {
  const store = storage.getStore();
  if (!store) {
    return fn({ addAttributes: () => {} });
  }

  const spanId = randomUUID();
  const parentSpanId = store.currentSpanId;
  const startTime = Date.now();

  const mergedAttrs = { ...attributes };
  const spanCtx: SpanContext = {
    addAttributes(attrs) {
      Object.assign(mergedAttrs, attrs);
    },
  };

  try {
    const result = storage.run(
      { trace: store.trace, currentSpanId: spanId },
      () => fn(spanCtx),
    );
    store.trace.addSpan({
      spanId, parentSpanId, name, startTime,
      duration: Date.now() - startTime,
      status: "ok", attributes: mergedAttrs,
    });
    return result;
  } catch (error) {
    store.trace.addSpan({
      spanId, parentSpanId, name, startTime,
      duration: Date.now() - startTime,
      status: "error",
      attributes: {
        ...mergedAttrs,
        error: error instanceof Error ? error.message : String(error),
      },
    });
    throw error;
  }
}
