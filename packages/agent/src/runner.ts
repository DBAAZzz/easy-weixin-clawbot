import {
  complete,
  type AssistantMessage,
  type ImageContent,
  type Message,
  type Model,
  type Tool,
  type ToolCall,
  type ToolResultMessage,
  Type,
} from "@mariozechner/pi-ai";
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

export interface AgentConfig {
  model: Model<any>;
  systemPrompt: string;
  apiKey?: string;
  maxRounds?: number;
  toolTimeoutMs?: number;
  maxOnDemandSkills?: number;
}

export interface ModelOverride {
  model: Model<any>;
  apiKey?: string;
}

export interface RunCallbacks {
  onMessage(msg: Message): void;
  onRoundStart?(round: number): void;
}

export type RunResult =
  | { status: "completed"; finalMessage: AssistantMessage }
  | { status: "max_rounds"; lastMessage: AssistantMessage; rounds: number }
  | { status: "aborted" };

export interface AgentRunner {
  run(
    messages: Message[],
    callbacks: RunCallbacks,
    signal?: AbortSignal,
    modelOverride?: ModelOverride,
  ): Promise<RunResult>;
}

function isToolCall(block: AssistantMessage["content"][number]): block is ToolCall {
  return block.type === "toolCall";
}

function createToolSignal(parentSignal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (parentSignal) {
    signals.push(parentSignal);
  }
  return AbortSignal.any(signals);
}

const USE_SKILL_TOOL: Tool = {
  name: "use_skill",
  description: "加载一个技能到当前对话。加载后，你将获得该技能的完整指令，按指令完成用户任务。",
  parameters: Type.Object({
    skill_name: Type.String({
      description: "要加载的技能名称",
    }),
  }),
};

function toErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  return String(error);
}

function serializeMessage(message: Message): unknown {
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

function snapshotMessages(messages: Message[]): string {
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

function buildSystemPrompt(basePrompt: string, skills: SkillRegistry): string {
  const snapshot = skills.current();
  let systemPrompt = basePrompt;

  for (const skill of snapshot.alwaysOn) {
    systemPrompt += `\n\n[Skill: ${skill.name}]\n${skill.body}`;
  }

  if (snapshot.index.length > 0) {
    systemPrompt += "\n\n你有以下可用技能，需要时调用 use_skill 加载：";
    for (const skill of snapshot.index) {
      systemPrompt += `\n- ${skill.name}: ${skill.summary}`;
    }
  }

  return systemPrompt;
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
  async function run(
    messages: Message[],
    callbacks: RunCallbacks,
    signal?: AbortSignal,
    modelOverride?: ModelOverride,
  ): Promise<RunResult> {
    const effectiveModel = modelOverride?.model ?? config.model;
    const effectiveApiKey = modelOverride?.apiKey ?? config.apiKey;
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
      const fullSystemPrompt = buildSystemPrompt(config.systemPrompt, skills);
      const currentTools = [...tools.current().tools, USE_SKILL_TOOL];
      const toolsSchemaText = JSON.stringify(currentTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })));
      const fixedOverheadTokens = estimateTextTokens(fullSystemPrompt) + estimateTextTokens(toolsSchemaText);

      const trimResult = fitToContextWindow(workingHistory, {
        contextWindowTokens: effectiveModel.contextWindow,
        outputReserveTokens: effectiveModel.maxTokens,
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

      const llmStartedAt = Date.now();
      let response: AssistantMessage;
      try {
        response = await withSpan(
          "llm.call",
          { model: effectiveModel.id, round },
          async (span) => {
            const result = await complete(
              effectiveModel,
              {
                systemPrompt: fullSystemPrompt,
                messages: trimResult.messages,
                tools: currentTools,
              },
              effectiveApiKey ? { apiKey: effectiveApiKey, signal } : { signal },
            );

            span.addAttributes({
              inputTokens: result.usage.input,
              outputTokens: result.usage.output,
              stopReason: result.stopReason,
              contextTrimLevel: trimResult.trimLevel,
              contextOriginalTokens: trimResult.originalTokens,
              contextTrimmedTokens: trimResult.trimmedTokens,
              contextDroppedMessages: trimResult.droppedMessageCount,
              promptSnapshot: snapshotMessages(trimResult.messages),
              completionSnapshot: snapshotAssistantMessage(result),
            });

            return result;
          },
        );
      } catch (error) {
        llmErrorsTotal.inc({
          error_type:
            error instanceof Error && error.name === "AbortError" ? "aborted" : "error",
        });
        throw error;
      }

      llmLatencyMs.observe({ model: response.model }, Date.now() - llmStartedAt);
      if (response.stopReason === "error" || response.stopReason === "aborted") {
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
                          ? { type: "image", data: `[base64:${block.data.length} chars]` }
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

function createToolContext(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal } {
  return {
    signal: createToolSignal(parentSignal, timeoutMs),
  };
}
