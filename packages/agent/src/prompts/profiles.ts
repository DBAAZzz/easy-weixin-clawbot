/**
 * Static prompt profile declarations — one per lane.
 *
 * Each profile documents and enforces what context a lane may inject.
 * Changes here are easily reviewable in PR diffs.
 */

import type { PromptLane, PromptProfile, PromptAssetSpec } from "./types.js";

export const PROMPT_PROFILES: Record<PromptLane, PromptProfile> = {
  /**
   * Main user-facing chat.
   * Full context: skills, tape memory, timestamp.
   */
  chat: {
    lane: "chat",
    systemPromptKey: "chat-system",
    injectSkills: true,
    injectTapeMemory: true,
    injectTime: true,
    injectRecentContext: false,
  },

  /**
   * Vision fallback — pure image perception.
   * No user context, memory, skills, or intent inference.
   */
  vision_describe: {
    lane: "vision_describe",
    systemPromptKey: "vision-describe",
    injectSkills: false,
    injectTapeMemory: false,
    injectTime: false,
    injectRecentContext: false,
  },

  /**
   * Heartbeat Phase 1 — lightweight goal evaluation via reasonInternal().
   * No skills or tools. Has tape memory and recent conversation context.
   */
  heartbeat_eval: {
    lane: "heartbeat_eval",
    systemPromptKey: "heartbeat-eval",
    injectSkills: false,
    injectTapeMemory: true,
    injectTime: true,
    injectRecentContext: true,
  },

  /**
   * Memory extraction — extracts structured facts from conversation turns.
   * Fully self-contained: manages its own existing-keys injection.
   * No external context injection.
   */
  memory_extract: {
    lane: "memory_extract",
    systemPromptKey: "memory-extract",
    injectSkills: false,
    injectTapeMemory: false,
    injectTime: false,
    injectRecentContext: false,
  },

  /**
   * Conversation title extraction — creates a short display title after the
   * first complete user/assistant exchange.
   */
  conversation_title: {
    lane: "conversation_title",
    systemPromptKey: "conversation-title",
    injectSkills: false,
    injectTapeMemory: false,
    injectTime: false,
    injectRecentContext: false,
  },
};

/**
 * Runtime-rendered templates that are not standalone prompt lanes.
 * These assets should not be mistaken for independent prompt profiles.
 */
export const PROMPT_TEMPLATES = {
  heartbeat_exec: "heartbeat-exec",
} as const;

/**
 * Startup validation rules for all bundled prompt assets.
 *
 * Any unresolved `{{var}}` left after startup must be explicitly allowed here,
 * otherwise bootstrap should fail fast.
 */
export const PROMPT_ASSET_SPECS: readonly PromptAssetSpec[] = [
  {
    key: "chat-system",
    allowedRuntimeVars: [],
  },
  {
    key: "vision-describe",
    allowedRuntimeVars: [],
  },
  {
    key: "heartbeat-eval",
    allowedRuntimeVars: [],
  },
  {
    key: PROMPT_TEMPLATES.heartbeat_exec,
    allowedRuntimeVars: ["goalId", "description", "context", "reason", "recentSection"],
  },
  {
    key: "memory-extract",
    allowedRuntimeVars: ["EXISTING_KEYS"],
  },
  {
    key: "conversation-title",
    allowedRuntimeVars: [],
  },
];
