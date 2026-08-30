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
  LanguageModel,
  ModelMeta,
} from "../llm/types.js";
import {
  agentToModelMessages,
  mapModelResultToAssistantMessage,
  replaceImagesWithTextPlaceholders,
  stripUnreasonedToolCallHistory,
} from "../llm/messages.js";
import { modelSupportsVision } from "../llm/model-meta.js";
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
import { estimateTextTokens } from "../llm/token-estimator.js";
import type { CompiledContextV1 } from "../context-compiler/types.js";
import { buildCanonicalRequestDocument } from "../context-compiler/manifest.js";
import { ARTIFACT_KIND } from "../shared/fact-ledger/contracts.js";
import type { RunLedgerRecorder } from "./run-ledger/recorder.js";
import { bootstrapRunLedger, type RunLedgerBootstrapResult } from "./run-ledger/bootstrap.js";
import type { SkillRegistry } from "../capabilities/skills/types.js";
import type { ToolRegistry, ToolContent, ToolContext } from "../capabilities/tools/types.js";
import { toolContextFrom, type RunContext } from "./context.js";
import {
  collectLoadedSkillNames,
  createConversationSkillRuntime,
  type ConversationSkillRuntime,
} from "../capabilities/skills/conversation-runtime.js";
import { assembleSystemPrompt } from "./system-prompt.js";
import { getPromptAssets } from "../prompts/port.js";
import { PROMPT_PROFILES } from "../prompts/profiles.js";

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
    runContext?: RunContext,
    ledger?: RunnerLedger,
  ): Promise<RunResult>;
}

/**
 * Run-ledger wiring for one run (Phase 4 design §5/§9). The recorder and the
 * v2 compile closure are built per turn; the runner owns round-request
 * construction so the manifest's round-1 document and the actual model call
 * come from the same code path (design §9.3).
 */
export interface RunnerLedger {
  recorder: RunLedgerRecorder;
  compileContext: (hints: {
    coverageHints?: { memoryFacts?: boolean; immutableMediaArtifacts?: boolean };
  }) => Promise<CompiledContextV1>;
  effectiveTime: string;
  /** Phase 5：memory watermark / snapshot / summary 的 session branch。 */
  sessionBranch: string;
  /** Phase 5：本 run 的视觉观察制品 ids（turn 层 pin 后传入 manifest）。 */
  visualObservationIds: string[];
}

/** Serialized snapshot of one round's model-visible request (design §8). */
export interface RoundRequestSnapshot {
  round: number;
  system: string;
  messages: AgentMessage[];
  tools: ReadonlyArray<{ name: string; description: string; parameters: unknown }>;
  trim: TrimResult;
  fixedOverheadTokens: number;
}

function safeSerialize(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Single source of the per-round request: system prompt assembly, tool-call
 * history shaping and context-window trim. The runner loop and the manifest
 * bootstrap both go through this function — never duplicate it.
 */
export function buildRoundRequest(input: {
  round: number;
  baseSystemPrompt: string;
  skills: SkillRegistry | undefined;
  workingHistory: AgentMessage[];
  meta: ModelMeta;
  tools: ReadonlyArray<{ name: string; description: string; parameters: unknown }>;
  toolsSchemaTokens: number;
}): RoundRequestSnapshot {
  const fullSystemPrompt = assembleSystemPrompt(
    PROMPT_PROFILES.chat,
    input.baseSystemPrompt,
    input.skills,
  );
  const fixedOverheadTokens = estimateTextTokens(fullSystemPrompt) + input.toolsSchemaTokens;
  const trimResult = fitToContextWindow(buildPromptHistory(input.workingHistory, input.meta), {
    contextWindowTokens: input.meta.contextWindow,
    outputReserveTokens: input.meta.maxOutputTokens,
    fixedOverheadTokens,
  });
  return {
    round: input.round,
    system: fullSystemPrompt,
    messages: trimResult.messages,
    tools: input.tools,
    trim: trimResult,
    fixedOverheadTokens,
  };
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

/** Structural serialization of one agent message for snapshots and artifacts. */
export function serializeMessage(message: AgentMessage): unknown {
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

  if (message.role === MESSAGE_ROLE.TRIGGER) {
    return {
      role: message.role,
      meta: message.meta,
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
    runContext?: RunContext;
  },
): Promise<ToolResultMessage> {
  const { tools, skillRuntime, signal, timeoutMs, runContext } = deps;
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
                createToolContext(signal, timeoutMs, runContext),
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
    runContext?: RunContext,
    ledger?: RunnerLedger,
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
    // change mid-run (use_skill adds prompt text, not tools). So the schema
    // serialization, its token estimate, and the AI SDK tool objects are all
    // built once here rather than per round.
    const currentTools = [...tools.current().tools, USE_SKILL_TOOL];
    const toolsSchemaText = JSON.stringify(
      currentTools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })),
    );
    const toolsSchemaTokens = estimateTextTokens(toolsSchemaText);
    const aiSdkTools = buildAiSdkTools(currentTools);

    // Run-ledger bootstrap (design §9): round-1 request is built here so the
    // manifest document and the actual round-1 call share one code path.
    let ledgerReady = false;
    let manifestId: string | undefined;
    let round1RequestArtifactId: string | undefined;
    let modelRevisionId: string | undefined;
    let toolRevisionIds = new Map<string, string>();
    let precomputedRound1: RoundRequestSnapshot | undefined;
    let requestDocFor: ((request: RoundRequestSnapshot) => unknown) | undefined;
    let pinSkillRevision: ((name: string) => Promise<string | null>) | undefined;

    if (ledger && !ledger.recorder.isDegraded()) {
      precomputedRound1 = buildRoundRequest({
        round: 1,
        baseSystemPrompt,
        skills,
        workingHistory,
        meta: effectiveMeta,
        tools: currentTools,
        toolsSchemaTokens,
      });
      const collectSkillInputs = () => {
        const inputs = new Map<string, { name: string; version?: string; body: string }>();
        for (const skill of skills.current().alwaysOn) {
          inputs.set(skill.name, { name: skill.name, body: skill.body });
        }
        for (const name of new Set([
          ...collectLoadedSkillNames(workingHistory),
          ...skillRuntime.loadedSkillNames(),
        ])) {
          if (inputs.has(name)) continue;
          const compiled = skills.getOnDemandSkill(name);
          if (compiled) {
            inputs.set(compiled.source.name, {
              name: compiled.source.name,
              version: compiled.source.version,
              body: compiled.source.body,
            });
          }
        }
        return [...inputs.values()];
      };
      pinSkillRevision = async (name: string): Promise<string | null> => {
        const compiled = skills.getOnDemandSkill(name);
        if (!compiled) return null;
        const artifact = await ledger.recorder.putArtifact(ARTIFACT_KIND.SKILL_REVISION, {
          name: compiled.source.name,
          version: compiled.source.version,
          body: compiled.source.body,
        });
        return artifact?.artifactId ?? null;
      };
      requestDocFor = (request: RoundRequestSnapshot) =>
        buildCanonicalRequestDocument({
          runId: ledger.recorder.runId,
          round: request.round,
          modelRevisionId: modelRevisionId ?? "unknown",
          system: request.system,
          messages: request.trim.messages.map(serializeMessage),
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: safeSerialize(tool.parameters),
          })),
          trim: {
            trimLevel: request.trim.trimLevel,
            originalTokens: request.trim.originalTokens,
            trimmedTokens: request.trim.trimmedTokens,
            droppedMessages: request.trim.droppedMessageCount,
            fixedOverheadTokens: request.fixedOverheadTokens,
          },
        });

      let bootstrap: RunLedgerBootstrapResult;
      try {
        bootstrap = await bootstrapRunLedger({
          recorder: ledger.recorder,
          compileContext: ledger.compileContext,
          sessionBranch: ledger.sessionBranch,
          visualObservationIds: ledger.visualObservationIds,
          round1Request: {
            round: 1,
            system: precomputedRound1.system,
            messages: precomputedRound1.trim.messages.map(serializeMessage),
            tools: precomputedRound1.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              parameters: safeSerialize(tool.parameters),
            })),
            trim: {
              trimLevel: precomputedRound1.trim.trimLevel,
              originalTokens: precomputedRound1.trim.originalTokens,
              trimmedTokens: precomputedRound1.trim.trimmedTokens,
              droppedMessages: precomputedRound1.trim.droppedMessageCount,
              fixedOverheadTokens: precomputedRound1.fixedOverheadTokens,
            },
          },
          prompt: { key: PROMPT_PROFILES.chat.systemPromptKey, body: baseSystemPrompt },
          skills: collectSkillInputs(),
          tools: currentTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: safeSerialize(tool.parameters),
          })),
          model: {
            modelId: effectiveModelId,
            purpose: "chat",
            contextWindow: effectiveMeta.contextWindow,
            maxOutputTokens: effectiveMeta.maxOutputTokens,
            supportsImageInput: effectiveMeta.supportsImageInput,
            requiresReasonedToolHistory: effectiveMeta.requiresReasonedToolHistory,
          },
          effectiveTime: ledger.effectiveTime,
        });
      } catch (error) {
        ledger.recorder.degrade(error, "bootstrap");
        bootstrap = { ready: false, toolRevisionIds: new Map() };
      }
      ledgerReady = bootstrap.ready;
      manifestId = bootstrap.manifestId;
      round1RequestArtifactId = bootstrap.round1RequestArtifactId;
      modelRevisionId = bootstrap.modelRevisionId;
      toolRevisionIds = bootstrap.toolRevisionIds;
    }

    for (let round = 1; round <= maxRounds; round += 1) {
      if (signal?.aborted) {
        return { status: "aborted" };
      }

      callbacks.onRoundStart?.(round);

      // system prompt 每轮重新 assemble，是因为 on-demand skill 可能在上一轮被 use_skill 加载，
      // 下一轮就需要把新技能正文注入 system prompt。Round 1 reuses the manifest's precomputed
      // request so the ledger document and the actual call cannot diverge.
      const request =
        round === 1 && precomputedRound1
          ? precomputedRound1
          : buildRoundRequest({
              round,
              baseSystemPrompt,
              skills,
              workingHistory,
              meta: effectiveMeta,
              tools: currentTools,
              toolsSchemaTokens,
            });
      recordTrimMetrics(request.trim);

      if (ledger && ledgerReady && manifestId) {
        ledger.recorder.recordModelCallStarted({
          round,
          manifestId,
          ...(round === 1 && round1RequestArtifactId
            ? { requestArtifactId: round1RequestArtifactId }
            : { requestDoc: requestDocFor!(request) }),
        });
      }

      const llmStartedAt = Date.now();
      let response: AssistantMessage;
      try {
        response = await callModel({
          model: effectiveModel,
          modelId: effectiveModelId,
          system: request.system,
          messages: agentToModelMessages(request.trim.messages),
          tools: aiSdkTools,
          signal,
          round,
          trimResult: request.trim,
          maxRetries,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          llmErrorsTotal.inc({ error_type: "aborted" });
          return { status: "aborted" };
        }
        llmErrorsTotal.inc({ error_type: "error" });
        ledger?.recorder.recordModelCallFailed({ round, error });
        throw error;
      }

      ledger?.recorder.recordModelCallCompleted({
        round,
        stopReason: response.stopReason ?? MESSAGE_STOP_REASON.STOP,
        responseDoc: serializeMessage(response),
      });

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
        toolCalls.map(async (toolCall) => {
          const toolRevisionId = toolRevisionIds.get(toolCall.name);
          if (ledger && ledgerReady) {
            if (toolRevisionId === undefined) {
              // Unpinned tool revision is an internal wiring bug — degrade the
              // ledger run instead of writing an event with a fabricated id.
              ledger.recorder.degrade(new Error("tool_revision_unpinned"), `tool:${toolCall.name}`);
            } else {
              ledger.recorder.recordToolCallRequested({
                round,
                toolCallId: toolCall.id,
                toolName: toolCall.name,
                toolRevisionId,
                argumentsDoc: safeSerialize(toolCall.arguments),
              });
            }
          }

          const result = await executeToolCall(toolCall, { tools, skillRuntime, signal, timeoutMs, runContext });

          if (ledger && ledgerReady) {
            const resultDoc = serializeMessage(result);
            if (result.isError) {
              ledger.recorder.recordToolCallFailed({
                toolCallId: toolCall.id,
                resultDoc,
                error: new Error("tool_execution_failed"),
              });
            } else {
              ledger.recorder.recordToolCallCompleted({ toolCallId: toolCall.id, resultDoc });
              if (toolCall.name === USE_SKILL_TOOL.name) {
                ledger.recorder.recordSkillLoaded({
                  round,
                  skillName:
                    typeof toolCall.arguments.skill_name === "string"
                      ? toolCall.arguments.skill_name.trim()
                      : "",
                  causationToolCallId: toolCall.id,
                  pinSkillRevision: pinSkillRevision!,
                });
              }
            }
          }
          return result;
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

/**
 * Build the per-tool-call context. The signal here is the *tool's* — timeout
 * composed with the run's — so it must never be replaced by the run signal.
 * `toolContextFrom()` maps RunContext field-by-field for exactly that reason:
 * spreading RunContext instead would let its own `signal` (present-but-undefined
 * on non-scheduler runs) clobber the timeout and silently disable it.
 */
function createToolContext(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  runContext?: RunContext,
): ToolContext {
  const signal = createToolSignal(parentSignal, timeoutMs);
  return runContext ? toolContextFrom(runContext, signal) : { signal };
}
