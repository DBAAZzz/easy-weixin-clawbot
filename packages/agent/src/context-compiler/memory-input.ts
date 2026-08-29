import type { CanonicalContextV1, CanonicalConversationEntryV1 } from "./types.js";

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
    // Tool results never enter memory extraction input (Phase 4 design §10.7);
    // a no-op for policy v1, whose entries are user/assistant only.
    entries: context.entries
      .filter(
        (entry): entry is CanonicalConversationEntryV1 & { role: "user" | "assistant" } =>
          entry.role !== "tool",
      )
      .map(({ eventId, role, text }) => ({ eventId, role, text })),
  };
}
