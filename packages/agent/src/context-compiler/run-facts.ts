import type { AgentRunEvent } from "../shared/fact-ledger/contracts.js";
import {
  AGENT_RUN_EVENT_TYPE,
  CONVERSATION_EVENT_TYPE,
  type ConversationEvent,
} from "../shared/fact-ledger/contracts.js";
import type { CanonicalConversationEntryV1, ContextCompilerDiagnostic } from "./types.js";

/**
 * Run-facts reducer (Phase 4 design §10.2) — pure function.
 *
 * Turns the run-event page of one canonical stream into canonical entries.
 * Only runs terminated by `run_completed` (business success) contribute
 * entries; `run_interrupted` runs and zombie runs are excluded entirely, so
 * canonical output stays deterministic under the conversation-lock discipline.
 */

export interface ReduceRunFactsInput {
  runEvents: AgentRunEvent[];
  /** trigger conversation event id → streamSeq, for events inside the compile window. */
  triggerStreamSeqByEventId: Map<string, number>;
  /** artifact id → extracted text, pre-resolved by the compiler from the artifact store. */
  artifactTextById: Map<string, string>;
}

export interface RunFactReduction {
  entries: Array<CanonicalConversationEntryV1>;
  diagnostics: ContextCompilerDiagnostic[];
}

/** Extract text from an inline artifact document: joined text blocks of `content`. */
export function extractArtifactText(inlineJson: unknown): string | undefined {
  if (!inlineJson || typeof inlineJson !== "object" || Array.isArray(inlineJson)) {
    return undefined;
  }
  const content = (inlineJson as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  const parts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      parts.push((block as { text: string }).text);
    }
  }
  return parts.join("\n");
}

interface RunGroup {
  runId: string;
  started?: AgentRunEvent;
  completed?: AgentRunEvent;
  interrupted?: AgentRunEvent;
  events: AgentRunEvent[];
}

function groupRunEvents(runEvents: AgentRunEvent[]): Map<string, RunGroup> {
  const groups = new Map<string, RunGroup>();
  for (const event of runEvents) {
    let group = groups.get(event.runId);
    if (!group) {
      group = { runId: event.runId, events: [] };
      groups.set(event.runId, group);
    }
    group.events.push(event);
    if (event.eventType === AGENT_RUN_EVENT_TYPE.RUN_STARTED) group.started = event;
    if (event.eventType === AGENT_RUN_EVENT_TYPE.RUN_COMPLETED) group.completed = event;
    if (event.eventType === AGENT_RUN_EVENT_TYPE.RUN_INTERRUPTED) group.interrupted = event;
  }
  for (const group of groups.values()) {
    group.events.sort((left, right) => left.runSeq - right.runSeq);
  }
  return groups;
}

export function reduceRunFacts(input: ReduceRunFactsInput): RunFactReduction {
  const entries: RunFactReduction["entries"] = [];
  const diagnostics: ContextCompilerDiagnostic[] = [];

  for (const group of groupRunEvents(input.runEvents).values()) {
    // Determinism rules: zombie runs (no terminal event) and interrupted runs
    // (rollback / abort / ledger degradation) never produce entries.
    if (!group.started || group.interrupted || !group.completed) continue;

    const startedPayload = group.started.payload as { triggerEventId?: string };
    const triggerEventId = startedPayload.triggerEventId;
    if (!triggerEventId) continue;
    const triggerStreamSeq = input.triggerStreamSeqByEventId.get(triggerEventId);
    // The trigger must be a conversation event inside the compile window.
    if (triggerStreamSeq === undefined) continue;

    for (const event of group.events) {
      if (event.eventType === AGENT_RUN_EVENT_TYPE.MODEL_CALL_COMPLETED) {
        const payload = event.payload as { callId: string; responseArtifactId: string };
        const text = input.artifactTextById.get(payload.responseArtifactId);
        if (text === undefined) {
          diagnostics.push({
            eventId: event.eventId,
            streamSeq: triggerStreamSeq,
            code: "run_response_artifact_missing",
          });
        }
        entries.push({
          eventId: event.eventId,
          streamSeq: triggerStreamSeq,
          role: "assistant",
          occurredAt: event.occurredAt,
          text: text ?? "",
          attachments: [],
          runId: group.runId,
          runSeq: event.runSeq,
          callId: payload.callId,
        });
        continue;
      }

      if (
        event.eventType === AGENT_RUN_EVENT_TYPE.TOOL_CALL_COMPLETED ||
        event.eventType === AGENT_RUN_EVENT_TYPE.TOOL_CALL_FAILED
      ) {
        const payload = event.payload as {
          toolCallId: string;
          resultArtifactId?: string;
          errorArtifactId?: string;
        };
        const artifactId =
          event.eventType === AGENT_RUN_EVENT_TYPE.TOOL_CALL_COMPLETED
            ? payload.resultArtifactId
            : payload.errorArtifactId;
        const text = artifactId === undefined ? undefined : input.artifactTextById.get(artifactId);
        if (text === undefined) {
          diagnostics.push({
            eventId: event.eventId,
            streamSeq: triggerStreamSeq,
            code: "run_result_artifact_missing",
          });
        }
        entries.push({
          eventId: event.eventId,
          streamSeq: triggerStreamSeq,
          role: "tool",
          occurredAt: event.occurredAt,
          text: text ?? "",
          attachments: [],
          runId: group.runId,
          runSeq: event.runSeq,
        });
      }
    }
  }

  return { entries, diagnostics };
}

/**
 * Total order over merged entries (design §10.4): conversation events first at
 * their stream position, then that position's run-derived output ordered by
 * (runId, runSeq).
 */
export function compareCanonicalEntries(
  left: CanonicalConversationEntryV1,
  right: CanonicalConversationEntryV1,
): number {
  if (left.streamSeq !== right.streamSeq) return left.streamSeq - right.streamSeq;
  const leftRank = left.runId === undefined ? 0 : 1;
  const rightRank = right.runId === undefined ? 0 : 1;
  if (leftRank !== rightRank) return leftRank - rightRank;
  if ((left.runId ?? "") !== (right.runId ?? "")) {
    return (left.runId ?? "") < (right.runId ?? "") ? -1 : 1;
  }
  return (left.runSeq ?? 0) - (right.runSeq ?? 0);
}

/**
 * trigger conversation event id → streamSeq, restricted to the compile window:
 * runs triggered at or before the session boundary never produce entries
 * (design §10.2 rule 1). `minStreamSeq` is the first stream position inside
 * the window (boundary + 1) or undefined when no boundary exists.
 */
export function buildTriggerSeqIndex(
  events: ConversationEvent[],
  minStreamSeq?: number,
): Map<string, number> {
  const index = new Map<string, number>();
  for (const event of events) {
    if (event.eventType !== CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED) continue;
    if (minStreamSeq !== undefined && event.streamSeq < minStreamSeq) continue;
    index.set(event.eventId, event.streamSeq);
  }
  return index;
}
