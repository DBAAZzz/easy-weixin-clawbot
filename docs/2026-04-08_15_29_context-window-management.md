# 上下文窗口管理方案

## 一、现状问题

当前 `runner.ts` 将全量 `history` 直接传入 `complete()`，没有任何截断或预算机制：

```
systemPrompt + alwaysOn skills + memory(tape) + 全量 history → complete()
                                                    ↑ 无截断，无预算
```

- `runner.ts:236` — `workingHistory`（全量）直接传入 `complete()`
- `restoreHistory()` 从 DB 查全部消息，无 limit
- 图片消息 hydrate 后 base64 占大量 token
- 对话越长越容易超出模型上下文限制，导致 API 报错

## 二、整体架构

在 `runner.run()` 调用 `complete()` **之前**，插入一个 **ContextWindow** 层，负责将 history 裁剪到 token 预算内。

```
chat.ts                      runner.ts
  │                            │
  │  history (全量)             │
  └──────────────────────────► │
                               │  ┌─────────────────────┐
                               ├─►│  fitToContextWindow  │ ← 新增
                               │  └──────┬──────────────┘
                               │         │ trimmed history
                               │         ▼
                               │    complete(model, { messages: trimmed })
```

关键原则：**只裁剪传给 LLM 的副本**，内存中的 `history` 数组和 DB 保持全量不变。

## 三、Token 预算分配

每个模型有不同的 context limit，预算按优先级分配：

| 层级 | 内容 | 预算策略 |
|------|------|----------|
| P0 - 保留区 | systemPrompt + skills + tools schema | 固定开销，先扣除 |
| P1 - 保留区 | memory (tape `formatMemoryForPrompt`) | 固定开销，先扣除 |
| P2 - 保护区 | 最近 N 条消息（原文） | 保证至少保留最近 2 轮对话 |
| P3 - 可压缩区 | 早期历史 | 超预算时压缩或丢弃 |
| 预留 | 输出 token | 预留 `maxOutputTokens` 给模型回复 |

**公式**：

```
historyBudget = modelContextLimit
              - outputReserve
              - countTokens(systemPrompt + skills)
              - countTokens(memory)
```

## 四、裁剪策略（三级递进）

当 `countTokens(history) > historyBudget` 时，按顺序执行：

### Level 1：图片降级

- 扫描非最近 2 轮的消息，将 image content 替换为 `[图片: 已省略]`
- 图片 base64 通常占数千 token，这一步往往就够了

### Level 2：滑动窗口截断

- 从最早的消息开始丢弃，直到总 token 数 ≤ 预算
- 在截断点插入一条合成的 system/user 消息：`[以上 {N} 条早期对话已省略]`
- 保证 history 第一条仍然是 user role（满足 API 要求）

### Level 3：摘要压缩（可选，后期再做）

- 对被截断的消息调用一次轻量模型（如 haiku）生成摘要
- 摘要作为一条合成 user 消息放在 history 开头
- 代价：多一次 API 调用，增加延迟和成本
- **建议第一版不做**，Level 1 + Level 2 已经够用

## 五、Token 计数方案

不需要精确计数，用估算即可：

```
estimateTokens(message) → number
```

- 文本：`text.length / 3`（中文约 1 字 ≈ 1-2 token，`/3` 对中英混合偏保守）
- 图片 base64：`base64.length * 0.75 / 3`（还原字节数再估算）
- tool_call / tool_result：`JSON.stringify` 后同文本处理
- 加 10% 安全裕量

> 如果后续需要精确计数，可引入 `tiktoken` 或用 Anthropic 的 token counting API。

## 六、关键实现位置

| 改动点 | 文件 | 说明 |
|--------|------|------|
| 新增 `context-window.ts` | `packages/agent/src/conversation/` | `fitToContextWindow(messages, budget)` 纯函数 |
| 调用裁剪 | `packages/agent/src/runner.ts:236` | `complete()` 之前调用，传入 trimmed messages |
| 模型 context limit 配置 | `packages/agent/src/model-resolver.ts` | 每个模型声明 `contextWindow` 字段 |
| token 估算工具 | `packages/agent/src/conversation/token-estimator.ts` | `estimateTokens()` |
| 无需改动 | `history.ts`, `message-store.ts` | 内存和 DB 仍存全量，裁剪只影响传给 LLM 的副本 |

## 七、核心约束

1. **只裁剪传给 LLM 的副本** — 内存中的 `history` 数组和 DB 保持全量不变
2. **tool_call 和 tool_result 必须成对** — 裁剪时如果截到中间，需要把不完整的 tool 调用对整组移除
3. **第一条消息必须是 user role** — 某些模型 API 有此要求
4. **history 末尾的 pending tool_result 不能被截断** — runner 多轮循环中的 tool_result 必须保留

## 八、可观测性

- 在 `withSpan` 中增加 attribute：`historyOriginalTokens`、`historyTrimmedTokens`、`trimLevel`（0/1/2）
- 当触发 Level 2 截断时 log warn，方便排查对话质量问题

## 九、分步实施建议

| 阶段 | 内容 | 风险 |
|------|------|------|
| Phase 1 | token 估算 + Level 1 图片降级 + Level 2 滑动窗口 | 低，核心是一个纯函数，不涉及存储层改动 |
| Phase 2 | 可观测性 metrics 接入 | 低 |
| Phase 3（可选） | Level 3 摘要压缩 | 中，引入额外 API 调用 |
