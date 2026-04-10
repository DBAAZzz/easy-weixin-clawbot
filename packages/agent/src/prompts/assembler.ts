/**
 * Prompt assembler — builds final prompts from profiles, assets, and runtime context.
 *
 * Two main functions:
 * - `assembleSystemPrompt()` — base asset + optional skill catalog
 * - `assembleUserContext()` — time + memory + recent context + user text
 */

import type { PromptProfile } from "./types.js";
import type { SkillRegistry } from "../skills/types.js";

const TEMPLATE_VAR_PATTERN = /\{\{(\w+)\}\}/g;

// ── Template rendering ─────────────────────────────────────────────

/**
 * Simple `{{key}}` template variable replacement.
 * Used both at load-time (startup vars) and at runtime (lane-specific vars).
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string>,
  options?: { strict?: boolean },
): string {
  const rendered = template.replace(TEMPLATE_VAR_PATTERN, (match, key: string) =>
    key in vars ? vars[key] : match,
  );

  if (options?.strict) {
    const unresolved = listTemplateVars(rendered);
    if (unresolved.length > 0) {
      throw new Error(`Unresolved template vars: ${unresolved.join(", ")}`);
    }
  }

  return rendered;
}

export function listTemplateVars(template: string): string[] {
  const matches = template.matchAll(TEMPLATE_VAR_PATTERN);
  return [...new Set(Array.from(matches, (match) => match[1]))];
}

export function validateTemplateVars(
  assetKey: string,
  template: string,
  allowedRuntimeVars: readonly string[] = [],
): void {
  const unresolved = listTemplateVars(template);
  const unexpected = unresolved.filter((name) => !allowedRuntimeVars.includes(name));
  if (unexpected.length > 0) {
    throw new Error(
      `Prompt asset "${assetKey}" has unexpected unresolved template vars: ${unexpected.join(", ")}`,
    );
  }
}

// ── System prompt assembly ─────────────────────────────────────────

/**
 * Build the final system prompt for a lane.
 *
 * @param profile - The lane's prompt profile
 * @param basePrompt - The loaded prompt asset content (already variable-resolved)
 * @param skills - Skill registry (only consulted if profile.injectSkills is true)
 */
export function assembleSystemPrompt(
  profile: PromptProfile,
  basePrompt: string,
  skills?: SkillRegistry,
): string {
  let prompt = basePrompt;

  if (profile.injectSkills && skills) {
    const snapshot = skills.current();

    for (const skill of snapshot.alwaysOn) {
      prompt += `\n\n[Skill: ${skill.name}]\n${skill.body}`;
    }

    if (snapshot.index.length > 0) {
      prompt += "\n\n你有以下可用技能，需要时调用 use_skill 加载：";
      for (const skill of snapshot.index) {
        prompt += `\n- ${skill.name}: ${skill.summary}`;
      }
    }
  }

  return prompt;
}

// ── User context assembly ──────────────────────────────────────────

export interface UserContextOptions {
  /** Formatted tape memory string (from `formatMemoryForPrompt()`) */
  tapeMemory?: string;
  /** Current time (defaults to `new Date()` if profile requires it) */
  time?: Date;
  /** Recent messages from source conversation */
  recentContext?: string;
  /** The actual user input text */
  userText: string;
}

const TIME_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  weekday: "short",
};

/**
 * Build the user message content for a lane.
 *
 * Prepends context fragments (time, memory, recent messages) based on the profile,
 * then appends the actual user text.
 */
export function assembleUserContext(
  profile: PromptProfile,
  opts: UserContextOptions,
): string {
  const parts: string[] = [];

  if (profile.injectTime) {
    const time = opts.time ?? new Date();
    parts.push(
      `[当前时间: ${time.toLocaleString("zh-CN", TIME_FORMAT)}]\n`,
    );
  }

  if (profile.injectTapeMemory && opts.tapeMemory) {
    parts.push(opts.tapeMemory + "\n");
  }

  if (profile.injectRecentContext && opts.recentContext) {
    parts.push(`[源会话近期消息]\n${opts.recentContext}\n`);
  }

  parts.push(opts.userText);
  return parts.join("");
}
