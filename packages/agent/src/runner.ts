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
  model: LanguageModel;
  meta: ModelMeta;
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
    const effectiveModelId = typeof effectiveModel === "string" ? effectiveModel : (effectiveModel as { modelId: string }).modelId;
    const maxRounds = config.maxRounds ?? 10;
    const timeoutMs = config.toolTimeoutMs ?? 30_000;
    const workingHistory = [...messages];
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
      const fullSystemPrompt = assembleSystemPrompt(PROMPT_PROFILES.chat, baseSystemPrompt, skills);
      const currentTools = [...tools.current().tools, USE_SKILL_TOOL];
      const toolsSchemaText = JSON.stringify(currentTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })));
      const fixedOverheadTokens = estimateTextTokens(fullSystemPrompt) + estimateTextTokens(toolsSchemaText);

      const promptHistory = (() => {
        let history = isDeepSeekModel(effectiveModel, effectiveModelId)
          ? stripUnreasonedToolCallHistory(workingHistory)
          : workingHistory;

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
            const stopReason = mapFinishReason(result.finishReason);
            const modelId = result.response?.modelId ?? effectiveModelId;

            // Build AssistantMessage from result
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

      if (response.stopReason !== "toolUse") {
        return { status: "completed", finalMessage: response };
      }

      const toolCalls = response.content.filter(isToolCall);

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
                    ? await skillRuntime.execute(
                        typeof toolCall.arguments.skill_name === "string"
                          ? toolCall.arguments.skill_name.trim()
                          : "",
                      )
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
