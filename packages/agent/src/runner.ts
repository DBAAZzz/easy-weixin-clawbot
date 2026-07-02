import { generateText, tool as aiTool } from "ai";
import { z } from "zod";
import {
  MESSAGE_CONTENT_TYPE,
  MESSAGE_ROLE,
  MESSAGE_STOP_REASON,
} from "@clawbot/shared";
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
  mapModelResultToAssistantMessage,
  replaceImagesWithTextPlaceholders,
  stripUnreasonedToolCallHistory,
} from "./llm/messages.js";
import { modelSupportsVision } from "./llm/model-meta.js";
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
  type ConversationSkillRuntime,
} from "./runtime/skill-runtime.js";
import { assembleSystemPrompt } from "./prompts/assembler.js";
import { getPromptAssets } from "./prompts/port.js";
import { PROMPT_PROFILES } from "./prompts/profiles.js";

/**
 * Per-LLM-call 重试次数（不含首次）。AI SDK 在此基础上做指数退避
 * （初始 2s → 4s …），且只对可重试错误（429/408/5xx/网络）重试，并尊重
 * 响应头里的 `Retry-After`。聊天场景下用户在线等待，调大会显著拉长尾延迟，
 * 故默认与 SDK 一致取 2；批处理/后台任务可按需调高。
 */
const DEFAULT_LLM_MAX_RETRIES = 2;

export interface AgentConfig {
  model?: LanguageModel;
  meta?: ModelMeta;
  systemPrompt?: string;
  apiKey?: string;
  maxRounds?: number;
  toolTimeoutMs?: number;
  maxOnDemandSkills?: number;
  /** 单次模型调用的重试次数（不含首次）。默认 {@link DEFAULT_LLM_MAX_RETRIES}。 */
  maxRetries?: number;
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
  return block.type === MESSAGE_CONTENT_TYPE.TOOL_CALL;
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

function serializeMessage(message: AgentMessage): unknown {
  if (message.role === MESSAGE_ROLE.USER) {
    return {
      role: message.role,
      timestamp: message.timestamp,
      visualContext: message.visualContext,
      content:
        typeof message.content === "string"
          ? message.content
          : message.content.map((block) => {
              if (block.type === MESSAGE_CONTENT_TYPE.IMAGE) {
                return {
                  type: MESSAGE_CONTENT_TYPE.IMAGE,
                  mimeType: block.mimeType,
                  data: `[base64:${block.data.length} chars]`,
                } satisfies ImageContent;
              }
              return block;
            }),
    };
  }

  if (message.role === MESSAGE_ROLE.ASSISTANT) {
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
      block.type === MESSAGE_CONTENT_TYPE.IMAGE
        ? {
            type: MESSAGE_CONTENT_TYPE.IMAGE,
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

function buildToolResult(
  toolCallId: string,
  toolName: string,
  content: ToolContent[],
  isError: boolean,
): ToolResultMessage {
  return {
    role: MESSAGE_ROLE.TOOL_RESULT,
    toolCallId,
    toolName,
    content,
    isError,
    timestamp: Date.now(),
  };
}

/** Resolve the model/meta/id to use for a run, preferring per-run override. */
function resolveEffectiveModel(
  config: AgentConfig,
  modelOverride: ModelOverride | undefined,
): { model: LanguageModel; meta: ModelMeta; modelId: string } {
  const model = modelOverride?.model ?? config.model;
  const meta = modelOverride?.meta ?? config.meta;
  if (!model || !meta) {
    throw new Error(
      "AgentRunner model not provided — pass modelOverride at run() time or configure a default model.",
    );
  }
  const modelId =
    typeof model === "string"
      ? model
      : ((model as Record<string, unknown>).modelId as string) ?? "unknown";
  return { model, meta, modelId };
}

/**
 * Build the per-round message list sent to the model: strip unreasoned tool
 * history when required, and drop images for non-vision models. The original
 * `workingHistory` (and DB) is never mutated — trimming only affects the copy.
 */
function buildPromptHistory(workingHistory: AgentMessage[], meta: ModelMeta): AgentMessage[] {
  let history = meta.requiresReasonedToolHistory
    ? stripUnreasonedToolCallHistory(workingHistory)
    : workingHistory;

  if (!modelSupportsVision(meta)) {
    history = replaceImagesWithTextPlaceholders(history);
  }

  return history;
}

function recordTrimMetrics(trimResult: TrimResult): void {
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
}

/** Build AI SDK tool descriptors (schema only — execution is handled locally). */
function buildAiSdkTools(
  toolDefs: ReadonlyArray<{ name: string; description: string; parameters: unknown }>,
): Record<string, ReturnType<typeof aiTool>> {
  const aiSdkTools: Record<string, ReturnType<typeof aiTool>> = {};
  for (const t of toolDefs) {
    // 这里传给 AI SDK 的只有工具说明和入参 schema，没有 execute。
    // 项目自己在下方解析 tool-call 后调用 registry/skillRuntime 执行，方便统一埋点、超时和错误回灌。
    aiSdkTools[t.name] = aiTool({
      description: t.description,
      inputSchema: t.parameters as any,
    });
  }
  return aiSdkTools;
}

/** One LLM round: call the model, map the result, and record span attributes. */
async function callModel(params: {
  model: LanguageModel;
  modelId: string;
  system: string;
  messages: ReturnType<typeof agentToModelMessages>;
  tools: Record<string, ReturnType<typeof aiTool>>;
  signal: AbortSignal | undefined;
  round: number;
  trimResult: TrimResult;
  maxRetries: number;
}): Promise<AssistantMessage> {
  const { model, modelId, system, messages, tools, signal, round, trimResult, maxRetries } = params;

  return withSpan("llm.call", { model: modelId, round }, async (span) => {
    const result = await generateText({
      model,
      system,
      messages,
      tools,
      abortSignal: signal,
      maxRetries,
    });

    const assistantMsg = mapModelResultToAssistantMessage(result, modelId);

    span.addAttributes({
      inputTokens: result.usage.inputTokens ?? 0,
      outputTokens: result.usage.outputTokens ?? 0,
      stopReason: assistantMsg.stopReason ?? MESSAGE_STOP_REASON.STOP,
      contextTrimLevel: trimResult.trimLevel,
      contextOriginalTokens: trimResult.originalTokens,
      contextTrimmedTokens: trimResult.trimmedTokens,
      contextDroppedMessages: trimResult.droppedMessageCount,
      promptSnapshot: snapshotMessages(trimResult.messages),
      completionSnapshot: snapshotAssistantMessage(assistantMsg),
    });

    return assistantMsg;
  });
}

/**
 * Execute a single tool call and wrap the outcome as a ToolResultMessage.
 *
 * `use_skill` is the one runner built-in that does not go through the
 * ToolRegistry: it loads a skill body into the run-scoped skillRuntime (which
 * affects later rounds' system prompt) rather than returning normal tool output.
 * Errors are caught and surfaced back to the model as an error tool result.
 */
async function executeToolCall(
  toolCall: ToolCallContent,
  deps: {
    tools: ToolRegistry;
    skillRuntime: ConversationSkillRuntime;
    signal: AbortSignal | undefined;
    timeoutMs: number;
  },
): Promise<ToolResultMessage> {
  const { tools, skillRuntime, signal, timeoutMs } = deps;
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
                block.type === MESSAGE_CONTENT_TYPE.IMAGE
                  ? { type: MESSAGE_CONTENT_TYPE.IMAGE, data: `[base64:${(block as ImageContent).data.length} chars]` }
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
      [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: toErrorText(error) }],
      true,
    );
  }
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
    const { model: effectiveModel, meta: effectiveMeta, modelId: effectiveModelId } =
      resolveEffectiveModel(config, modelOverride);
    const maxRounds = config.maxRounds ?? 10;
    const timeoutMs = config.toolTimeoutMs ?? 30_000;
    const maxRetries = config.maxRetries ?? DEFAULT_LLM_MAX_RETRIES;
    const workingHistory = [...messages];
    // 每次 run 都创建一个"本次对话作用域"的 skill runtime。
    // 它会从历史里恢复已经 use_skill 加载过的技能，避免多轮工具调用后丢失已加载技能上下文。
    const skillRuntime = createConversationSkillRuntime({
      registry: skills,
      maxOnDemandSkills: config.maxOnDemandSkills,
      initiallyLoadedSkills: collectLoadedSkillNames(workingHistory),
    });

    // Tools list is stable across iterations — the composite registry doesn't
    // change mid-run (use_skill adds prompt text, not tools).  Serialize once.
    const currentTools = [...tools.current().tools, USE_SKILL_TOOL];
    const toolsSchemaText = JSON.stringify(
      currentTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
    );
    const toolsSchemaTokens = estimateTextTokens(toolsSchemaText);

    for (let round = 1; round <= maxRounds; round += 1) {
      if (signal?.aborted) {
        return { status: "aborted" };
      }

      callbacks.onRoundStart?.(round);

      // system prompt 每轮重新 assemble，是因为 on-demand skill 可能在上一轮被 use_skill 加载，
      // 下一轮就需要把新技能正文注入 system prompt。
      const fullSystemPrompt = assembleSystemPrompt(PROMPT_PROFILES.chat, baseSystemPrompt, skills);
      const fixedOverheadTokens = estimateTextTokens(fullSystemPrompt) + toolsSchemaTokens;

      const trimResult = fitToContextWindow(buildPromptHistory(workingHistory, effectiveMeta), {
        contextWindowTokens: effectiveMeta.contextWindow,
        outputReserveTokens: effectiveMeta.maxOutputTokens,
        fixedOverheadTokens,
      });
      recordTrimMetrics(trimResult);

      const llmStartedAt = Date.now();
      let response: AssistantMessage;
      try {
        response = await callModel({
          model: effectiveModel,
          modelId: effectiveModelId,
          system: fullSystemPrompt,
          messages: agentToModelMessages(trimResult.messages),
          tools: buildAiSdkTools(currentTools),
          signal,
          round,
          trimResult,
          maxRetries,
        });
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
      if (response.stopReason !== MESSAGE_STOP_REASON.TOOL_USE) {
        return { status: "completed", finalMessage: response };
      }

      const toolCalls = response.content.filter(isToolCall);

      // 同一轮模型可能返回多个 tool-call，这里并行执行。
      // 每个结果都会被包装成 toolResult message，再追加回 workingHistory 供下一轮 LLM 继续推理。
      const toolResults = await Promise.all(
        toolCalls.map((toolCall) =>
          executeToolCall(toolCall, { tools, skillRuntime, signal, timeoutMs }),
        ),
      );

      for (const toolResult of toolResults) {
        workingHistory.push(toolResult);
        callbacks.onMessage(toolResult);
      }
    }

    // 走到这里表示连续 tool loop 超过 maxRounds。返回最后一条 assistant，外层决定如何降级回复。
    const lastMessage = [...workingHistory]
      .reverse()
      .find((message): message is AssistantMessage => message.role === MESSAGE_ROLE.ASSISTANT);

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
