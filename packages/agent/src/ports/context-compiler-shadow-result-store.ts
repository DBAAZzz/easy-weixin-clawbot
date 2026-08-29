export const CONTEXT_COMPILER_SHADOW_RESULT_DIFF_CATEGORIES = [
  "match_user_text",
  "legacy_user_has_runtime_time",
  "legacy_user_has_tape_memory",
  "legacy_user_has_visual_fallback",
  "legacy_quoted_display_only",
  "legacy_only_assistant_entry",
  "legacy_only_tool_entry",
  "canonical_unresolved_attachment",
  "session_boundary_difference",
  "entry_order_difference",
  "unclassified_difference",
  "shadow_compile_failed",
] as const;

export type ContextCompilerShadowResultDiffCategory =
  (typeof CONTEXT_COMPILER_SHADOW_RESULT_DIFF_CATEGORIES)[number];
export type ContextCompilerShadowResultDiffCounts = Record<
  ContextCompilerShadowResultDiffCategory,
  number
>;

export interface ContextCompilerShadowResultRecord {
  sourceEventId: string;
  accountId: string;
  compilerVersion: string;
  contextPolicyRevisionId: string;
  eventCursor: number;
  effectiveTime: string;
  timezone: string;
  canonicalContextHash?: string;
  canonicalMemoryInputHash?: string;
  legacySummaryHash?: string;
  canonicalEntryCount?: number;
  legacyEntryCount?: number;
  diffCounts: ContextCompilerShadowResultDiffCounts;
  status: "success" | "failed";
  errorCode?: string;
}

export interface ContextCompilerShadowResultStore {
  createOrVerifyEquivalent(result: ContextCompilerShadowResultRecord): Promise<void>;
}

export class ContextCompilerShadowResultEquivalenceError extends Error {
  override readonly name = "ContextCompilerShadowResultEquivalenceError";
  /** Stable code so shadow observers can report the conflict without string matching. */
  readonly code = "context_compiler_shadow_result_equivalence_conflict";

  constructor(sourceEventId: string) {
    super(`context_compiler_shadow_result_equivalence_conflict:${sourceEventId}`);
  }
}
