import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  DEFAULT_BRIEF_MAX_ITEMS,
  DEFAULT_DIGEST_MAX_ITEMS,
  MAX_CONTENT_LENGTH,
  MAX_TASK_ITEMS,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  COLLECT_INTERVAL_MS,
} from "./constants.js";
import type {
  RssSourceStatus,
  RssTaskKind,
  SilentWindowConfig,
  SourceRecord,
} from "./types.js";
import { RssValidationError } from "./errors.js";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

export function getRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

export function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function normalizeMultilineWhitespace(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/([：:]) (?=[@#])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncateText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

export function stripHtmlTags(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<audio[\s\S]*?<\/audio>/gi, " ")
    .replace(/<video[\s\S]*?<\/video>/gi, " ")
    .replace(/<[^>]+>/g, " ");
}

export function stripHtmlTagsPreservingBreaks(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<img[^>]*>/gi, " ")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, " ")
    .replace(/<audio[\s\S]*?<\/audio>/gi, " ")
    .replace(/<video[\s\S]*?<\/video>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|section|article|header|footer|blockquote|pre|h[1-6]|tr)>/gi, "\n\n")
    .replace(/<(ul|ol)[^>]*>/gi, "\n")
    .replace(/<\/(ul|ol)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
}

export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;|&#x27;/g, "'")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function sanitizeText(value: string | null): string | null {
  if (!value) return null;
  const cleaned = normalizeWhitespace(decodeHtmlEntities(stripHtmlTags(value)));
  return cleaned || null;
}

export function sanitizeStructuredText(value: string | null): string | null {
  if (!value) return null;
  const cleaned = normalizeMultilineWhitespace(
    decodeHtmlEntities(stripHtmlTagsPreservingBreaks(value)),
  );
  return cleaned || null;
}

export function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function coerceText(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const joined = value.map((item) => coerceText(item)).filter(Boolean).join(" ");
    return joined || null;
  }

  if (isRecord(value)) {
    return (
      coerceText(value["#text"]) ??
      coerceText(value.cdata) ??
      coerceText(value.text) ??
      coerceText(value.value) ??
      null
    );
  }

  return null;
}

export function normalizeLink(rawLink: string | null): string | null {
  if (!rawLink) return null;

  try {
    const url = new URL(rawLink);
    const keysToDelete = [...url.searchParams.keys()].filter(
      (key) => key.startsWith("utm_") || key === "spm" || key === "from",
    );

    for (const key of keysToDelete) {
      url.searchParams.delete(key);
    }

    url.hash = "";
    return url.toString();
  } catch {
    return rawLink;
  }
}

export function createFingerprint(
  guid: string | null,
  normalizedLink: string | null,
  title: string,
  publishedAt: Date | null,
): string {
  const raw = guid
    ? `guid:${guid}`
    : normalizedLink
      ? `link:${normalizedLink}`
      : `fallback:${normalizeWhitespace(title).toLowerCase()}|${publishedAt?.toISOString() ?? ""}`;

  return createHash("sha256").update(raw).digest("hex");
}

export function defaultMaxItems(taskKind: RssTaskKind): number {
  return taskKind === "rss_digest" ? DEFAULT_DIGEST_MAX_ITEMS : DEFAULT_BRIEF_MAX_ITEMS;
}

export function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export function buildSourceErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "RSS source request failed";
}

export function backoffDelayMs(failureStreak: number): number {
  return Math.min(60, Math.max(10, failureStreak * 5)) * 60 * 1000;
}

export function shouldCollectSource(source: SourceRecord, now: Date): boolean {
  if (!source.enabled || source.status === "disabled") {
    return false;
  }

  if (source.status === "error") {
    return false;
  }

  if (source.backoffUntil && source.backoffUntil.getTime() > now.getTime()) {
    return false;
  }

  if (!source.lastFetchedAt) {
    return true;
  }

  return now.getTime() - source.lastFetchedAt.getTime() >= COLLECT_INTERVAL_MS;
}

export function sourceToRecord(source: SourceRecord): SourceRecord {
  return source;
}

export function parseSilentWindow(value: unknown): SilentWindowConfig | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (!isRecord(value)) {
    throw new RssValidationError("silent_window must be an object or null");
  }

  const start = value.start;
  const end = value.end;

  if (typeof start !== "string" || typeof end !== "string") {
    throw new RssValidationError("silent_window.start and silent_window.end must be strings");
  }

  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
    throw new RssValidationError("silent_window must use HH:mm format");
  }

  return { start, end };
}

export function currentTimeInTimezone(timezone: string): number {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}

export function isInSilentWindow(
  silentWindow: SilentWindowConfig | null,
  timezone: string,
): boolean {
  if (!silentWindow) {
    return false;
  }

  const [startHour, startMinute] = silentWindow.start.split(":").map(Number);
  const [endHour, endMinute] = silentWindow.end.split(":").map(Number);
  const now = currentTimeInTimezone(timezone);
  const start = startHour * 60 + startMinute;
  const end = endHour * 60 + endMinute;

  if (start === end) {
    return false;
  }

  if (start < end) {
    return now >= start && now < end;
  }

  return now >= start || now < end;
}

export {
  MAX_TITLE_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_CONTENT_LENGTH,
  MAX_TASK_ITEMS,
};
