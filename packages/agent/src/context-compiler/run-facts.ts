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
  /**
   * v3+：为 trigger run 派生 trigger entry 并增强 tool 配对（design §7.1/§7.3）。
   * v2 输入下这些字段必须缺省——v2 hash 回归锚不允许变化。
   */
  policyV3?: boolean;
  /** v3：trigger runId → 排序锚（anchorStreamSeq 或时钟近似落位）。 */
  triggerRunAnchors?: Map<string, { streamSeq: number; anchored: boolean }>;
  /** v3：round-1 CANONICAL_REQUEST 制品 id → 派生的 trigger prompt 文本。 */
  round1RequestTextById?: Map<string, string>;
  /** v3：TOOL_ARGUMENTS 制品 id → 序列化 arguments JSON。 */
  toolArgumentsJsonById?: Map<string, string>;
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

/**
 * v3：从 round-1 CANONICAL_REQUEST 文档派生 trigger prompt（design §7.1）。
 *
 * 取最后一条 `role: "user" | "trigger"` 消息的完整组装文本（含时间/记忆注入，
 * 即 legacy TRIGGER 消息的同一 `assembleUserContext` 产物——双侧都不剥离注入片段，
 * dual 期 hash 对比才有意义）。
 */
export function extractRound1TriggerPrompt(requestDoc: unknown): string | undefined {
  if (!requestDoc || typeof requestDoc !== "object" || Array.isArray(requestDoc)) {
    return undefined;
  }
  const messages = (requestDoc as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!message || typeof message !== "object" || Array.isArray(message)) continue;
    const role = (message as { role?: unknown }).role;
    if (role !== "user" && role !== "trigger") continue;
    const text = extractArtifactText(message);
    return text;
  }
  return undefined;
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

    const startedPayload = group.started.payload as {
      triggerEventId?: string;
      anchorStreamSeq?: number;
    };
    const triggerEventId = startedPayload.triggerEventId;
    let anchorStreamSeq: number;
    if (triggerEventId !== undefined) {
      const triggerStreamSeq = input.triggerStreamSeqByEventId.get(triggerEventId);
      // The trigger must be a conversation event inside the compile window.
      if (triggerStreamSeq === undefined) continue;
      anchorStreamSeq = triggerStreamSeq;
    } else {
      // Trigger run (Phase 6 design §7.2): no ingress trigger — position comes
      // from the anchor resolved by the compiler (anchorStreamSeq, or the
      // documented local-clock approximation which is dual-only).
      if (!input.policyV3) continue;
      const anchor = input.triggerRunAnchors?.get(group.runId);
      if (!anchor) continue;
      if (!anchor.anchored) {
        diagnostics.push({
          eventId: group.started.eventId,
          streamSeq: anchor.streamSeq,
          code: "run_anchor_missing",
        });
      }
      anchorStreamSeq = anchor.streamSeq;

      // Trigger entry (design §7.1): the run's opening prompt, derived from the
      // round-1 CANONICAL_REQUEST artifact. Missing artifact → empty entry +
      // diagnostic (no guessing), same degradation family as §10.2.
      const round1 = group.events.find(
        (event) =>
          event.eventType === AGENT_RUN_EVENT_TYPE.MODEL_CALL_STARTED &&
          (event.payload as { round?: number }).round === 1,
      );
      const requestArtifactId = round1
        ? (round1.payload as { requestArtifactId?: string }).requestArtifactId
        : undefined;
      const promptText =
        requestArtifactId !== undefined
          ? input.round1RequestTextById?.get(requestArtifactId)
          : undefined;
      if (promptText === undefined) {
        diagnostics.push({
          eventId: round1?.eventId ?? group.started.eventId,
          streamSeq: anchorStreamSeq,
          code: "run_request_artifact_missing",
        });
      }
      entries.push({
        eventId: group.started.eventId,
        streamSeq: anchorStreamSeq,
        role: "trigger",
        occurredAt: group.started.occurredAt,
        text: promptText ?? "",
        attachments: [],
        runId: group.runId,
        runSeq: group.started.runSeq,
      });
    }

    // v3 tool enrichment: join each completed/failed tool call back to its
    // requested event for toolName + serialized arguments (design §7.3).
    const requestedByToolCallId = new Map<
      string,
      { toolName: string; argumentsArtifactId: string }
    >();
    if (input.policyV3) {
      for (const event of group.events) {
        if (event.eventType !== AGENT_RUN_EVENT_TYPE.TOOL_CALL_REQUESTED) continue;
        const payload = event.payload as {
          toolCallId: string;
          toolName: string;
          argumentsArtifactId: string;
        };
        requestedByToolCallId.set(payload.toolCallId, {
          toolName: payload.toolName,
          argumentsArtifactId: payload.argumentsArtifactId,
        });
      }
    }

    for (const event of group.events) {
      if (event.eventType === AGENT_RUN_EVENT_TYPE.MODEL_CALL_COMPLETED) {
        const payload = event.payload as { callId: string; responseArtifactId: string };
        const text = input.artifactTextById.get(payload.responseArtifactId);
        if (text === undefined) {
          diagnostics.push({
            eventId: event.eventId,
            streamSeq: anchorStreamSeq,
            code: "run_response_artifact_missing",
          });
        }
        entries.push({
          eventId: event.eventId,
          streamSeq: anchorStreamSeq,
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
            streamSeq: anchorStreamSeq,
            code: "run_result_artifact_missing",
          });
        }
        const requested = input.policyV3
          ? requestedByToolCallId.get(payload.toolCallId)
          : undefined;
        const toolArguments =
          requested !== undefined
            ? input.toolArgumentsJsonById?.get(requested.argumentsArtifactId)
            : undefined;
        entries.push({
          eventId: event.eventId,
          streamSeq: anchorStreamSeq,
          role: "tool",
          occurredAt: event.occurredAt,
          text: text ?? "",
          attachments: [],
          runId: group.runId,
          runSeq: event.runSeq,
          ...(input.policyV3
            ? { callId: payload.toolCallId, toolError: event.eventType === AGENT_RUN_EVENT_TYPE.TOOL_CALL_FAILED }
            : {}),
          ...(requested !== undefined ? { toolName: requested.toolName } : {}),
          ...(toolArguments !== undefined ? { toolArguments } : {}),
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
