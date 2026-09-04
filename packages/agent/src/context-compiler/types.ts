export const CONTEXT_COMPILER_VERSION = "context-compiler-v1" as const;
export const CONTEXT_POLICY_REVISION_ID = "context-policy-v1" as const;
/** Phase 4: enables conversation facts + prior terminal run facts (design §10.1). */
export const CONTEXT_POLICY_REVISION_ID_V2 = "context-policy-v2" as const;
/** Phase 6: v2 + trigger entry derivation for trigger runs (design §7.1). */
export const CONTEXT_POLICY_REVISION_ID_V3 = "context-policy-v3" as const;
/** Phase 7: v3 + legacy transcript entries from `legacy_transcript_imported` events (§5.3). */
export const CONTEXT_POLICY_REVISION_ID_V4 = "context-policy-v4" as const;
export const CONTEXT_TIMEZONE = "Asia/Shanghai" as const;

export type ContextPolicyRevisionId =
  | typeof CONTEXT_POLICY_REVISION_ID
  | typeof CONTEXT_POLICY_REVISION_ID_V2
  | typeof CONTEXT_POLICY_REVISION_ID_V3
  | typeof CONTEXT_POLICY_REVISION_ID_V4;

export interface CompileContextInputV1 {
  accountId: string;
  conversationStreamId: string;
  eventCursor: number;
  compilerVersion: typeof CONTEXT_COMPILER_VERSION;
  contextPolicyRevisionId: ContextPolicyRevisionId;
  effectiveTime: string;
  timezone: typeof CONTEXT_TIMEZONE;
  /**
   * Phase 5：bootstrap 用实际产出驱动的 coverage 提示。
   * memoryFacts = MEMORY_SNAPSHOT 真实写入；immutableMediaArtifacts 缺省时由
   * 编译器按 entries 中的 resolved attachment 推导。
   */
  coverageHints?: {
    memoryFacts?: boolean;
    immutableMediaArtifacts?: boolean;
  };
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
  /** `tool` 条目存在于 v2+（run facts）；`trigger` 条目仅存在于 v3+（trigger run prompt）。 */
  role: "user" | "assistant" | "tool" | "trigger";
  occurredAt: string;
  text: string;
  attachments: CanonicalAttachment[];
  replyToEventId?: string;
  /** Present on run-derived entries only; `streamSeq` is then the trigger event's position. */
  runId?: string;
  runSeq?: number;
  callId?: string;
  /** v3 only, `tool` entries: the requested tool name (design §7.3 tool-call 配对重建). */
  toolName?: string;
  /** v3 only, `tool` entries: serialized arguments document of the requested call. */
  toolArguments?: string;
  /** v3 only, `tool` entries: entry derived from a failed tool call. */
  toolError?: boolean;
  /**
   * Phase 7 (v4 only): entry derived from a `legacy_transcript_imported` event.
   * Presence marks the content as a partial, non-authoritative import — the
   * assembled text is carried opaquely and never parsed back into facts.
   */
  reconstructability?: "partial";
  /** Phase 7 (v4 only): original `messages.seq` inside the legacy import batch. */
  sourceMessageSeq?: number;
}

export type ContextCompilerDiagnosticCode =
  | "dangling_edit_target"
  | "dangling_delete_target"
  | "run_response_artifact_missing"
  | "run_result_artifact_missing"
  | "run_request_artifact_missing"
  | "run_anchor_missing";

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
    /** Phase 5：MEMORY_SNAPSHOT 真实写入时为 true（bootstrap 驱动）。 */
    memoryFacts: boolean;
    /** Phase 5：manifest 实际引用了不可变媒体制品时为 true。 */
    immutableMediaArtifacts: boolean;
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
