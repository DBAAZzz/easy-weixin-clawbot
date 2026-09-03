/**
 * Server-side implementation of ChatExecutorPort.
 *
 * Wraps ChatEngine.chat() with conversations.withLock() to ensure proper
 * locking. Shared by both the scheduler and heartbeat capabilities — the
 * request's runKind determines which one's calling.
 *
 * Phase 6 (design §5.1): when the account's run-ledger rollout is enabled and
 * the request carries a triggerIdentity, the turn runs as a ledgered trigger
 * run — deterministic runId, run_started anchored at the execution stream's
 * current head seq, compile closure on policy v3. The resulting runId is
 * returned so the calling engine can append outbound delivery facts (§5.2).
 */

import type {
  ArtifactContentSink,
  ChatEngine,
  ChatExecutionRequest,
  ChatExecutionResult,
  ChatExecutorPort,
  CompiledContextV1,
  ContextCompilerV1,
  RunContext,
} from "@clawbot/agent";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID_V3,
  CONTEXT_TIMEZONE,
  createRunLedgerRecorder,
  createTriggerRunId,
  getAgentRunStore,
  getArtifactRevisionStore,
  getConversationEventStore,
} from "@clawbot/agent";
import { RunLedgerRolloutStore } from "./run-ledger-rollout-store.js";
import { runLedgerMetrics } from "./fact-ledger-runtime.js";
import { createModuleLogger, getErrorFields } from "../logger.js";

const logger = createModuleLogger("chat-executor");

export interface ChatExecutorDeps {
  /** Account-agnostic policy-v3 compiler (createServerRunLedgerCompiler). */
  compiler: ContextCompilerV1;
  /** Reads MEDIA_ASSET bytes back for canonical media replay / artifact texts. */
  contentSink: ArtifactContentSink;
  rolloutStore?: RunLedgerRolloutStore;
}

export function createChatExecutor(chatEngine: ChatEngine, deps: ChatExecutorDeps): ChatExecutorPort {
  const rolloutStore = deps.rolloutStore ?? new RunLedgerRolloutStore();
  return {
    async execute(req: ChatExecutionRequest): Promise<ChatExecutionResult> {
      return chatEngine.conversations.withLock(req.accountId, req.conversationId, async () => {
        try {
          const startedAt = Date.now();
          const effectiveTime = new Date(startedAt).toISOString();
          const ctx: RunContext = {
            accountId: req.accountId,
            conversationId: req.conversationId,
            targetConversationId: req.targetConversationId ?? req.conversationId,
            runKind: req.runKind,
            signal: req.signal,
          };

          // Rollout 关闭或无 triggerIdentity → Phase 5 行为（不构造 ledger）。
          const ledgerEnabled =
            req.triggerIdentity !== undefined && (await rolloutStore.isEnabled(req.accountId));
          const readPath = ledgerEnabled ? await rolloutStore.readPath(req.accountId) : "legacy";

          let anchorStreamSeq: number | undefined;
          let runId: string | undefined;
          let runLedger:
            | {
                recorder: ReturnType<typeof createRunLedgerRecorder>;
                compileContext: (hints: {
                  coverageHints?: { memoryFacts?: boolean; immutableMediaArtifacts?: boolean };
                }) => Promise<CompiledContextV1>;
                conversationStreamId: string;
                sourceEventId?: string;
                anchorStreamSeq?: number;
                contentSink?: ArtifactContentSink;
              }
            | undefined;
          if (ledgerEnabled && req.triggerIdentity) {
            runId = createTriggerRunId(
              req.accountId,
              req.triggerIdentity.source,
              req.triggerIdentity.entityId,
              req.triggerIdentity.fireAtISO,
            );
            anchorStreamSeq = await getConversationEventStore().getStreamHeadSeq(
              req.accountId,
              req.conversationId,
            );
            const recorder = createRunLedgerRecorder({
              agentRunStore: getAgentRunStore(),
              artifactRevisionStore: getArtifactRevisionStore(),
              contentSink: deps.contentSink,
              accountId: req.accountId,
              runId,
              metrics: runLedgerMetrics,
              onError(fields) {
                logger.warn({ ...getErrorFields(fields), accountId: req.accountId }, "run ledger degraded");
              },
            });
            runLedger = {
              recorder,
              compileContext: (hints) =>
                deps.compiler.compile({
                  accountId: req.accountId,
                  conversationStreamId: req.conversationId,
                  // 空执行流（如 scheduler 会话首轮）→ cursor 0（空窗口合法）。
                  eventCursor: anchorStreamSeq ?? 0,
                  compilerVersion: CONTEXT_COMPILER_VERSION,
                  contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V3,
                  effectiveTime,
                  timezone: CONTEXT_TIMEZONE,
                  ...(hints.coverageHints ? { coverageHints: hints.coverageHints } : {}),
                }),
              conversationStreamId: req.conversationId,
              anchorStreamSeq,
              contentSink: deps.contentSink,
            };
          }

          const result = await chatEngine.chat(ctx, {
            text: req.prompt,
            inputRole: req.inputRole,
            triggerMeta: req.triggerMeta,
            ...(runLedger ? { runLedger } : {}),
            ...(readPath !== "legacy" ? { contextReadPath: readPath } : {}),
          });
          if (runLedger) {
            // Trigger runs have no ingress settle path to drain the FIFO; give
            // the engine's direct delivery-fact writes a stable "after
            // everything" position before returning the runId (§5.2).
            await runLedger.recorder.drain();
          }
          return {
            text: result.text,
            status: "completed" as const,
            ...(runId !== undefined ? { runId } : {}),
          };
        } catch (err) {
          return { status: "error" as const, error: (err as Error).message };
        }
      });
    },
  };
}
