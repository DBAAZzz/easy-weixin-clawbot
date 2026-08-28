import {
  canonicalizeJson,
  type AgentRunEvent,
  type AppendAgentRunEventInput,
  type AppendConversationEventInput,
  type AppendMemoryEventInput,
  type ArtifactRevision,
  type ConversationEvent,
  type JsonValue,
  type MemoryEvent,
  type PutArtifactRevisionInput,
} from "@clawbot/agent";

function comparableJson(value: unknown): JsonValue {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    if (
      Object.getOwnPropertySymbols(value).length > 0 ||
      Object.getOwnPropertyNames(value).length !== value.length + 1
    ) {
      throw new TypeError("Fact ledger arrays cannot have extra properties");
    }
    return value.map((entry) => {
      if (entry === undefined) throw new TypeError("Fact ledger arrays cannot contain undefined");
      return comparableJson(entry);
    });
  }
  if (typeof value !== "object") {
    throw new TypeError(`Fact ledger comparison cannot encode ${typeof value}`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Fact ledger comparison requires a plain object");
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new TypeError("Fact ledger comparison rejects symbol properties");
  }
  if (Object.getOwnPropertyNames(value).length !== Object.keys(value).length) {
    throw new TypeError("Fact ledger comparison rejects hidden properties");
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, comparableJson(entry)]),
  );
}

function canonicalDomainValue(value: unknown): string {
  return canonicalizeJson(comparableJson(value));
}

function normalizeOccurredAt<T extends { occurredAt: string }>(value: T): T {
  return { ...value, occurredAt: new Date(value.occurredAt).toISOString() };
}

export function conversationEventMatchesIdRetry(
  stored: ConversationEvent,
  input: AppendConversationEventInput,
): boolean {
  const {
    streamSeq: _streamSeq,
    recordedAt: _recordedAt,
    receivedAt: _storedReceivedAt,
    ...rest
  } = stored;
  const { receivedAt: _inputReceivedAt, ...candidate } = input;
  return (
    canonicalDomainValue(normalizeOccurredAt(rest)) ===
    canonicalDomainValue(normalizeOccurredAt(candidate))
  );
}

export function conversationEventMatchesIdempotencyRetry(
  stored: ConversationEvent,
  input: AppendConversationEventInput,
): boolean {
  const {
    eventId: _storedEventId,
    streamSeq: _streamSeq,
    receivedAt: _storedReceivedAt,
    recordedAt: _recordedAt,
    ...rest
  } = stored;
  const { eventId: _inputEventId, receivedAt: _inputReceivedAt, ...candidate } = input;
  return (
    canonicalDomainValue(normalizeOccurredAt(rest)) ===
    canonicalDomainValue(normalizeOccurredAt(candidate))
  );
}

export function agentRunEventMatchesRetry(
  stored: AgentRunEvent,
  input: AppendAgentRunEventInput,
): boolean {
  const { runSeq: _runSeq, recordedAt: _recordedAt, ...rest } = stored;
  return (
    canonicalDomainValue(normalizeOccurredAt(rest)) ===
    canonicalDomainValue(normalizeOccurredAt(input))
  );
}

export function memoryEventMatchesRetry(
  stored: MemoryEvent,
  input: AppendMemoryEventInput,
): boolean {
  const { memorySeq: _memorySeq, recordedAt: _recordedAt, ...rest } = stored;
  return (
    canonicalDomainValue(normalizeOccurredAt(rest)) ===
    canonicalDomainValue(normalizeOccurredAt(input))
  );
}

export function artifactMatchesIdRetry(
  stored: ArtifactRevision,
  input: PutArtifactRevisionInput,
): boolean {
  const { createdAt: _createdAt, ...rest } = stored;
  return canonicalDomainValue(rest) === canonicalDomainValue(input);
}
