# Agent Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 clawbot 补齐 Agent Observability 的前后端实现，包括 trace/span 落库、metrics 暴露、概览/详情 API 与控制台页面。

**Architecture:** 以 `@clawbot/observability` 作为公共内核，`@clawbot/agent` 负责 LLM / tool span 埋点，`@clawbot/server` 负责 Trace/TraceSpan 持久化与 API 聚合，`@clawbot/web` 提供概览 + Trace 详情联动页面。

**Tech Stack:** React 19 + React Router 7, Hono, Prisma/PostgreSQL, workspace packages, AsyncLocalStorage tracing

---

### Task 1: 收尾 observability 内核

**Files:**
- Modify: `packages/observability/src/metrics/registry.ts`
- Test: `packages/observability/src/metrics/registry.test.ts`

- [ ] **Step 1: 写出 metrics registry 的失败测试**

```ts
assert.equal(requests.get({ status: "ok" }), 3);
assert.match(dump, /agent_latency_ms_bucket/);
```

- [ ] **Step 2: 跑测试确认红灯**

Run: `node --import ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs --test packages/observability/src/metrics/registry.test.ts`
Expected: FAIL，提示 `Not implemented` 或行为不符合 dump / reset 预期

- [ ] **Step 3: 实现 Counter / Histogram / Gauge / dump / reset**

```ts
createCounter(opts): Counter
createHistogram(opts): Histogram
createGauge(opts): Gauge
dump(): string
reset(): void
```

- [ ] **Step 4: 复跑测试**

Run: `node --import ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs --test packages/observability/src/metrics/registry.test.ts`
Expected: PASS

### Task 2: 打通 server 观测后端

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Create: `packages/server/src/observability/service.ts`
- Create: `packages/server/src/api/routes/observability.ts`
- Modify: `packages/server/src/api/index.ts`
- Modify: `packages/server/src/api/routes/health.ts`
- Modify: `packages/server/src/index.ts`
- Test: `packages/server/src/api/routes/observability.test.ts`

- [ ] **Step 1: 为 observability API 写失败测试**

```ts
const overviewResponse = await app.request("/api/observability/overview?window=7d", { headers });
assert.equal(overviewResponse.status, 200);
```

- [ ] **Step 2: 跑 server 测试确认红灯**

Run: `pnpm -F @clawbot/server test`
Expected: FAIL，提示 observability 路由或认证夹具未对齐

- [ ] **Step 3: 添加 Prisma Trace / TraceSpan 模型并生成 client**

```bash
pnpm -F @clawbot/server prisma:generate
```

- [ ] **Step 4: 实现 observability service 和路由**

```ts
registerObservabilityRoutes(app, observability)
observability.getOverview(window)
observability.listTraces(query)
observability.getTrace(traceId)
```

- [ ] **Step 5: 更新 health 与 shutdown/cleanup**

```ts
pending_trace_writes: observabilityService.getPendingWriteCount()
await observabilityService.flush()
```

- [ ] **Step 6: 复跑 server 测试**

Run: `pnpm -F @clawbot/server test`
Expected: PASS

### Task 3: 把 trace 埋点接入 agent / server 执行链

**Files:**
- Modify: `packages/agent/src/runner.ts`
- Modify: `packages/server/src/agent.ts`
- Modify: `packages/server/src/ai.ts`
- Modify: `packages/server/src/logger.ts`

- [ ] **Step 1: 在 runner 中包裹 llm.call / tool.execute**

```ts
response = await withSpan("llm.call", { model, round }, async (span) => { ... })
const content = await withSpan("tool.execute", { toolName }, async () => ...)
```

- [ ] **Step 2: 在 server agent 入口建立 trace 根上下文**

```ts
return runWithTrace(accountId, effectiveConvId, async () => {
  withSpanSync("message.receive", ...)
  const reply = await withSpan("conversation.lock", {}, async () => ...)
})
```

- [ ] **Step 3: 在 ai.ts 增加 agent.chat / history.load span**

```ts
return withSpan("agent.chat", { model: MODEL_ID }, async () => {
  await withSpan("history.load", { conversationId }, async () => ensureHistoryLoaded(...))
})
```

- [ ] **Step 4: 结束时统一 queuePersistTrace，并注入 traceId 日志前缀**

```ts
observabilityService.queuePersistTrace(trace.summarize(), trace.getSpans())
const traceId = getTraceId()
```

### Task 4: 补齐 web 控制台页面

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/hooks/useObservability.ts`
- Create: `packages/web/src/pages/ObservabilityPage.tsx`
- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/components/layout/Sidebar.tsx`
- Modify: `packages/web/src/components/ui/icons.tsx`
- Modify: `packages/web/src/lib/format.ts`

- [ ] **Step 1: 定义 overview / trace / span DTO**

```ts
export interface ObservabilityOverview { ... }
export interface ObservabilityTraceDetail extends ObservabilityTraceSummary { spans: ... }
```

- [ ] **Step 2: 实现 API client 与 hook**

```ts
fetchObservabilityOverview(window)
fetchObservabilityTraces({ window, cursor, flag, status, query })
fetchObservabilityTrace(traceId)
```

- [ ] **Step 3: 实现 Observability 页面**

```tsx
<MetricCard label="请求总量" ... />
<ChartList title="Tools" ... />
<DetailTimeline trace={selectedTrace} />
```

- [ ] **Step 4: 接入路由与侧栏**

```tsx
<Route path="/observability" element={<ObservabilityPage />} />
```

### Task 5: 验证

**Files:**
- Modify if needed: `packages/server/src/...`
- Modify if needed: `packages/web/src/...`

- [ ] **Step 1: 跑 observability 单测**

Run: `node --import ./node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/loader.mjs --test packages/observability/src/metrics/registry.test.ts`
Expected: PASS

- [ ] **Step 2: 跑 server 测试**

Run: `pnpm -F @clawbot/server test`
Expected: PASS

- [ ] **Step 3: 构建 web**

Run: `pnpm -F @clawbot/web build`
Expected: PASS

- [ ] **Step 4: 构建 server / agent / observability**

Run: `pnpm -F @clawbot/observability build`
Expected: PASS

Run: `pnpm -F @clawbot/agent build`
Expected: PASS

Run: `pnpm -F @clawbot/server build`
Expected: PASS
