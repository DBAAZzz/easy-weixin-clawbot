import type { CanonicalContextV1 } from "./types.js";

export interface CanonicalMemoryExtractionInputV1 {
  schemaVersion: 1;
  entries: Array<{
    eventId: string;
    role: "user" | "assistant";
    text: string;
  }>;
}

export function buildCanonicalMemoryExtractionInput(
  context: CanonicalContextV1,
): CanonicalMemoryExtractionInputV1 {
  return {
    schemaVersion: 1,
    entries: context.entries.map(({ eventId, role, text }) => ({ eventId, role, text })),
  };
}
