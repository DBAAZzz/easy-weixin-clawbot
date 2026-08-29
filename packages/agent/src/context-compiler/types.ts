export const CONTEXT_COMPILER_VERSION = "context-compiler-v1" as const;
export const CONTEXT_POLICY_REVISION_ID = "context-policy-v1" as const;
/** Phase 4: enables conversation facts + prior terminal run facts (design §10.1). */
export const CONTEXT_POLICY_REVISION_ID_V2 = "context-policy-v2" as const;
export const CONTEXT_TIMEZONE = "Asia/Shanghai" as const;

export type ContextPolicyRevisionId =
  | typeof CONTEXT_POLICY_REVISION_ID
  | typeof CONTEXT_POLICY_REVISION_ID_V2;

export interface CompileContextInputV1 {
  accountId: string;
  conversationStreamId: string;
  eventCursor: number;
  compilerVersion: typeof CONTEXT_COMPILER_VERSION;
  contextPolicyRevisionId: ContextPolicyRevisionId;
  effectiveTime: string;
  timezone: typeof CONTEXT_TIMEZONE;
}

export interface ResolvedAttachmentArtifact {
  artifactId: string;
  mimeType?: string;
}

export interface CanonicalAttachment {
  sourceRef: string;
  resolution:
    | ({ status: "resolved" } & ResolvedAttachmentArtifact)
    | { status: "unresolved"; reason: "artifact_mapping_missing" };
}

export interface CanonicalConversationEntryV1 {
  eventId: string;
  streamSeq: number;
  /** `tool` entries only exist under context-policy-v2 (run facts, design §10.2). */
  role: "user" | "assistant" | "tool";
  occurredAt: string;
  text: string;
  attachments: CanonicalAttachment[];
  replyToEventId?: string;
  /** Present on run-derived entries only; `streamSeq` is then the trigger event's position. */
  runId?: string;
  runSeq?: number;
  callId?: string;
}

export type ContextCompilerDiagnosticCode =
  | "dangling_edit_target"
  | "dangling_delete_target"
  | "run_response_artifact_missing"
  | "run_result_artifact_missing";

export interface ContextCompilerDiagnostic {
  eventId: string;
  streamSeq: number;
  code: ContextCompilerDiagnosticCode;
}

export interface CanonicalContextV1 {
  schemaVersion: 1;
  compilerVersion: typeof CONTEXT_COMPILER_VERSION;
  contextPolicyRevisionId: ContextPolicyRevisionId;
  accountId: string;
  conversationStreamId: string;
  eventCursor: number;
  sessionBoundaryEventId?: string;
  entries: CanonicalConversationEntryV1[];
  runtimeContext: {
    effectiveTime: string;
    timezone: typeof CONTEXT_TIMEZONE;
  };
  coverage: {
    conversationFacts: boolean;
    assistantRunFacts: boolean;
    toolRunFacts: boolean;
    /** Memory facts stay closed until Phase 5. */
    memoryFacts: false;
    /** Media artifact mapping stays closed until Phase 5. */
    immutableMediaArtifacts: false;
  };
}

export interface CompiledContextV1 {
  context: CanonicalContextV1;
  diagnostics: ContextCompilerDiagnostic[];
  canonicalContextHash: string;
  /** All conversation event ids in the compile window (manifest `conversationEventIds`). */
  conversationEventIds: string[];
  /** policy-v2 only: run event ids whose output became entries (manifest `runEventIds`). */
  runEntrySourceIds?: string[];
}

export class ContextCompilerError extends Error {
  override readonly name = "ContextCompilerError";

  constructor(public readonly code: string) {
    super(code);
  }
}
