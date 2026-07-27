/**
 * Pulse evaluator — decides, at this moment, whether the agent should speak.
 *
 * The model only advises. Every restraint rule (quiet hours, daily cap,
 * minimum gap, backoff) is enforced here in code, because a model that talks
 * itself into speaking is exactly the failure mode being guarded against.
 */

import { generateText } from "ai";
import { createLogger } from "@clawbot/observability";
import { resolveModel } from "../../llm/model-resolver.js";
import { recall, emptyState, formatMemoryForPrompt, GLOBAL_BRANCH } from "../../memory/index.js";
import { assembleUserContext } from "../../prompts/assembler.js";
import { getPromptAssets } from "../../prompts/port.js";
import { PROMPT_PROFILES } from "../../prompts/profiles.js";
import { extractJsonBlock } from "../../shared/utils/json.js";
import {
  type PulseRow,
  type PulseVerdict,
  type PulseDecision,
  PULSE_TIMEZONE,
  PULSE_MIN_MINUTES,
  PULSE_MAX_MINUTES,
  PULSE_QUIET_START_HOUR,
  PULSE_QUIET_END_HOUR,
  PULSE_MAX_PER_DAY,
  PULSE_MIN_GAP_MINUTES,
  PULSE_MAX_BACKOFF_STEPS,
  PULSE_PARSE_FAILURE_MINUTES,
} from "./types.js";

const logger = createLogger({ component: "heartbeat.evaluator" });

const MINUTE_MS = 60_000;

// ── Local-time helpers ─────────────────────────────────────────────

const HOUR_MINUTE_FORMAT = new Intl.DateTimeFormat("en-GB", {
  timeZone: PULSE_TIMEZONE,
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const DATE_KEY_FORMAT = new Intl.DateTimeFormat("en-CA", {
  timeZone: PULSE_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Minutes elapsed since local midnight in PULSE_TIMEZONE. */
function localMinuteOfDay(date: Date): number {
  const [hour, minute] = HOUR_MINUTE_FORMAT.format(date).split(":").map(Number);
  return hour * 60 + minute;
}

/** YYYY-MM-DD in PULSE_TIMEZONE. */
export function localDateKey(date: Date): string {
  return DATE_KEY_FORMAT.format(date);
}

export function isQuietHour(date: Date): boolean {
  const hour = Math.floor(localMinuteOfDay(date) / 60);
  return hour >= PULSE_QUIET_START_HOUR || hour < PULSE_QUIET_END_HOUR;
}

/** Minutes from `date` until the quiet window ends. */
function minutesUntilQuietEnd(date: Date): number {
  const current = localMinuteOfDay(date);
  const target = PULSE_QUIET_END_HOUR * 60;
  return current < target ? target - current : 24 * 60 - current + target;
}

// ── Verdict parsing ────────────────────────────────────────────────

function quietVerdict(reason: string, minutes: number): PulseVerdict {
  return { speak: false, reason, prompt: null, nextEvalInMinutes: minutes };
}

function readVerdict(raw: unknown): PulseVerdict | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;

  if (typeof value.speak !== "boolean") return null;

  const minutes = Number(value.next_eval_in_minutes);
  const prompt = typeof value.prompt === "string" && value.prompt.trim() ? value.prompt.trim() : null;

  return {
    speak: value.speak,
    reason: typeof value.reason === "string" ? value.reason : "",
    prompt,
    nextEvalInMinutes: Number.isFinite(minutes) ? minutes : PULSE_PARSE_FAILURE_MINUTES,
  };
}

/**
 * Parse the evaluator's output. Anything unparseable degrades to staying
 * quiet — never to speaking, which would let a malformed response reach a user.
 */
export function parsePulseVerdict(text: string): PulseVerdict {
  try {
    const parsed = readVerdict(JSON.parse(text.trim()));
    if (parsed) return parsed;
  } catch {}

  const block = extractJsonBlock(text);
  if (block) {
    try {
      const parsed = readVerdict(JSON.parse(block));
      if (parsed) return parsed;
    } catch {}
  }

  logger.warn("verdict parse failed, staying quiet", { raw: text.slice(0, 200) });
  return quietVerdict("parse_failed", PULSE_PARSE_FAILURE_MINUTES);
}

// ── Hard constraints ───────────────────────────────────────────────

/** True when the agent spoke last and the user never answered. */
function isUnanswered(pulse: PulseRow): boolean {
  if (!pulse.lastSpokeAt) return false;
  return !pulse.lastUserAt || pulse.lastUserAt < pulse.lastSpokeAt;
}

/**
 * Minimum delay before the next evaluation. Grows exponentially with the
 * quiet streak so a conversation with nothing to say decays to roughly one
 * check a day on its own, and doubles again when the user is ignoring us.
 */
function backoffFloorMinutes(pulse: PulseRow): number {
  const steps = Math.min(2 ** pulse.quietStreak, PULSE_MAX_BACKOFF_STEPS);
  const floor = PULSE_MIN_MINUTES * steps * (isUnanswered(pulse) ? 2 : 1);
  return Math.min(floor, PULSE_MAX_MINUTES);
}

function spokenToday(pulse: PulseRow, now: Date): number {
  return pulse.spokenDateKey === localDateKey(now) ? pulse.spokenToday : 0;
}

/**
 * Turn an advisory verdict into a final decision, enforcing every restraint
 * rule. A blocked verdict still reschedules — the pulse must keep beating.
 */
export function applyPulseGuards(
  pulse: PulseRow,
  verdict: PulseVerdict,
  now: Date,
): PulseDecision {
  const floor = backoffFloorMinutes(pulse);
  const requested = Math.round(verdict.nextEvalInMinutes);
  const minutes = Math.min(Math.max(requested, floor), PULSE_MAX_MINUTES);

  const defer = (blockedBy?: string): PulseDecision => ({
    speak: false,
    prompt: null,
    nextEvalAt: new Date(now.getTime() + minutes * MINUTE_MS),
    ...(blockedBy ? { blockedBy } : {}),
  });

  if (!verdict.speak) return defer();
  if (!verdict.prompt) return defer("missing_prompt");

  if (isQuietHour(now)) {
    // Hold the thought until people are awake rather than dropping it.
    return {
      speak: false,
      prompt: null,
      nextEvalAt: new Date(now.getTime() + minutesUntilQuietEnd(now) * MINUTE_MS),
      blockedBy: "quiet_hours",
    };
  }

  if (spokenToday(pulse, now) >= PULSE_MAX_PER_DAY) return defer("daily_cap");

  if (
    pulse.lastSpokeAt &&
    now.getTime() - pulse.lastSpokeAt.getTime() < PULSE_MIN_GAP_MINUTES * MINUTE_MS
  ) {
    return defer("min_gap");
  }

  return {
    speak: true,
    prompt: verdict.prompt,
    nextEvalAt: new Date(now.getTime() + minutes * MINUTE_MS),
  };
}

// ── Evaluation ─────────────────────────────────────────────────────

function describeElapsed(from: Date | null, now: Date): string {
  if (!from) return "从未";
  const minutes = Math.max(0, Math.round((now.getTime() - from.getTime()) / MINUTE_MS));
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} 小时`;
  return `${Math.round(hours / 24)} 天`;
}

export function buildPulseStateText(pulse: PulseRow, now: Date): string {
  return [
    "## 当前状态",
    `- 距他上次说话: ${describeElapsed(pulse.lastUserAt, now)}`,
    `- 距你上次主动开口: ${describeElapsed(pulse.lastSpokeAt, now)}`,
    `- 连续判定无话可说: ${pulse.quietStreak} 次`,
    `- 今日已主动开口: ${spokenToday(pulse, now)} 次（上限 ${PULSE_MAX_PER_DAY}）`,
    pulse.lastSpokeAt && isUnanswered(pulse) ? "- 你上次主动开口后他没有回应" : "",
    "",
    "现在要主动找他说话吗？",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Ask the model whether to speak. Side-effect free: nothing is persisted. */
export async function evaluatePulse(pulse: PulseRow, now: Date): Promise<PulseVerdict> {
  const profile = PROMPT_PROFILES.pulse_eval;
  const model = await resolveModel(pulse.accountId, pulse.conversationId, "chat");

  const [sessionMemory, globalMemory] = await Promise.all([
    recall(pulse.accountId, pulse.conversationId).catch(() => emptyState()),
    recall(pulse.accountId, GLOBAL_BRANCH).catch(() => emptyState()),
  ]);

  const assembled = assembleUserContext(profile, {
    tapeMemory: formatMemoryForPrompt(globalMemory, sessionMemory) || undefined,
    time: now,
    userText: buildPulseStateText(pulse, now),
  });

  const result = await generateText({
    model: model.model,
    system: getPromptAssets().get(profile.systemPromptKey),
    messages: [{ role: "user", content: assembled }],
  });

  return parsePulseVerdict(result.text);
}
