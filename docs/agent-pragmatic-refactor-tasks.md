# @clawbot/agent 务实重构清单（可直接实现）

> 日期：2026-06-20
> 取代：`docs/agent-module-state-refactor-plan.md`（该方向已否决，原因见文末）。
> 范围：只列**与测试/多实例无关、本身就值得做**的代码改进。每项独立成 PR、可单独发布。

## 先定调（已决策，别重开）

经过两轮交叉评审，下面这些**不做**，别再被"结构债"这种词带回去：

- **不做 `AgentContext` / factory 化全包重构**——进程不跑多实例，唯一收益不存在。
- **不预建 reset 测试基建**——是为不存在的测试铺路；哪天某个测试真串台了，当场给那一个模块加一行 reset 即可。
- **不动会话锁**——已在 server 层（`agent.ts:311`）正确加上，是 Port 契约，碰它只会重复加锁。

剩下真正值得写的就是下面三件。它们的共同点：**提升核心文件内聚度、消除 `as any`、把厂商细节赶出通用循环**，且不依赖任何测试基建（抽出来的纯函数反而是少数值得单测的目标）。

---

## 任务 1：把 AI SDK 结果转换抽出 `runner.ts` → `llm/messages.ts`

**价值**：`runner.ts` 545 行里最该搬走的一块。当前 `generateText` 的结果在循环内被内联转成 `AssistantMessage`（`runner.ts:361-400`），带 4 处 `(part as any)`。抽出后 runner 只管编排，转换变成**纯函数**、可单测、`as any` 收口到一处。

**改动**

1. 在 `src/llm/messages.ts` 新增（与现有 `agentToModelMessages` 反向对称）：

```ts
import type { AssistantMessage } from "./types.js";

/** AI SDK generateText 结果 → 内部 AssistantMessage。所有 SDK part 形状的断言收口在此。 */
export function mapModelResultToAssistantMessage(
  result: {
    content: unknown[];
    finishReason: string;
    usage: { inputTokens?: number; outputTokens?: number };
    response?: { modelId?: string };
  },
  fallbackModelId: string,
): AssistantMessage {
  const content: AssistantMessage["content"] = [];
  for (const part of result.content) {
    const p = part as { type: string; text?: string; toolCallId?: string; toolName?: string; input?: unknown; args?: unknown };
    if (p.type === "text" && p.text) {
      content.push({ type: MESSAGE_CONTENT_TYPE.TEXT, text: p.text });
    } else if (p.type === "reasoning" && p.text) {
      content.push({ type: MESSAGE_CONTENT_TYPE.THINKING, thinking: p.text });
    } else if (p.type === "tool-call") {
      content.push({
        type: MESSAGE_CONTENT_TYPE.TOOL_CALL,
        id: p.toolCallId!,
        name: p.toolName!,
        arguments: normalizeToolArguments(p.input ?? p.args),
      });
    }
  }
  return {
    role: MESSAGE_ROLE.ASSISTANT,
    content,
    timestamp: Date.now(),
    model: result.response?.modelId ?? fallbackModelId,
    stopReason: mapFinishReason(result.finishReason),
    usage: { input: result.usage.inputTokens ?? 0, output: result.usage.outputTokens ?? 0 },
  };
}
```

2. 把 `runner.ts` 里的 `mapFinishReason()`（现 `runner.ts:527`）一并移到 `messages.ts`，让转换逻辑同处。`normalizeToolArguments` messages.ts 已有，复用。
3. `runner.ts` 的 `generateText` 回调里，把内联转换换成一行调用 `mapModelResultToAssistantMessage(result, effectiveModelId)`；`span.addAttributes` 仍在 runner 内对返回的 `assistantMsg` 做快照。

**验收**
- 新增 `messages.test.ts` 用例：喂入含 text / reasoning / tool-call 三种 part 的假 result，断言产出的 `AssistantMessage` 结构正确、`stopReason` 映射正确。（这是值得写的纯函数单测，零基建。）
- `runner.ts` 不再出现 `(part as any)`。
- `pnpm -F @clawbot/agent test` 通过。

---

## 任务 2：用 `ModelMeta` 能力声明替换 `isDeepSeekModel` 厂商嗅探

**价值**：`runner.ts:191` 的 `isDeepSeekModel()` 把厂商名硬编码进通用循环（`runner.ts:292` 据此决定是否 `stripUnreasonedToolCallHistory`）。provider 一多，这里会堆出 `if provider === xxx`。改成声明式：runner 只读能力，不认厂商。

**改动**

1. `src/llm/types.ts` 的 `ModelMeta` 加一个可选字段：

```ts
export interface ModelMeta {
  contextWindow: number;
  maxOutputTokens: number;
  supportsImageInput?: boolean;
  /** true 表示该模型对“未推理的历史 tool-call”兼容性差，进入模型前需清理（如 DeepSeek）。 */
  requiresReasonedToolHistory?: boolean;
}
```

2. `src/llm/provider-factory.ts`：在构造 meta 时，对 deepseek 模型把该字段置 `true`（把现在 runner 里的厂商判断逻辑搬到这里，作为 provider 元数据的一部分）。
3. `src/runner.ts`：删除 `isDeepSeekModel()`，把 `runner.ts:292` 改为读 `effectiveMeta.requiresReasonedToolHistory`：

```ts
let history = effectiveMeta.requiresReasonedToolHistory
  ? stripUnreasonedToolCallHistory(workingHistory)
  : workingHistory;
```

**验收**
- `runner.ts` 不再引用 provider 名 / `isDeepSeekModel`。
- `provider-factory.test.ts` 加用例：deepseek 模型构造出的 meta `requiresReasonedToolHistory === true`，其它模型为 falsy。
- `pnpm -F @clawbot/agent test` 通过。

---

## 任务 3：把 vision/media 预处理抽出 `chat.ts` → `vision.ts`

**价值**：`chat.ts:140-192` 约 50 行图片处理（mime 探测 → 主模型是否支持 → 解析 vision 模型 → describe → 多种 placeholder 分支 + 5 个 console 分支）内联在 `chat()` 主编排里，可读性差、与编排耦合。抽出后 `chat()` 只做装配。

**改动**

1. 在 `src/vision.ts` 新增：

```ts
export interface PreparedVisualContent {
  /** 追加到 userContent 的块（已含 image 块本身 + 可选的 visual_context / placeholder 文本块）。 */
  content: (TextContent | ImageContent)[];
  /** 解析出的 visual context（写入 UserMessage.visualContext）。 */
  visualContexts: VisualContext[];
}

/** 读取图片、按 chat 模型是否支持图片决定直传 / 走 vision 描述 / 占位，集中所有 fallback 分支。 */
export async function prepareUserVisualContent(args: {
  media: ChatMedia;
  chatModel: ResolvedModel;
  accountId: string;
  conversationId: string;
}): Promise<PreparedVisualContent>;
```

把 `chat.ts:140-192` 的整段逻辑（含 `readFileSync`、`detectImageMime`、`resolveConfiguredModel(... "vision")`、`describeImageWithVisionModel`、各 placeholder 分支）原样搬入，对外只返回 `{ content, visualContexts }`。

2. `chat.ts` 改为：

```ts
if (media?.type === "image") {
  const prepared = await prepareUserVisualContent({ media, chatModel, accountId, conversationId });
  userContent.push(...prepared.content);
  visualContexts.push(...prepared.visualContexts);
}
```

**注意**：这是纯搬运、不改行为——所有 console 分支、placeholder 文案、mime 修正逻辑保持原样，只是换了位置。先不追求把 `readFileSync` 改成走 port（那是另一个话题，本任务不扩张）。

**验收**
- `chat()` 中不再出现 `readFileSync` / vision 解析细节，图片分支收敛到 3-4 行。
- 行为不变：有/无 vision 模型、describe 成功/失败/超时各分支产生的 userContent 与改前一致。
- `pnpm -F @clawbot/agent test` 通过。

---

## 建议顺序

1. **任务 1**（收益最高、最安全，抽纯函数）。
2. **任务 2**（小而干净，去厂商耦合）。
3. **任务 3**（纯搬运，注意不改行为）。

三件都做完，`runner.ts` 和 `chat.ts` 这两个"编排核心职责过重"的问题就基本解决了，且没引入任何测试基建或兼容层。

## 明确不在本清单（低价值 / 易扩张，先不做）

- 统一 logger 替换裸 `console`：散落数十处，收益主要在生产日志采集；要做就单独立项，别夹带。
- 魔法常量集中到 `constants.ts`：纯整理，没人疼就别动。
- 收口 `index.ts` 导出面（public/internal 分层）：内部 monorepo 暂无外部误用风险，优先级最低。
