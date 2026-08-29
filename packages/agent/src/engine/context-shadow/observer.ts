import type { AgentMessage } from "../../llm/types.js";
import type { ContextCompilerV1 } from "../../context-compiler/compiler.js";
import { hashCanonicalValue } from "../../context-compiler/canonical-hash.js";
import { buildCanonicalMemoryExtractionInput } from "../../context-compiler/memory-input.js";
import {
  emptyContextCompilerShadowDiffCounts,
  type ContextCompilerShadowDiffCounts,
} from "../../context-compiler/diff-types.js";
import type {
  ContextCompilerShadowResultDiffCounts,
  ContextCompilerShadowResultStore,
} from "../../ports/context-compiler-shadow-result-store.js";
import { diffCanonicalAndLegacy } from "./diff.js";
import { normalizeLegacyContext } from "./legacy-normalizer.js";

export interface ContextShadowObserverMetrics {
  total(result: "success" | "failed" | "skipped_turn_failed"): void;
  diff(counts: ContextCompilerShadowDiffCounts): void;
  entries(side: "canonical" | "legacy", count: number): void;
  unresolvedAttachments(count: number): void;
  durationMs(duration: number): void;
}

const noopMetrics: ContextShadowObserverMetrics = {
  total() {},
  diff() {},
  entries() {},
  unresolvedAttachments() {},
  durationMs() {},
};

export interface PendingContextShadowHandle {
  publish(): Promise<void>;
  discard(reason: "turn_failed"): void;
}

export interface ContextShadowObserver {
  start(input: {
    sourceEventId: string;
    accountId: string;
    conversationStreamId: string;
    eventCursor: number;
    effectiveTime: string;
    timezone: "Asia/Shanghai";
    compilerVersion: "context-compiler-v1";
    contextPolicyRevisionId: "context-policy-v2";
    legacyMessages: AgentMessage[];
  }): PendingContextShadowHandle;
  skipTurnFailed(): void;
  drain(): Promise<void>;
}

/** Handle for a shadow that never started; every operation is a no-op. */
const inertHandle: PendingContextShadowHandle = {
  async publish() {},
  discard() {},
};

function stableErrorCode(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
  )
    return error.code;
  return "shadow_compile_failed";
}

function toStoreDiffCounts(
  counts: ContextCompilerShadowDiffCounts,
): ContextCompilerShadowResultDiffCounts {
  return { ...counts };
}

type ShadowStartInput = Parameters<ContextShadowObserver["start"]>[0];

export function createContextShadowObserver(deps: {
  compiler: ContextCompilerV1;
  resultStore: ContextCompilerShadowResultStore;
  metrics?: ContextShadowObserverMetrics;
  onError?: (fields: {
    sourceEventId: string;
    accountId: string;
    eventCursor: number;
    errorCode: string;
  }) => void;
}): ContextShadowObserver {
  const metrics = deps.metrics ?? noopMetrics;
  const pending = new Set<Promise<void>>();

  function track(task: Promise<void>): Promise<void> {
    pending.add(task);
    void task.then(
      () => pending.delete(task),
      () => pending.delete(task),
    );
    return task;
  }

  function startWithSnapshot(
    input: ShadowStartInput,
    legacySnapshot: AgentMessage[],
  ): PendingContextShadowHandle {
    let terminal: "pending" | "published" | "discarded" = "pending";
    const startedAt = Date.now();
    const compiled = (async () => {
      try {
        const canonical = await deps.compiler.compile({
          accountId: input.accountId,
          conversationStreamId: input.conversationStreamId,
          eventCursor: input.eventCursor,
          compilerVersion: input.compilerVersion,
          contextPolicyRevisionId: input.contextPolicyRevisionId,
          effectiveTime: input.effectiveTime,
          timezone: input.timezone,
        });
        const memoryInput = buildCanonicalMemoryExtractionInput(canonical.context);
        const legacy = normalizeLegacyContext(legacySnapshot);
        const diff = diffCanonicalAndLegacy(canonical.context, legacy);
        return {
          sourceEventId: input.sourceEventId,
          accountId: input.accountId,
          compilerVersion: input.compilerVersion,
          contextPolicyRevisionId: input.contextPolicyRevisionId,
          eventCursor: input.eventCursor,
          effectiveTime: input.effectiveTime,
          timezone: input.timezone,
          canonicalContextHash: canonical.canonicalContextHash,
          canonicalMemoryInputHash: hashCanonicalValue(memoryInput),
          legacySummaryHash: legacy.hash,
          canonicalEntryCount: diff.canonicalEntryCount,
          legacyEntryCount: diff.legacyEntryCount,
          diffCounts: toStoreDiffCounts(diff.counts),
          status: "success" as const,
        };
      } catch (error) {
        const counts = emptyContextCompilerShadowDiffCounts();
        counts.shadow_compile_failed = 1;
        return {
          sourceEventId: input.sourceEventId,
          accountId: input.accountId,
          compilerVersion: input.compilerVersion,
          contextPolicyRevisionId: input.contextPolicyRevisionId,
          eventCursor: input.eventCursor,
          effectiveTime: input.effectiveTime,
          timezone: input.timezone,
          diffCounts: toStoreDiffCounts(counts),
          status: "failed" as const,
          errorCode: stableErrorCode(error),
        };
      } finally {
        metrics.durationMs(Date.now() - startedAt);
      }
    })();
    void track(compiled.then(() => undefined));

    return {
      async publish() {
        if (terminal !== "pending") return;
        terminal = "published";
        const task = track(
          compiled.then(async (record) => {
            if (terminal !== "published") return;
            metrics.diff(record.diffCounts);
            if (record.canonicalEntryCount !== undefined) {
              metrics.entries("canonical", record.canonicalEntryCount);
            }
            if (record.legacyEntryCount !== undefined) {
              metrics.entries("legacy", record.legacyEntryCount);
            }
            metrics.unresolvedAttachments(record.diffCounts.canonical_unresolved_attachment);
            try {
              await deps.resultStore.createOrVerifyEquivalent(record);
              metrics.total(record.status);
            } catch (error) {
              metrics.total("failed");
              deps.onError?.({
                sourceEventId: input.sourceEventId,
                accountId: input.accountId,
                eventCursor: input.eventCursor,
                errorCode: stableErrorCode(error),
              });
            }
          }),
        );
        await task;
      },
      discard() {
        if (terminal !== "pending") return;
        terminal = "discarded";
        metrics.total("skipped_turn_failed");
      },
    };
  }

  return {
    start(input) {
      // The snapshot clone must happen synchronously before the runner mutates
      // history, and structuredClone is the one operation that can throw here.
      // Guard the whole start: a shadow failure must never fail the turn.
      try {
        const legacySnapshot = structuredClone(input.legacyMessages);
        return startWithSnapshot(input, legacySnapshot);
      } catch (error) {
        metrics.total("failed");
        deps.onError?.({
          sourceEventId: input.sourceEventId,
          accountId: input.accountId,
          eventCursor: input.eventCursor,
          errorCode: stableErrorCode(error),
        });
        return inertHandle;
      }
    },
    skipTurnFailed() {
      metrics.total("skipped_turn_failed");
    },
    async drain() {
      while (pending.size > 0) {
        await Promise.allSettled(pending);
      }
    },
  };
}
