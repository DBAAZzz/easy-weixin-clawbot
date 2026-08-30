import type { ConversationEventStore } from "../ports/conversation-event-store.js";
import type { ArtifactRevisionStore } from "../ports/artifact-revision-store.js";
import type { AgentRunStore } from "../ports/agent-run-store.js";
import type { ArtifactContentSink } from "../ports/artifact-content-sink.js";
import type {
  AgentRunEvent,
  ConversationEvent,
} from "../shared/fact-ledger/contracts.js";
import type { AttachmentArtifactResolver } from "./attachment-resolver.js";
import { unresolvedAttachmentArtifactResolver } from "./attachment-resolver.js";
import { hashCanonicalValue } from "./canonical-hash.js";
import { reduceConversationEvents } from "./conversation-reducer.js";
import {
  buildTriggerSeqIndex,
  compareCanonicalEntries,
  extractArtifactText,
  reduceRunFacts,
} from "./run-facts.js";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID,
  CONTEXT_POLICY_REVISION_ID_V2,
  CONTEXT_TIMEZONE,
  ContextCompilerError,
  type CanonicalContextV1,
  type CanonicalConversationEntryV1,
  type CompileContextInputV1,
  type CompiledContextV1,
} from "./types.js";

const PAGE_SIZE = 500;

function validateInput(input: CompileContextInputV1): void {
  if (!input.accountId.trim() || !input.conversationStreamId.trim()) {
    throw new ContextCompilerError("invalid_compiler_identity");
  }
  if (!Number.isInteger(input.eventCursor) || input.eventCursor <= 0) {
    throw new ContextCompilerError("invalid_event_cursor");
  }
  if (input.compilerVersion !== CONTEXT_COMPILER_VERSION) {
    throw new ContextCompilerError("unsupported_compiler_version");
  }
  if (
    input.contextPolicyRevisionId !== CONTEXT_POLICY_REVISION_ID &&
    input.contextPolicyRevisionId !== CONTEXT_POLICY_REVISION_ID_V2
  ) {
    throw new ContextCompilerError("unsupported_context_policy_revision");
  }
  if (input.timezone !== CONTEXT_TIMEZONE || !Number.isFinite(Date.parse(input.effectiveTime))) {
    throw new ContextCompilerError("invalid_runtime_context");
  }
}

async function readThroughCursor(
  store: ConversationEventStore,
  input: CompileContextInputV1,
): Promise<ConversationEvent[]> {
  const events: ConversationEvent[] = [];
  let afterSeq: number | undefined;
  while ((afterSeq ?? 0) < input.eventCursor) {
    const page = await store.listStream({
      accountId: input.accountId,
      streamId: input.conversationStreamId,
      ...(afterSeq ? { afterSeq } : {}),
      throughSeq: input.eventCursor,
      limit: PAGE_SIZE,
    });
    if (page.length === 0) break;
    events.push(...page);
    afterSeq = page.at(-1)!.streamSeq;
    if (page.length < PAGE_SIZE) break;
  }
  return events;
}

async function readRunEventsByStream(
  store: AgentRunStore,
  input: CompileContextInputV1,
): Promise<AgentRunEvent[]> {
  const all: AgentRunEvent[] = [];
  let after: { recordedAt: string; eventId: string } | undefined;
  while (true) {
    const page = await store.listRunEventsByStream({
      accountId: input.accountId,
      conversationStreamId: input.conversationStreamId,
      limit: PAGE_SIZE,
      after,
    });
    if (page.length === 0) break;
    all.push(...page);
    if (page.length < PAGE_SIZE) break;
    const last = page.at(-1)!;
    after = { recordedAt: last.recordedAt, eventId: last.eventId };
  }
  return all;
}

/** Load entry-source artifact texts for the run-facts reducer (missing → empty text + diagnostic). */
async function resolveArtifactTexts(
  store: ArtifactRevisionStore,
  runEvents: AgentRunEvent[],
  contentSink?: ArtifactContentSink,
): Promise<Map<string, string>> {
  const artifactIds = new Set<string>();
  for (const event of runEvents) {
    if (event.eventType === "model_call_completed") {
      const payload = event.payload as { responseArtifactId?: string };
      if (payload.responseArtifactId) artifactIds.add(payload.responseArtifactId);
    }
    if (event.eventType === "tool_call_completed") {
      const payload = event.payload as { resultArtifactId?: string };
      if (payload.resultArtifactId) artifactIds.add(payload.resultArtifactId);
    }
    if (event.eventType === "tool_call_failed") {
      const payload = event.payload as { errorArtifactId?: string };
      if (payload.errorArtifactId) artifactIds.add(payload.errorArtifactId);
    }
  }

  const texts = new Map<string, string>();
  for (const artifactId of artifactIds) {
    const artifact = await store.getById(artifactId);
    if (!artifact) continue;
    if (artifact.inlineJson !== undefined) {
      const text = extractArtifactText(artifact.inlineJson);
      if (text !== undefined) texts.set(artifactId, text);
      continue;
    }
    // Oversized artifacts live behind the content sink (design §8); the v2
    // compiler must read them back or large replies would degrade to empty
    // entries in every canonical context.
    if (artifact.storageRef && contentSink) {
      const bytes = await contentSink.get(artifact.storageRef.key).catch(() => null);
      if (!bytes) continue;
      try {
        const text = extractArtifactText(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
        if (text !== undefined) texts.set(artifactId, text);
      } catch {
        // Corrupt sink content → treated as missing, consistent with §10.2.
      }
    }
  }
  return texts;
}

export interface ContextCompilerV1 {
  compile(input: CompileContextInputV1): Promise<CompiledContextV1>;
}

export function createContextCompilerV1(deps: {
  conversationEventStore: ConversationEventStore;
  attachmentArtifactResolver?: AttachmentArtifactResolver;
  artifactRevisionStore?: ArtifactRevisionStore;
  /** Required for context-policy-v2 compiles (run facts). */
  agentRunStore?: AgentRunStore;
  /** Reads back oversized entry-source artifacts stored behind the sink. */
  contentSink?: ArtifactContentSink;
}): ContextCompilerV1 {
  // A resolver that can resolve refs is only sound when every returned
  // artifactId can be verified against the immutable Artifact store; without
  // the store the compile would fail closed at runtime, so refuse it here.
  if (deps.attachmentArtifactResolver && !deps.artifactRevisionStore) {
    throw new ContextCompilerError("missing_artifact_revision_store");
  }
  const resolver = deps.attachmentArtifactResolver ?? unresolvedAttachmentArtifactResolver;
  return {
    async compile(input) {
      validateInput(input);
      const policyV2 = input.contextPolicyRevisionId === CONTEXT_POLICY_REVISION_ID_V2;
      if (policyV2 && !deps.agentRunStore) {
        throw new ContextCompilerError("missing_run_store");
      }
      if (policyV2 && !deps.artifactRevisionStore) {
        throw new ContextCompilerError("missing_artifact_revision_store");
      }
      const events = await readThroughCursor(deps.conversationEventStore, input);
      const reduced = reduceConversationEvents(events, input.eventCursor);

      let mergedEntries: Array<
        CanonicalConversationEntryV1 & { attachmentSourceRefs?: string[] }
      > = reduced.entries;
      let diagnostics = reduced.diagnostics;
      let runEntrySourceIds: string[] = [];
      if (policyV2) {
        const runEvents = await readRunEventsByStream(deps.agentRunStore!, input);
        const artifactTextById = await resolveArtifactTexts(
          deps.artifactRevisionStore!,
          runEvents,
          deps.contentSink,
        );
        const runReduction = reduceRunFacts({
          runEvents,
          triggerStreamSeqByEventId: buildTriggerSeqIndex(
            events,
            reduced.sessionBoundaryStreamSeq === undefined
              ? undefined
              : reduced.sessionBoundaryStreamSeq + 1,
          ),
          artifactTextById,
        });
        runEntrySourceIds = runReduction.entries.map((entry) => entry.eventId);
        diagnostics = [...diagnostics, ...runReduction.diagnostics];
        mergedEntries = [...reduced.entries, ...runReduction.entries].sort(
          compareCanonicalEntries,
        );
      }

      const sourceRefs = [
        ...new Set(
          mergedEntries.flatMap((entry) => entry.attachmentSourceRefs ?? []),
        ),
      ];
      const resolved = await resolver.resolve({ accountId: input.accountId, sourceRefs });
      for (const returnedRef of resolved.keys()) {
        if (!sourceRefs.includes(returnedRef)) {
          throw new ContextCompilerError("resolver_returned_unknown_source_ref");
        }
      }
      for (const artifact of resolved.values()) {
        const stored = await deps.artifactRevisionStore?.getById(artifact.artifactId);
        if (!stored) throw new ContextCompilerError("resolved_artifact_not_found");
      }

      const context: CanonicalContextV1 = {
        schemaVersion: 1,
        compilerVersion: CONTEXT_COMPILER_VERSION,
        contextPolicyRevisionId: input.contextPolicyRevisionId,
        accountId: input.accountId,
        conversationStreamId: input.conversationStreamId,
        eventCursor: input.eventCursor,
        ...(reduced.sessionBoundaryEventId
          ? { sessionBoundaryEventId: reduced.sessionBoundaryEventId }
          : {}),
        entries: mergedEntries.map((entry) => {
          const { attachmentSourceRefs, ...base } = entry;
          return {
            ...base,
            attachments: (attachmentSourceRefs ?? []).map((sourceRef) => {
              const artifact = resolved.get(sourceRef);
              return artifact
                ? { sourceRef, resolution: { status: "resolved" as const, ...artifact } }
                : {
                    sourceRef,
                    resolution: {
                      status: "unresolved" as const,
                      reason: "artifact_mapping_missing" as const,
                    },
                  };
            }),
          };
        }),
        runtimeContext: { effectiveTime: input.effectiveTime, timezone: CONTEXT_TIMEZONE },
        coverage: {
          conversationFacts: true,
          assistantRunFacts: policyV2,
          toolRunFacts: policyV2,
          // Phase 5：memory 由 bootstrap 实际产出驱动；media 缺省按 resolver
          // 实际解析结果推导（bootstrap 可用 visualObservationIds 覆盖）。
          memoryFacts: input.coverageHints?.memoryFacts ?? false,
          immutableMediaArtifacts:
            input.coverageHints?.immutableMediaArtifacts ?? resolved.size > 0,
        },
      };
      return {
        context,
        diagnostics,
        canonicalContextHash: hashCanonicalValue(context),
        conversationEventIds: events.map((event) => event.eventId),
        ...(policyV2 ? { runEntrySourceIds } : {}),
      };
    },
  };
}
