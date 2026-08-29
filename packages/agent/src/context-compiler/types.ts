export const CONTEXT_COMPILER_VERSION = "context-compiler-v1" as const;
export const CONTEXT_POLICY_REVISION_ID = "context-policy-v1" as const;
export const CONTEXT_TIMEZONE = "Asia/Shanghai" as const;

export interface CompileContextInputV1 {
  accountId: string;
  conversationStreamId: string;
  eventCursor: number;
  compilerVersion: typeof CONTEXT_COMPILER_VERSION;
  contextPolicyRevisionId: typeof CONTEXT_POLICY_REVISION_ID;
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
  role: "user" | "assistant";
  occurredAt: string;
  text: string;
  attachments: CanonicalAttachment[];
  replyToEventId?: string;
}

export type ContextCompilerDiagnosticCode = "dangling_edit_target" | "dangling_delete_target";

export interface ContextCompilerDiagnostic {
  eventId: string;
  streamSeq: number;
  code: ContextCompilerDiagnosticCode;
}

export interface CanonicalContextV1 {
  schemaVersion: 1;
  compilerVersion: typeof CONTEXT_COMPILER_VERSION;
  contextPolicyRevisionId: typeof CONTEXT_POLICY_REVISION_ID;
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
    conversationFacts: true;
    assistantRunFacts: false;
    toolRunFacts: false;
    memoryFacts: false;
    immutableMediaArtifacts: false;
  };
}

export interface CompiledContextV1 {
  context: CanonicalContextV1;
  diagnostics: ContextCompilerDiagnostic[];
  canonicalContextHash: string;
}

export class ContextCompilerError extends Error {
  override readonly name = "ContextCompilerError";

  constructor(public readonly code: string) {
    super(code);
  }
}
