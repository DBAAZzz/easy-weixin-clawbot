import {
  CONTEXT_COMPILER_SHADOW_RESULT_DIFF_CATEGORIES,
  type ContextCompilerShadowResultDiffCategory,
  type ContextCompilerShadowResultDiffCounts,
} from "../ports/context-compiler-shadow-result-store.js";

export const CONTEXT_COMPILER_SHADOW_DIFF_CATEGORIES =
  CONTEXT_COMPILER_SHADOW_RESULT_DIFF_CATEGORIES;
export type ContextCompilerShadowDiffCategory = ContextCompilerShadowResultDiffCategory;
export type ContextCompilerShadowDiffCounts = ContextCompilerShadowResultDiffCounts;

export function emptyContextCompilerShadowDiffCounts(): ContextCompilerShadowDiffCounts {
  return Object.fromEntries(
    CONTEXT_COMPILER_SHADOW_DIFF_CATEGORIES.map((category) => [category, 0]),
  ) as ContextCompilerShadowDiffCounts;
}
