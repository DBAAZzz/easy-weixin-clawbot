import type { CanonicalContextV1 } from "../../context-compiler/types.js";
import {
  emptyContextCompilerShadowDiffCounts,
  type ContextCompilerShadowDiffCounts,
} from "../../context-compiler/diff-types.js";
import type { LegacyContextSummary } from "./legacy-normalizer.js";

export interface ContextShadowDiffResult {
  counts: ContextCompilerShadowDiffCounts;
  canonicalEntryCount: number;
  legacyEntryCount: number;
}

export function diffCanonicalAndLegacy(
  canonical: CanonicalContextV1,
  legacy: LegacyContextSummary,
): ContextShadowDiffResult {
  const counts = emptyContextCompilerShadowDiffCounts();
  const canonicalUsers = canonical.entries.filter((entry) => entry.role === "user");

  for (const entry of legacy.userEntries) {
    if (entry.hasRuntimeTime) counts.legacy_user_has_runtime_time += 1;
    if (entry.hasTapeMemory) counts.legacy_user_has_tape_memory += 1;
    if (entry.hasVisualFallback) counts.legacy_user_has_visual_fallback += 1;
    if (entry.quotedDisplayOnly) counts.legacy_quoted_display_only += 1;
  }
  // "legacy-only" means present on the legacy side and missing on the canonical
  // side; canonical V1 already carries outbound assistant facts when they exist.
  const canonicalAssistantEntryCount = canonical.entries.filter(
    (entry) => entry.role === "assistant",
  ).length;
  counts.legacy_only_assistant_entry = Math.max(
    0,
    legacy.assistantEntryCount - canonicalAssistantEntryCount,
  );
  // Phase 4 (policy v2) adds run-derived tool entries; v1 contexts have none,
  // which makes the subtraction a no-op there.
  const canonicalToolEntryCount = canonical.entries.filter(
    (entry) => entry.role === "tool",
  ).length;
  counts.legacy_only_tool_entry = Math.max(0, legacy.toolEntryCount - canonicalToolEntryCount);
  counts.canonical_unresolved_attachment = canonical.entries.reduce(
    (total, entry) =>
      total +
      entry.attachments.filter((attachment) => attachment.resolution.status === "unresolved")
        .length,
    0,
  );

  const canonicalTexts = canonicalUsers.map((entry) => entry.text);
  const legacyTexts = legacy.userEntries.map((entry) => entry.normalizedText);
  const comparisonLength = Math.min(canonicalTexts.length, legacyTexts.length);
  for (let index = 0; index < comparisonLength; index += 1) {
    if (canonicalTexts[index] === legacyTexts[index]) counts.match_user_text += 1;
  }

  const sameMembers =
    canonicalTexts.length === legacyTexts.length &&
    [...canonicalTexts].sort().every((text, index) => text === [...legacyTexts].sort()[index]);
  if (sameMembers && canonicalTexts.some((text, index) => text !== legacyTexts[index])) {
    counts.entry_order_difference += 1;
  }

  const unmatched = Math.max(canonicalTexts.length, legacyTexts.length) - counts.match_user_text;
  if (unmatched > 0) {
    if (canonical.sessionBoundaryEventId && legacyTexts.length > canonicalTexts.length) {
      counts.session_boundary_difference += unmatched;
    } else if (counts.entry_order_difference === 0) {
      counts.unclassified_difference += unmatched;
    }
  }

  return {
    counts,
    canonicalEntryCount: canonical.entries.length,
    legacyEntryCount: legacy.roleOrder.length,
  };
}
