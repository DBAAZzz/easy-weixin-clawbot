type FactLedgerEntityKind =
  | "conversation_event"
  | "agent_run_event"
  | "memory_event"
  | "artifact"
  | "run_head";

export class FactLedgerIdConflictError extends Error {
  readonly code = "FACT_LEDGER_ID_CONFLICT";

  constructor(
    readonly entityKind: FactLedgerEntityKind,
    readonly entityId: string,
  ) {
    super(`Fact ledger ${entityKind} id conflicts with existing data: ${entityId}`);
    this.name = "FactLedgerIdConflictError";
  }
}

export class FactLedgerIdempotencyConflictError extends Error {
  readonly code = "FACT_LEDGER_IDEMPOTENCY_CONFLICT";

  constructor(
    readonly accountId: string,
    readonly idempotencyKey: string,
  ) {
    super(
      `Conversation event idempotency key conflicts with existing data for account: ${accountId}`,
    );
    this.name = "FactLedgerIdempotencyConflictError";
  }
}

export class FactLedgerContentHashMismatchError extends Error {
  readonly code = "FACT_LEDGER_CONTENT_HASH_MISMATCH";

  constructor(readonly artifactId: string) {
    super(`Artifact canonical content does not match its declared SHA-256: ${artifactId}`);
    this.name = "FactLedgerContentHashMismatchError";
  }
}

export class FactLedgerCorruptionError extends Error {
  readonly code = "FACT_LEDGER_CORRUPTION";

  constructor(
    readonly entityKind: FactLedgerEntityKind,
    readonly entityId: string,
    options?: ErrorOptions,
  ) {
    super(`Stored ${entityKind} does not satisfy its current schema: ${entityId}`, options);
    this.name = "FactLedgerCorruptionError";
  }
}

export class FactLedgerSequenceOverflowError extends Error {
  readonly code = "FACT_LEDGER_SEQUENCE_OVERFLOW";

  constructor(
    readonly streamKind: "conversation" | "run" | "memory",
    readonly streamId: string,
  ) {
    super(`Fact ledger ${streamKind} sequence is exhausted: ${streamId}`);
    this.name = "FactLedgerSequenceOverflowError";
  }
}
