/**
 * Prompt profile types — declarative definitions of what each LLM lane injects.
 */

/** Distinct LLM invocation channels in the system. */
export type PromptLane =
  | "chat"
  | "heartbeat_eval"
  | "memory_extract";

/**
 * Declares what a given lane is allowed to inject into its LLM call.
 *
 * This makes the previously implicit injection decisions
 * (scattered across chat.ts, evaluator.ts, reason-internal.ts, extractor.ts)
 * into an explicit, reviewable configuration.
 */
export interface PromptProfile {
  lane: PromptLane;
  /** Key to look up the prompt asset (maps to `packages/agent/prompts/<key>.md`) */
  systemPromptKey: string;
  /** Append skill catalog to system prompt */
  injectSkills: boolean;
  /** Prepend tape memory context to user message */
  injectTapeMemory: boolean;
  /** Prepend current timestamp to user message */
  injectTime: boolean;
  /** Prepend recent conversation messages to user message */
  injectRecentContext: boolean;
}

/**
 * Loaded prompt asset store.
 * Returned by `loadPromptAssets()`, consumed by the assembler and lane code.
 */
export interface PromptAssets {
  /** Get a loaded prompt by key. Throws if key not found. */
  get(key: string): string;
}

export interface PromptAssetSpec {
  /** Key that maps to `<promptsDir>/<key>.md`. */
  key: string;
  /**
   * Template variables that are expected to remain unresolved after startup.
   * These are filled later by the calling lane at runtime.
   */
  allowedRuntimeVars?: readonly string[];
}
