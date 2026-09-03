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
  extractRound1TriggerPrompt,
  reduceRunFacts,
} from "./run-facts.js";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID,
  CONTEXT_POLICY_REVISION_ID_V2,
  CONTEXT_POLICY_REVISION_ID_V3,
  CONTEXT_POLICY_REVISION_ID_V4,
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
  // 0 is legal for trigger runs on a fresh execution stream (Phase 6 §5.1):
  // the compile window is empty and the run_started anchor is absent.
  if (!Number.isInteger(input.eventCursor) || input.eventCursor < 0) {
    throw new ContextCompilerError("invalid_event_cursor");
  }
  if (input.compilerVersion !== CONTEXT_COMPILER_VERSION) {
    throw new ContextCompilerError("unsupported_compiler_version");
  }
  if (
    input.contextPolicyRevisionId !== CONTEXT_POLICY_REVISION_ID &&
    input.contextPolicyRevisionId !== CONTEXT_POLICY_REVISION_ID_V2 &&
    input.contextPolicyRevisionId !== CONTEXT_POLICY_REVISION_ID_V3 &&
    input.contextPolicyRevisionId !== CONTEXT_POLICY_REVISION_ID_V4
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

/** Load an artifact document by id: inline JSON or read through the content sink. */
async function loadArtifactDocument(
  store: ArtifactRevisionStore,
  contentSink: ArtifactContentSink | undefined,
  artifactId: string,
): Promise<unknown | undefined> {
  const artifact = await store.getById(artifactId);
  if (!artifact) return undefined;
  if (artifact.inlineJson !== undefined) return artifact.inlineJson;
  if (artifact.storageRef && contentSink) {
    const bytes = await contentSink.get(artifact.storageRef.key).catch(() => null);
    if (!bytes) return undefined;
    try {
      return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      // Corrupt sink content → treated as missing, consistent with §10.2.
      return undefined;
    }
  }
  return undefined;
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
    const document = await loadArtifactDocument(store, contentSink, artifactId);
    if (document === undefined) continue;
    const text = extractArtifactText(document);
    if (text !== undefined) texts.set(artifactId, text);
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
      // v3 extras (trigger entries, tool arguments, anchors) apply to v4 as
      // well — v4 = v3 + legacy transcript entries.
      const policyV3 =
        input.contextPolicyRevisionId === CONTEXT_POLICY_REVISION_ID_V3 ||
        input.contextPolicyRevisionId === CONTEXT_POLICY_REVISION_ID_V4;
      const runFactsEnabled =
        input.contextPolicyRevisionId === CONTEXT_POLICY_REVISION_ID_V2 || policyV3;
      if (runFactsEnabled && !deps.agentRunStore) {
        throw new ContextCompilerError("missing_run_store");
      }
      if (runFactsEnabled && !deps.artifactRevisionStore) {
        throw new ContextCompilerError("missing_artifact_revision_store");
      }
      const events = await readThroughCursor(deps.conversationEventStore, input);
      const policyV4 = input.contextPolicyRevisionId === CONTEXT_POLICY_REVISION_ID_V4;
      const reducedEvents = reduceConversationEvents(events, input.eventCursor);
      // Phase 7 (§5.3): legacy transcript entries exist only under policy v4+.
      // v1–v3 outputs stay byte-identical to their regression anchors.
      const reduced = {
        ...reducedEvents,
        entries: policyV4
          ? reducedEvents.entries
          : reducedEvents.entries.filter(
              (entry) => entry.reconstructability === undefined,
            ),
      };

      let mergedEntries: Array<
        CanonicalConversationEntryV1 & { attachmentSourceRefs?: string[] }
      > = reduced.entries;
      let diagnostics = reduced.diagnostics;
      let runEntrySourceIds: string[] = [];
      if (runFactsEnabled) {
        const runEvents = await readRunEventsByStream(deps.agentRunStore!, input);
        const artifactTextById = await resolveArtifactTexts(
          deps.artifactRevisionStore!,
          runEvents,
          deps.contentSink,
        );

        // v3 extras (design §7.1/§7.2): round-1 request prompts for trigger
        // entries, serialized tool arguments for pairing, and per-run anchors.
        const round1RequestTextById = new Map<string, string>();
        const toolArgumentsJsonById = new Map<string, string>();
        const triggerRunAnchors = new Map<string, { streamSeq: number; anchored: boolean }>();
        if (policyV3) {
          for (const event of runEvents) {
            if (event.eventType === "model_call_started") {
              const payload = event.payload as {
                round?: number;
                requestArtifactId?: string;
              };
              if (payload.round === 1 && payload.requestArtifactId) {
                const document = await loadArtifactDocument(
                  deps.artifactRevisionStore!,
                  deps.contentSink,
                  payload.requestArtifactId,
                );
                if (document === undefined) continue;
                const prompt = extractRound1TriggerPrompt(document);
                if (prompt !== undefined) {
                  round1RequestTextById.set(payload.requestArtifactId, prompt);
                }
              }
            }
            if (event.eventType === "tool_call_requested") {
              const payload = event.payload as { argumentsArtifactId?: string };
              if (payload.argumentsArtifactId) {
                const document = await loadArtifactDocument(
                  deps.artifactRevisionStore!,
                  deps.contentSink,
                  payload.argumentsArtifactId,
                );
                if (document !== undefined) {
                  toolArgumentsJsonById.set(
                    payload.argumentsArtifactId,
                    JSON.stringify(document),
                  );
                }
              }
            }
            if (event.eventType === "run_started") {
              const payload = event.payload as {
                triggerEventId?: string;
                anchorStreamSeq?: number;
              };
              if (payload.triggerEventId !== undefined) continue;
              if (typeof payload.anchorStreamSeq === "number") {
                triggerRunAnchors.set(event.runId, {
                  streamSeq: payload.anchorStreamSeq,
                  anchored: true,
                });
                continue;
              }
              // Dual-only approximation (§7.2): fall back to the local-clock
              // position of run_started within the conversation window. The
              // canonical gate (§6.5) rejects windows containing these runs.
              const startedMs = Date.parse(event.occurredAt);
              let fallbackSeq = 0;
              for (const conversationEvent of events) {
                if (Date.parse(conversationEvent.occurredAt) <= startedMs) {
                  fallbackSeq = conversationEvent.streamSeq;
                } else {
                  break;
                }
              }
              triggerRunAnchors.set(event.runId, { streamSeq: fallbackSeq, anchored: false });
            }
          }
        }

        const runReduction = reduceRunFacts({
          runEvents,
          triggerStreamSeqByEventId: buildTriggerSeqIndex(
            events,
            reduced.sessionBoundaryStreamSeq === undefined
              ? undefined
              : reduced.sessionBoundaryStreamSeq + 1,
          ),
          artifactTextById,
          ...(policyV3
            ? { policyV3, round1RequestTextById, toolArgumentsJsonById, triggerRunAnchors }
            : {}),
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
          assistantRunFacts: runFactsEnabled,
          toolRunFacts: runFactsEnabled,
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
        ...(runFactsEnabled ? { runEntrySourceIds } : {}),
      };
    },
  };
}
