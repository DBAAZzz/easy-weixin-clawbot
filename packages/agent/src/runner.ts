import { generateText, tool as aiTool } from "ai";
import { z } from "zod";
import type {
  AgentMessage,
  AssistantMessage,
  ImageContent,
  ToolCallContent,
  ToolResultMessage,
  TextContent,
  LanguageModel,
  ModelMeta,
} from "./llm/types.js";
import {
  agentToModelMessages,
  replaceImagesWithTextPlaceholders,
  stripUnreasonedToolCallHistory,
} from "./llm/messages.js";
import {
  llmErrorsTotal,
  llmLatencyMs,
  sanitize,
  toolCallsTotal,
  toolLatencyMs,
  contextTrimTotal,
  contextTokensOriginal,
  contextTokensTrimmed,
  contextMessagesDropped,
  withSpan,
} from "@clawbot/observability";
import { fitToContextWindow, type TrimResult } from "./conversation/context-window.js";
import { estimateTextTokens } from "./conversation/token-estimator.js";
import type { SkillRegistry } from "./skills/types.js";
import type { ToolRegistry, ToolContent } from "./tools/types.js";
import {
  collectLoadedSkillNames,
  createConversationSkillRuntime,
} from "./runtime/skill-runtime.js";
import { assembleSystemPrompt } from "./prompts/assembler.js";
import { getPromptAssets } from "./prompts/port.js";
import { PROMPT_PROFILES } from "./prompts/profiles.js";

export interface AgentConfig {
  model?: LanguageModel;
  meta?: ModelMeta;
  systemPrompt?: string;
  apiKey?: string;
  maxRounds?: number;
  toolTimeoutMs?: number;
  maxOnDemandSkills?: number;
}

export interface ModelOverride {
  model: LanguageModel;
  meta: ModelMeta;
  apiKey?: string;
}

export interface RunCallbacks {
  onMessage(msg: AgentMessage): void;
  onRoundStart?(round: number): void;
}

export type RunResult =
  | { status: "completed"; finalMessage: AssistantMessage }
  | { status: "max_rounds"; lastMessage: AssistantMessage; rounds: number }
  | { status: "aborted" };

export interface AgentRunner {
  run(
    messages: AgentMessage[],
    callbacks: RunCallbacks,
    signal?: AbortSignal,
    modelOverride?: ModelOverride,
  ): Promise<RunResult>;
}

function isToolCall(block: AssistantMessage["content"][number]): block is ToolCallContent {
  return block.type === "toolCall";
}

function createToolSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (parentSignal) {
    signals.push(parentSignal);
  }
  return AbortSignal.any(signals);
}

const USE_SKILL_TOOL = {
  name: "use_skill",
  description: "加载一个技能到当前对话。加载后，你将获得该技能的完整指令，按指令完成用户任务。",
  parameters: z.object({
    skill_name: z.string().describe("要加载的技能名称"),
  }),
};

function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  return String(error);
}

function normalizeToolArguments(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

function serializeMessage(message: AgentMessage): unknown {
  if (message.role === "user") {
    return {
      role: message.role,
      timestamp: message.timestamp,
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map((block) => {
              if (block.type === "image") {
                return {
                  type: "image",
                  mimeType: block.mimeType,
                  data: `[base64:${block.data.length} chars]`,
                } satisfies ImageContent;
              }
              return block;
            }),
    };
  }

  if (message.role === "assistant") {
    return {
      role: message.role,
      model: message.model,
      provider: message.provider,
      stopReason: message.stopReason,
      errorMessage: message.errorMessage,
      usage: message.usage,
      timestamp: message.timestamp,
      content: message.content,
    };
  }

  return {
    role: message.role,
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    isError: message.isError,
    timestamp: message.timestamp,
    content: message.content.map((block) =>
      block.type === "image"
        ? {
            type: "image",
            mimeType: block.mimeType,
            data: `[base64:${block.data.length} chars]`,
          }
        : block,
    ),
  } satisfies Partial<ToolResultMessage>;
}

function snapshotMessages(messages: AgentMessage[]): string {
  return sanitize(JSON.stringify(messages.map(serializeMessage), null, 2));
}

function snapshotAssistantMessage(message: AssistantMessage): string {
  return sanitize(
    JSON.stringify(
      {
        model: message.model,
        provider: message.provider,
        stopReason: message.stopReason,
        errorMessage: message.errorMessage,
        usage: message.usage,
        content: message.content,
      },
      null,
      2,
    ),
  );
}

function isDeepSeekModel(model: LanguageModel, modelId: string): boolean {
  const provider =
    typeof model === "object" && model !== null
      ? (model as { provider?: unknown }).provider
      : undefined;

  return (
    modelId.toLowerCase().includes("deepseek") ||
    (typeof provider === "string" && provider.toLowerCase().includes("deepseek"))
  );
}

function buildToolResult(
  toolCallId: string,
  toolName: string,
  content: ToolContent[],
  isError: boolean,
): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId,
    toolName,
    content,
    isError,
    timestamp: Date.now(),
  };
}

export function createAgentRunner(
  config: AgentConfig,
  tools: ToolRegistry,
  skills: SkillRegistry,
): AgentRunner {
  const baseSystemPrompt =
    config.systemPrompt ?? getPromptAssets().get(PROMPT_PROFILES.chat.systemPromptKey);

  async function run(
    messages: AgentMessage[],
    callbacks: RunCallbacks,
    signal?: AbortSignal,
    modelOverride?: ModelOverride,
  ): Promise<RunResult> {
    const effectiveModel = modelOverride?.model ?? config.model;
    const effectiveMeta = modelOverride?.meta ?? config.meta;
    if (!effectiveModel || !effectiveMeta) {
      throw new Error(
        "AgentRunner model not provided — pass modelOverride at run() time or configure a default model.",
      );
    }
    const effectiveModelId =
      typeof effectiveModel === "string"
        ? effectiveModel
        : (effectiveModel as { modelId: string }).modelId;
    const maxRounds = config.maxRounds ?? 10;
    const timeoutMs = config.toolTimeoutMs ?? 30_000;
    const workingHistory = [...messages];
    // 每次 run 都创建一个“本次对话作用域”的 skill runtime。
    // 它会从历史里恢复已经 use_skill 加载过的技能，避免多轮工具调用后丢失已加载技能上下文。
    const skillRuntime = createConversationSkillRuntime({
      registry: skills,
      maxOnDemandSkills: config.maxOnDemandSkills,
      initiallyLoadedSkills: collectLoadedSkillNames(workingHistory),
    });

    for (let round = 1; round <= maxRounds; round += 1) {
      if (signal?.aborted) {
        return { status: "aborted" };
      }

      callbacks.onRoundStart?.(round);

      // ── Context window trimming ──
      // system prompt 每轮重新 assemble，是因为 on-demand skill 可能在上一轮被 use_skill 加载，
      // 下一轮就需要把新技能正文注入 system prompt。
      const fullSystemPrompt = assembleSystemPrompt(PROMPT_PROFILES.chat, baseSystemPrompt, skills);

      // currentTools 是“当前这一轮暴露给模型看的工具清单”，结构是 ToolSnapshotItem[] + use_skill。
      // 其中 tools.current().tools 来自 composite registry，可能包含：
      // - Markdown 本地工具：web_search、web_fetch、opencli
      // - MCP 工具
      // - scheduler / heartbeat 内置工具
      // - skill runtime 相关工具
      //
      // 组装后的单项大致长这样：
      // {
      //   name: "web_search",
      //   description: "搜索互联网并返回标题、链接和摘要...",
      //   parameters: z.object({ query: z.string(), maxResults: z.number().optional() }),
      //   execute: async (args, ctx) => [...]
      // }
      //
      // 末尾追加的 USE_SKILL_TOOL 是 runner 内建工具，不在 registry 里落盘；
      // 它只负责让模型按需加载 skill 正文。
      const currentTools = [...tools.current().tools, USE_SKILL_TOOL];

      // 工具 schema 本身也会占上下文窗口，所以把 name/description/parameters 粗略计入固定开销。
      const toolsSchemaText = JSON.stringify(currentTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })));
      const fixedOverheadTokens = estimateTextTokens(fullSystemPrompt) + estimateTextTokens(toolsSchemaText);

      const promptHistory = (() => {
        // DeepSeek 对“未推理的历史 tool-call”兼容性较弱，进入模型前先做 provider-specific 清理。
        let history = isDeepSeekModel(effectiveModel, effectiveModelId)
          ? stripUnreasonedToolCallHistory(workingHistory)
          : workingHistory;

        // 如果当前模型不支持图片输入，只裁剪给模型的副本；原始 history 和 DB 仍保留图片消息。
        if (effectiveMeta.supportsImageInput === false) {
          history = replaceImagesWithTextPlaceholders(history);
        }

        return history;
      })();

      const trimResult = fitToContextWindow(promptHistory, {
        contextWindowTokens: effectiveMeta.contextWindow,
        outputReserveTokens: effectiveMeta.maxOutputTokens,
        fixedOverheadTokens,
      });

      // Record trim metrics
      contextTrimTotal.inc({ trim_level: String(trimResult.trimLevel) });
      contextTokensOriginal.observe({}, trimResult.originalTokens);
      contextTokensTrimmed.observe({}, trimResult.trimmedTokens);
      if (trimResult.droppedMessageCount > 0) {
        contextMessagesDropped.observe({}, trimResult.droppedMessageCount);
      }

      if (trimResult.trimLevel > 0) {
        console.log(
          `[context-window] trimLevel=${trimResult.trimLevel} original=${trimResult.originalTokens} trimmed=${trimResult.trimmedTokens} dropped=${trimResult.droppedMessageCount}`,
        );
      }

      // ── Build AI SDK tools (schema only, no execute) ──
      const aiSdkTools: Record<string, ReturnType<typeof aiTool>> = {};
      for (const t of currentTools) {
        // 这里传给 AI SDK 的只有工具说明和入参 schema，没有 execute。
        // 项目自己在下方解析 tool-call 后调用 registry/skillRuntime 执行，方便统一埋点、超时和错误回灌。
        aiSdkTools[t.name] = aiTool({
          description: t.description,
          inputSchema: t.parameters as any,
        });
      }

      // ── Convert messages to AI SDK format ──
      const modelMessages = agentToModelMessages(trimResult.messages);

      const llmStartedAt = Date.now();
      let response: AssistantMessage;
      try {
        response = await withSpan(
          "llm.call",
          { model: effectiveModelId, round },
          async (span) => {
            const result = await generateText({
              model: effectiveModel,
              system: fullSystemPrompt,
              messages: modelMessages,
              tools: aiSdkTools,
              abortSignal: signal,
            });

            // Map finishReason → stopReason
            // AI SDK 的 finishReason 是 provider 层概念；项目内部统一成 AssistantMessage.stopReason。
            const stopReason = mapFinishReason(result.finishReason);
            const modelId = result.response?.modelId ?? effectiveModelId;

            // Build AssistantMessage from result
            // 把 AI SDK content part 转成项目内部 AgentMessage。
            // 后续持久化、上下文裁剪、tool-result 回灌都只认这个内部消息格式。
            const assistantContent: AssistantMessage["content"] = [];
            for (const part of result.content) {
              if ((part as any).type === "text") {
                const textPart = part as { type: "text"; text: string };
                if (textPart.text) {
                  assistantContent.push({ type: "text", text: textPart.text });
                }
              } else if ((part as any).type === "reasoning") {
                const reasonPart = part as { type: "reasoning"; text: string };
                if (reasonPart.text) {
                  assistantContent.push({ type: "thinking", thinking: reasonPart.text });
                }
              } else if ((part as any).type === "tool-call") {
                const tcPart = part as unknown as {
                  type: "tool-call";
                  toolCallId: string;
                  toolName: string;
                  input?: unknown;
                  args?: unknown;
                };
                assistantContent.push({
                  type: "toolCall",
                  id: tcPart.toolCallId,
                  name: tcPart.toolName,
                  arguments: normalizeToolArguments(tcPart.input ?? tcPart.args),
                });
              }
            }

            const assistantMsg: AssistantMessage = {
              role: "assistant",
              content: assistantContent,
              timestamp: Date.now(),
              model: modelId,
              stopReason,
              usage: {
                input: result.usage.inputTokens ?? 0,
                output: result.usage.outputTokens ?? 0,
              },
            };

            span.addAttributes({
              inputTokens: result.usage.inputTokens ?? 0,
              outputTokens: result.usage.outputTokens ?? 0,
              stopReason,
              contextTrimLevel: trimResult.trimLevel,
              contextOriginalTokens: trimResult.originalTokens,
              contextTrimmedTokens: trimResult.trimmedTokens,
              contextDroppedMessages: trimResult.droppedMessageCount,
              promptSnapshot: snapshotMessages(trimResult.messages),
              completionSnapshot: snapshotAssistantMessage(assistantMsg),
            });

            return assistantMsg;
          },
        );
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          llmErrorsTotal.inc({ error_type: "aborted" });
          return { status: "aborted" };
        }
        llmErrorsTotal.inc({ error_type: "error" });
        throw error;
      }

      llmLatencyMs.observe({ model: response.model ?? "unknown" }, Date.now() - llmStartedAt);
      if (response.stopReason === "error") {
        llmErrorsTotal.inc({ error_type: response.stopReason });
      }

      workingHistory.push(response);
      callbacks.onMessage(response);

      // 没有 tool-call 就说明这一轮已经产生最终回复，runner 结束，外层 chat.ts 负责提取文本并推送。
      if (response.stopReason !== "toolUse") {
        return { status: "completed", finalMessage: response };
      }

      const toolCalls = response.content.filter(isToolCall);

      // 同一轮模型可能返回多个 tool-call，这里并行执行。
      // 每个结果都会被包装成 toolResult message，再追加回 workingHistory 供下一轮 LLM 继续推理。
      const toolResults = await Promise.all(
        toolCalls.map(async (toolCall) => {
          const toolStartedAt = Date.now();
          try {
            const content = await withSpan(
              "tool.execute",
              { toolName: toolCall.name },
              async (span) => {
                const result =
                  toolCall.name === USE_SKILL_TOOL.name
                    // use_skill 是 runner 特例：它不走 ToolRegistry，而是把技能正文加载进本次 skillRuntime。
                    ? await skillRuntime.execute(
                        typeof toolCall.arguments.skill_name === "string"
                          ? toolCall.arguments.skill_name.trim()
                          : "",
                      )
                    // 普通工具走 composite ToolRegistry，registry 会定位具体 owner 并调用对应 handler。
                    : await tools.execute(
                        toolCall.name,
                        toolCall.arguments,
                        createToolContext(signal, timeoutMs),
                      );

                span.addAttributes({
                  promptSnapshot: sanitize(JSON.stringify(toolCall.arguments, null, 2)),
                  completionSnapshot: sanitize(
                    JSON.stringify(
                      result.map((block) =>
                        block.type === "image"
                          ? { type: "image", data: `[base64:${(block as ImageContent).data.length} chars]` }
                          : block,
                      ),
                      null,
                      2,
                    ),
                  ),
                });

                return result;
              },
            );

            toolCallsTotal.inc({ tool_name: toolCall.name, status: "ok" });
            toolLatencyMs.observe({ tool_name: toolCall.name }, Date.now() - toolStartedAt);

            return buildToolResult(toolCall.id, toolCall.name, content, false);
          } catch (error) {
            toolCallsTotal.inc({ tool_name: toolCall.name, status: "error" });
            toolLatencyMs.observe({ tool_name: toolCall.name }, Date.now() - toolStartedAt);
            return buildToolResult(
              toolCall.id,
              toolCall.name,
              [{ type: "text", text: toErrorText(error) }],
              true,
            );
          }
        }),
      );

      for (const toolResult of toolResults) {
        workingHistory.push(toolResult);
        callbacks.onMessage(toolResult);
      }
    }

    // 走到这里表示连续 tool loop 超过 maxRounds。返回最后一条 assistant，外层决定如何降级回复。
    const lastMessage = [...workingHistory]
      .reverse()
      .find((message): message is AssistantMessage => message.role === "assistant");

    if (!lastMessage) {
      return { status: "aborted" };
    }

    return {
      status: "max_rounds",
      lastMessage,
      rounds: maxRounds,
    };
  }

  return { run };
}

function mapFinishReason(finishReason: string): string {
  switch (finishReason) {
    case "stop": return "stop";
    case "length": return "length";
    case "tool-calls": return "toolUse";
    case "error": return "error";
    case "content-filter": return "error";
    default: return "stop";
  }
}

function createToolContext(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal } {
  return {
    signal: createToolSignal(parentSignal, timeoutMs),
  };
}
