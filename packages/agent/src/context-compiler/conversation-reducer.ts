import { createHash } from "node:crypto";
import type { ConversationEvent } from "../shared/fact-ledger/contracts.js";
import {
  CONVERSATION_EVENT_TYPE,
  FACT_LEDGER_SCHEMA_VERSION,
} from "../shared/fact-ledger/contracts.js";
import type { CanonicalConversationEntryV1, ContextCompilerDiagnostic } from "./types.js";
import { ContextCompilerError } from "./types.js";

export interface ReducedConversationFacts {
  sessionBoundaryEventId?: string;
  /** `streamSeq` of the boundary event; entries start strictly after it. */
  sessionBoundaryStreamSeq?: number;
  entries: Array<CanonicalConversationEntryV1 & { attachmentSourceRefs: string[] }>;
  diagnostics: ContextCompilerDiagnostic[];
}

/**
 * Phase 7 (§5.3): synthetic identity shared by every entry of one legacy
 * import batch. The batch eventId is deterministic per stream
 * (`legacy-import-v1:<sha256(accountId + NUL + streamId)>`), so grouping and
 * tool-call pairing inside the batch are stable across compiles.
 */
export function legacyBatchRunId(batchEvent: ConversationEvent): string {
  return batchEvent.eventId;
}

function legacyEntryId(batchEventId: string, sourceMessageSeq: number): string {
  const digest = createHash("sha256")
    .update(batchEventId, "utf8")
    .update("\0", "utf8")
    .update(String(sourceMessageSeq), "utf8")
    .digest("hex");
  return `legacy-entry-v1:${digest}`;
}

function messageEntry(
  event: ConversationEvent,
): (CanonicalConversationEntryV1 & { attachmentSourceRefs: string[] }) | null {
  switch (event.eventType) {
    case CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED:
      return {
        eventId: event.eventId,
        streamSeq: event.streamSeq,
        role: "user",
        occurredAt: event.occurredAt,
        text: event.payload.text,
        attachments: [],
        attachmentSourceRefs: [...event.payload.attachmentRefs],
        ...(event.payload.replyToEventId ? { replyToEventId: event.payload.replyToEventId } : {}),
      };
    case CONVERSATION_EVENT_TYPE.OUTBOUND_MESSAGE_DELIVERED:
      return {
        eventId: event.eventId,
        streamSeq: event.streamSeq,
        role: "assistant",
        occurredAt: event.occurredAt,
        text: event.payload.text,
        attachments: [],
        attachmentSourceRefs: [...event.payload.attachmentRefs],
      };
    default:
      return null;
  }
}

export function reduceConversationEvents(
  events: ConversationEvent[],
  eventCursor: number,
): ReducedConversationFacts {
  if (!Number.isInteger(eventCursor) || eventCursor <= 0) {
    throw new ContextCompilerError("invalid_event_cursor");
  }

  let expectedSeq = 1;
  let boundaryIndex = -1;
  for (const [index, event] of events.entries()) {
    if (event.schemaVersion !== FACT_LEDGER_SCHEMA_VERSION) {
      throw new ContextCompilerError("unsupported_schema_version");
    }
    if (event.streamSeq !== expectedSeq) {
      throw new ContextCompilerError("invalid_event_sequence");
    }
    expectedSeq += 1;
    if (event.streamSeq > eventCursor) throw new ContextCompilerError("future_event_in_page");
    if (event.eventType === CONVERSATION_EVENT_TYPE.SESSION_ROTATED) boundaryIndex = index;
  }
  if (events.length === 0 || events.at(-1)?.streamSeq !== eventCursor) {
    throw new ContextCompilerError("event_cursor_not_found");
  }

  const visibleEvents = events.slice(boundaryIndex + 1);
  const entries: ReducedConversationFacts["entries"] = [];
  const legacyEntries: ReducedConversationFacts["entries"] = [];
  const entryIndex = new Map<string, number>();
  const diagnostics: ContextCompilerDiagnostic[] = [];

  for (const event of visibleEvents) {
    if (event.eventType === CONVERSATION_EVENT_TYPE.LEGACY_TRANSCRIPT_IMPORTED) {
      // Phase 7 (§5.3): legacy entries sit before every fact entry at the
      // synthetic stream position 0. A session boundary in the window means
      // the user cleared history — the boundary semantics win and the whole
      // batch is dropped (defence in depth with the import CLI's refusal).
      if (boundaryIndex >= 0) continue;
      const imported = event.payload.entries;
      const sorted = [...imported].sort((a, b) => a.sourceMessageSeq - b.sourceMessageSeq);
      for (const item of sorted) {
        legacyEntries.push({
          eventId: legacyEntryId(event.eventId, item.sourceMessageSeq),
          streamSeq: 0,
          role: item.role,
          occurredAt: item.occurredAt,
          text: item.text,
          attachments: [],
          attachmentSourceRefs: [...(item.attachmentRefs ?? [])],
          runId: legacyBatchRunId(event),
          runSeq: item.sourceMessageSeq,
          ...(item.callId !== undefined ? { callId: item.callId } : {}),
          ...(item.toolName !== undefined ? { toolName: item.toolName } : {}),
          ...(item.toolArguments !== undefined ? { toolArguments: item.toolArguments } : {}),
          ...(item.toolError !== undefined ? { toolError: item.toolError } : {}),
          reconstructability: "partial",
          sourceMessageSeq: item.sourceMessageSeq,
        });
      }
      continue;
    }

    const entry = messageEntry(event);
    if (entry) {
      entryIndex.set(entry.eventId, entries.length);
      entries.push(entry);
      continue;
    }

    if (event.eventType === CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_EDITED) {
      const index = entryIndex.get(event.payload.targetEventId);
      const target = index === undefined ? undefined : entries[index];
      if (!target) {
        diagnostics.push({
          eventId: event.eventId,
          streamSeq: event.streamSeq,
          code: "dangling_edit_target",
        });
        continue;
      }
      target.text = event.payload.text;
      target.attachmentSourceRefs = [...event.payload.attachmentRefs];
      continue;
    }

    if (event.eventType === CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_DELETED) {
      const index = entryIndex.get(event.payload.targetEventId);
      if (index === undefined || !entries[index]) {
        diagnostics.push({
          eventId: event.eventId,
          streamSeq: event.streamSeq,
          code: "dangling_delete_target",
        });
        continue;
      }
      entries.splice(index, 1);
      entryIndex.clear();
      entries.forEach((current, currentIndex) => entryIndex.set(current.eventId, currentIndex));
    }
  }

  const boundary = boundaryIndex >= 0 ? events[boundaryIndex] : undefined;
  return {
    ...(boundary ? { sessionBoundaryEventId: boundary.eventId } : {}),
    ...(boundary ? { sessionBoundaryStreamSeq: boundary.streamSeq } : {}),
    entries: [...legacyEntries, ...entries],
    diagnostics,
  };
}
