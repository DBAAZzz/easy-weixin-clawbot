import type { ConversationEventStore } from "../ports/conversation-event-store.js";
import type { ArtifactRevisionStore } from "../ports/artifact-revision-store.js";
import type { ConversationEvent } from "../shared/fact-ledger/contracts.js";
import type { AttachmentArtifactResolver } from "./attachment-resolver.js";
import { unresolvedAttachmentArtifactResolver } from "./attachment-resolver.js";
import { hashCanonicalValue } from "./canonical-hash.js";
import { reduceConversationEvents } from "./conversation-reducer.js";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID,
  CONTEXT_TIMEZONE,
  ContextCompilerError,
  type CanonicalContextV1,
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
  if (input.contextPolicyRevisionId !== CONTEXT_POLICY_REVISION_ID) {
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

export interface ContextCompilerV1 {
  compile(input: CompileContextInputV1): Promise<CompiledContextV1>;
}

export function createContextCompilerV1(deps: {
  conversationEventStore: ConversationEventStore;
  attachmentArtifactResolver?: AttachmentArtifactResolver;
  artifactRevisionStore?: ArtifactRevisionStore;
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
      const events = await readThroughCursor(deps.conversationEventStore, input);
      const reduced = reduceConversationEvents(events, input.eventCursor);
      const sourceRefs = [
        ...new Set(reduced.entries.flatMap((entry) => entry.attachmentSourceRefs)),
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
        contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID,
        accountId: input.accountId,
        conversationStreamId: input.conversationStreamId,
        eventCursor: input.eventCursor,
        ...(reduced.sessionBoundaryEventId
          ? { sessionBoundaryEventId: reduced.sessionBoundaryEventId }
          : {}),
        entries: reduced.entries.map(({ attachmentSourceRefs, ...entry }) => ({
          ...entry,
          attachments: attachmentSourceRefs.map((sourceRef) => {
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
        })),
        runtimeContext: { effectiveTime: input.effectiveTime, timezone: CONTEXT_TIMEZONE },
        coverage: {
          conversationFacts: true,
          assistantRunFacts: false,
          toolRunFacts: false,
          memoryFacts: false,
          immutableMediaArtifacts: false,
        },
      };
      return {
        context,
        diagnostics: reduced.diagnostics,
        canonicalContextHash: hashCanonicalValue(context),
      };
    },
  };
}
