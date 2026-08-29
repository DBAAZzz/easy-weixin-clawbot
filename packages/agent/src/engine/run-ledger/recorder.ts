import type { AgentRunStore } from "../../ports/agent-run-store.js";
import type { ArtifactRevisionStore } from "../../ports/artifact-revision-store.js";
import type { ArtifactContentSink } from "../../ports/artifact-content-sink.js";
import {
  AGENT_RUN_EVENT_TYPE,
  ARTIFACT_KIND,
  type AppendAgentRunEventInput,
  type ArtifactKind,
} from "../../shared/fact-ledger/contracts.js";
import { createCallId, createRunEventId, toStableErrorCode } from "./ids.js";
import { putDocumentArtifact, type ArtifactPutterDeps } from "./revisions.js";

export interface RunLedgerMetrics {
  total(result: "success" | "degraded"): void;
  event(eventType: string): void;
  inlineLatencyMs(duration: number): void;
  artifactPut(kind: string, result: "appended" | "reused" | "failed"): void;
  manifest(result: "success" | "failed"): void;
}

export interface RunLedgerRecorderOptions {
  agentRunStore: AgentRunStore;
  artifactRevisionStore?: ArtifactRevisionStore;
  contentSink?: ArtifactContentSink;
  accountId: string;
  runId: string;
  metrics?: RunLedgerMetrics;
  onError?: (fields: { runId: string; errorCode: string; context: string }) => void;
  now?: () => number;
}

export interface RunStartInput {
  conversationStreamId: string;
  sourceEventId: string;
  occurredAt: string;
}

/**
 * Per-run serialized write path for Agent Run Events (Phase 4 design §5).
 *
 * All writes go through one FIFO queue so awaited (inline) and queued writes
 * share a single total order; the store assigns `runSeq`. Any failure degrades
 * the run: pending work is dropped, a best-effort `run_interrupted{ledger_degraded}`
 * terminal marker is appended, and production is never affected (fail-open).
 */
export interface RunLedgerRecorder {
  readonly runId: string;
  readonly accountId: string;
  start(input: RunStartInput): Promise<boolean>;
  isDegraded(): boolean;
  /** Force degradation from outside (bootstrap wiring bugs). Idempotent. */
  degrade(error: unknown, context: string): void;
  /** Serialized bootstrap write; resolves undefined once the run is degraded. */
  enqueueWrite<T>(task: () => Promise<T>): Promise<T | undefined>;
  /**
   * Direct (non-queued) content-addressed artifact put. Only call from inside
   * `enqueueWrite` tasks or before enqueueing an event that references the id.
   */
  putArtifact(
    kind: ArtifactKind,
    document: unknown,
    options?: { artifactId?: string },
  ): Promise<{ artifactId: string; sha256: string } | undefined>;
  recordContextCompiled(manifestId: string): Promise<boolean>;
  recordModelCallStarted(input: {
    round: number;
    manifestId: string;
    /** Round 1 reuses the manifest's round-1 request artifact. */
    requestArtifactId?: string;
    /** Rounds 2+ carry their own serialized request document. */
    requestDoc?: unknown;
  }): void;
  recordModelCallCompleted(input: { round: number; stopReason: string; responseDoc: unknown }): void;
  recordModelCallFailed(input: { round: number; error: unknown }): void;
  recordToolCallRequested(input: {
    round: number;
    toolCallId: string;
    toolName: string;
    toolRevisionId: string;
    argumentsDoc: unknown;
  }): void;
  recordToolCallCompleted(input: { toolCallId: string; resultDoc: unknown }): void;
  recordToolCallFailed(input: { toolCallId: string; resultDoc: unknown; error: unknown }): void;
  recordSkillLoaded(input: {
    round: number;
    skillName: string;
    causationToolCallId: string;
    pinSkillRevision: (name: string) => Promise<string | null>;
  }): void;
  finishCompleted(input: { rounds: number; finalResponseArtifactId?: string }): Promise<boolean>;
  finishInterrupted(input: { reason: string }): Promise<boolean>;
  recordDeliveryRequested(input: { deliveryId: string }): Promise<boolean>;
  getFinalResponseArtifactId(): string | undefined;
  drain(): Promise<void>;
}

export function createRunLedgerRecorder(options: RunLedgerRecorderOptions): RunLedgerRecorder {
  const now = options.now ?? Date.now;
  const putter: ArtifactPutterDeps | undefined = options.artifactRevisionStore
    ? {
        artifactRevisionStore: options.artifactRevisionStore,
        contentSink: options.contentSink,
        onPut: (kind, result) => options.metrics?.artifactPut(kind, result),
      }
    : undefined;

  let stream: { conversationStreamId: string; sourceEventId: string } | undefined;
  let degraded = false;
  let lastResponseArtifactId: string | undefined;
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T | undefined> {
    const result = tail.then(() => (degraded ? undefined : task()));
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /**
   * Queue a task that must run even after degradation (the terminal marker),
   * strictly serialized behind everything already enqueued.
   */
  function enqueueForce<T>(task: () => Promise<T>): Promise<T> {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function degrade(error: unknown, context: string): void {
    if (degraded) return;
    degraded = true;
    options.metrics?.total("degraded");
    options.onError?.({ runId: options.runId, errorCode: toStableErrorCode(error), context });
    // Best-effort terminal marker (design §5.5): distinguishes in-process
    // ledger degradation from crash-level zombie runs. It rides the same FIFO
    // tail (forced past the degraded gate) so it can never interleave with an
    // in-flight write.
    if (stream) {
      void enqueueForce(async () => {
        try {
          await options.agentRunStore.append({
            eventType: AGENT_RUN_EVENT_TYPE.RUN_INTERRUPTED,
            schemaVersion: 1,
            accountId: options.accountId,
            conversationStreamId: stream!.conversationStreamId,
            runId: options.runId,
            occurredAt: new Date(now()).toISOString(),
            causationId: stream!.sourceEventId,
            correlationId: stream!.sourceEventId,
            eventId: createRunEventId(
              options.accountId,
              options.runId,
              AGENT_RUN_EVENT_TYPE.RUN_INTERRUPTED,
              "ledger_degraded",
            ),
            payload: { reason: "ledger_degraded" },
          });
          options.metrics?.event(AGENT_RUN_EVENT_TYPE.RUN_INTERRUPTED);
        } catch {
          // The marker is best-effort; failure leaves a zombie run for
          // reconciliation, which is exactly the crash-level signal.
        }
      });
    }
  }

  function appendEvent(
    kind: (typeof AGENT_RUN_EVENT_TYPE)[keyof typeof AGENT_RUN_EVENT_TYPE],
    localKey: string,
    payload: unknown,
    opts: { causationId: string; occurredAt?: string },
  ): Promise<boolean> {
    if (!stream) return Promise.resolve(false);
    const input = {
      eventType: kind,
      schemaVersion: 1,
      accountId: options.accountId,
      conversationStreamId: stream.conversationStreamId,
      runId: options.runId,
      occurredAt: opts.occurredAt ?? new Date(now()).toISOString(),
      causationId: opts.causationId,
      correlationId: stream.sourceEventId,
      eventId: createRunEventId(options.accountId, options.runId, kind, localKey),
      payload,
    } as AppendAgentRunEventInput;
    return options.agentRunStore
      .append(input)
      .then(() => {
        options.metrics?.event(kind);
        return true;
      })
      .catch((error) => {
        degrade(error, `append:${kind}`);
        return false;
      });
  }

  const recorder: RunLedgerRecorder = {
    runId: options.runId,
    accountId: options.accountId,

    async start(input) {
      stream = {
        conversationStreamId: input.conversationStreamId,
        sourceEventId: input.sourceEventId,
      };
      const startedAt = now();
      const ok = await enqueue(() =>
        appendEvent(
          AGENT_RUN_EVENT_TYPE.RUN_STARTED,
          "1",
          { runKind: "chat", triggerEventId: input.sourceEventId },
          { causationId: input.sourceEventId, occurredAt: input.occurredAt },
        ),
      );
      options.metrics?.inlineLatencyMs(now() - startedAt);
      return ok === true;
    },

    isDegraded() {
      return degraded;
    },

    degrade,

    enqueueWrite(task) {
      return enqueue(task);
    },

    async putArtifact(kind, document, putOptions) {
      if (!putter) {
        degrade(new Error("artifact_revision_store_required"), `put:${kind}`);
        return undefined;
      }
      try {
        const result = await putDocumentArtifact(putter, kind, document, putOptions);
        return { artifactId: result.artifactId, sha256: result.sha256 };
      } catch (error) {
        degrade(error, `put:${kind}`);
        return undefined;
      }
    },

    async recordContextCompiled(manifestId) {
      const startedAt = now();
      const ok = await enqueue(() =>
        appendEvent(
          AGENT_RUN_EVENT_TYPE.CONTEXT_COMPILED,
          "1",
          { manifestId },
          { causationId: manifestId },
        ),
      );
      options.metrics?.inlineLatencyMs(now() - startedAt);
      return ok === true;
    },

    recordModelCallStarted(input) {
      const callId = createCallId(options.runId, input.round);
      void enqueue(async () => {
        let requestArtifactId = input.requestArtifactId;
        if (!requestArtifactId && input.requestDoc !== undefined) {
          const artifact = await recorder.putArtifact(ARTIFACT_KIND.CANONICAL_REQUEST, input.requestDoc);
          if (!artifact) return;
          requestArtifactId = artifact.artifactId;
        }
        if (requestArtifactId === undefined) return;
        await appendEvent(
          AGENT_RUN_EVENT_TYPE.MODEL_CALL_STARTED,
          callId,
          { callId, round: input.round, manifestId: input.manifestId, requestArtifactId },
          { causationId: input.manifestId },
        );
      });
    },

    recordModelCallCompleted(input) {
      const callId = createCallId(options.runId, input.round);
      void enqueue(async () => {
        const artifact = await recorder.putArtifact(ARTIFACT_KIND.MODEL_RESPONSE, input.responseDoc);
        if (!artifact) return;
        lastResponseArtifactId = artifact.artifactId;
        await appendEvent(
          AGENT_RUN_EVENT_TYPE.MODEL_CALL_COMPLETED,
          callId,
          { callId, responseArtifactId: artifact.artifactId, stopReason: input.stopReason },
          { causationId: callId },
        );
      });
    },

    recordModelCallFailed(input) {
      const callId = createCallId(options.runId, input.round);
      void enqueue(() =>
        appendEvent(
          AGENT_RUN_EVENT_TYPE.MODEL_CALL_FAILED,
          callId,
          { callId, error: toStableErrorCode(input.error) },
          { causationId: callId },
        ),
      );
    },

    recordToolCallRequested(input) {
      void enqueue(async () => {
        const artifact = await recorder.putArtifact(ARTIFACT_KIND.TOOL_ARGUMENTS, input.argumentsDoc);
        if (!artifact) return;
        await appendEvent(
          AGENT_RUN_EVENT_TYPE.TOOL_CALL_REQUESTED,
          input.toolCallId,
          {
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            toolRevisionId: input.toolRevisionId,
            argumentsArtifactId: artifact.artifactId,
          },
          { causationId: input.toolCallId },
        );
      });
    },

    recordToolCallCompleted(input) {
      void enqueue(async () => {
        const artifact = await recorder.putArtifact(ARTIFACT_KIND.TOOL_RESULT, input.resultDoc);
        if (!artifact) return;
        await appendEvent(
          AGENT_RUN_EVENT_TYPE.TOOL_CALL_COMPLETED,
          input.toolCallId,
          { toolCallId: input.toolCallId, resultArtifactId: artifact.artifactId },
          { causationId: input.toolCallId },
        );
      });
    },

    recordToolCallFailed(input) {
      void enqueue(async () => {
        const artifact = await recorder.putArtifact(ARTIFACT_KIND.TOOL_RESULT, input.resultDoc);
        await appendEvent(
          AGENT_RUN_EVENT_TYPE.TOOL_CALL_FAILED,
          input.toolCallId,
          {
            toolCallId: input.toolCallId,
            error: toStableErrorCode(input.error),
            ...(artifact ? { errorArtifactId: artifact.artifactId } : {}),
          },
          { causationId: input.toolCallId },
        );
      });
    },

    recordSkillLoaded(input) {
      void enqueue(async () => {
        const revisionId = await input.pinSkillRevision(input.skillName);
        if (revisionId === null) {
          degrade(new Error("skill_revision_unresolvable"), `skill:${input.skillName}`);
          return;
        }
        await appendEvent(
          AGENT_RUN_EVENT_TYPE.SKILL_LOADED,
          input.causationToolCallId,
          {
            skillName: input.skillName,
            skillRevisionId: revisionId,
            round: input.round,
            causationToolCallId: input.causationToolCallId,
          },
          { causationId: input.causationToolCallId },
        );
      });
    },

    async finishCompleted(input) {
      const ok = await enqueue(() =>
        appendEvent(
          AGENT_RUN_EVENT_TYPE.RUN_COMPLETED,
          "1",
          {
            rounds: input.rounds,
            ...(input.finalResponseArtifactId
              ? { finalResponseArtifactId: input.finalResponseArtifactId }
              : {}),
          },
          { causationId: options.runId },
        ),
      );
      if (ok) options.metrics?.total("success");
      return ok === true;
    },

    async finishInterrupted(input) {
      const ok = await enqueue(() =>
        appendEvent(
          AGENT_RUN_EVENT_TYPE.RUN_INTERRUPTED,
          "business",
          { reason: input.reason },
          { causationId: options.runId },
        ),
      );
      if (ok) options.metrics?.total("success");
      return ok === true;
    },

    async recordDeliveryRequested(input) {
      const startedAt = now();
      const ok = await enqueue(() =>
        appendEvent(
          AGENT_RUN_EVENT_TYPE.DELIVERY_REQUESTED,
          input.deliveryId,
          {
            deliveryId: input.deliveryId,
            ...(lastResponseArtifactId ? { responseArtifactId: lastResponseArtifactId } : {}),
          },
          { causationId: input.deliveryId },
        ),
      );
      options.metrics?.inlineLatencyMs(now() - startedAt);
      return ok === true;
    },

    getFinalResponseArtifactId() {
      return lastResponseArtifactId;
    },

    async drain() {
      while (true) {
        const current = tail;
        await current.catch(() => undefined);
        if (tail === current) break;
      }
    },
  };

  return recorder;
}
