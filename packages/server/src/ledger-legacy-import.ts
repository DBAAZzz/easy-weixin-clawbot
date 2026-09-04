/**
 * ledger-legacy-import — backfill pre-ledger messages into conversation events
 * (Phase 7 design §5).
 *
 * For every conversation of one account, the rows in the `messages` projection
 * that predate the fact ledger (seq below the smallest persisted projection
 * link, or everything when the stream never had events) are imported as ONE
 * `legacy_transcript_imported` batch event per stream. The assembled texts are
 * carried opaquely — nothing is parsed back into "用户原文 vs 注入" — and the
 * payload declares `reconstructability: "partial"`.
 *
 * Boundary rules (§5.2):
 * - stream has a session boundary (`session_rotated`) → `skipped_cleared`;
 * - persisted projection links exist → legacy = messages.seq < min(link seq);
 * - no links but the stream has zero events → everything is legacy;
 * - no links but events exist → `refused_no_boundary` (never guess).
 *
 * Idempotent: the eventId is derived from (accountId, streamId); re-running
 * with an unchanged transcript hits the store's id-retry semantics
 * (`skipped_imported`).
 *
 * Usage: pnpm -F @clawbot/server ledger:legacy-import -- --account <id>
 *   [--conversation <id>] [--max-entries 500] [--dry-run]
 */

import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import type { PrismaClient } from "@prisma/client";
import type { ConversationEventStore, ImageContent } from "@clawbot/agent";
import { LEGACY_TRANSCRIPT_MAX_ENTRIES, parseAppendConversationEventInput } from "@clawbot/agent";
import { legacyImportTotal } from "@clawbot/observability";
import { PrismaConversationEventStore } from "./db/conversation-event-store.impl.js";
import { getPrisma } from "./db/prisma.js";
import { createModuleLogger, getErrorFields } from "./logger.js";

const logger = createModuleLogger("ledger-legacy-import");

export type LegacyImportResult =
  | { result: "appended"; eventId: string; entryCount: number; omittedEntryCount: number }
  | { result: "dry_run"; eventId: string; entryCount: number; omittedEntryCount: number }
  | { result: "skipped_imported" }
  | { result: "skipped_empty" }
  | { result: "skipped_cleared" }
  | { result: "refused_no_boundary" }
  | { result: "refused_too_large"; reason: string }
  | { result: "failed"; reason: string };

export interface LegacyImportSummary {
  accountId: string;
  dryRun: boolean;
  maxEntries: number;
  streams: Array<{ conversationId: string } & LegacyImportResult>;
  failed: number;
}

interface LegacyEntryDraft {
  sourceMessageSeq: number;
  role: "user" | "assistant" | "trigger" | "tool";
  occurredAt: string;
  text: string;
  attachmentRefs?: string[];
  callId?: string;
  toolName?: string;
  toolArguments?: string;
  toolError?: boolean;
  /** Tool-call rounds carry no text but must survive the empty-text filter. */
  keepEvenIfEmpty?: boolean;
}

const MAX_ENTRY_TEXT_LENGTH = 65_536;

export function legacyImportEventId(accountId: string, streamId: string): string {
  const digest = createHash("sha256")
    .update(accountId, "utf8")
    .update("\0", "utf8")
    .update(streamId, "utf8")
    .digest("hex");
  return `legacy-import-v1:${digest}`;
}

interface ContentBlock {
  type?: string;
  text?: string;
  assetId?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

interface MessageRowLike {
  seq: number;
  role: string;
  createdAt: Date;
  payload: unknown;
}

function blocksOf(payload: unknown): { blocks: ContentBlock[]; message: Record<string, unknown> } {
  const message = (payload ?? {}) as Record<string, unknown>;
  const blocks = Array.isArray(message.content) ? (message.content as ContentBlock[]) : [];
  return { blocks, message };
}

function isPlaceholderText(text: string): boolean {
  // prepareUserVisualContent placeholders (missing vision model / failed
  // recognition) — capability-degradation artifacts, not historical content.
  return text.startsWith("[图片") || text.startsWith("[image unavailable");
}

function joinedText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

/**
 * Convert one messages row into legacy entry drafts. A user row yields one
 * entry (first non-placeholder text block — the assembled user text — plus
 * image asset refs; placeholder blocks and promptReplacementText are dropped).
 * An assistant row yields its text and records its tool calls so later
 * toolResult rows can carry serialized arguments. A toolResult row yields the
 * paired tool entry.
 */
function draftsForRow(
  row: MessageRowLike,
  toolCallsByAssistant: Map<string, { toolName: string; toolArguments?: string }>,
): LegacyEntryDraft[] {
  const { blocks, message } = blocksOf(row.payload);
  const occurredAt = row.createdAt.toISOString();
  const imageRefs = blocks
    .filter((block) => block.type === "image" && typeof block.assetId === "string")
    .map((block) => (block as ImageContent).assetId!);

  if (row.role === "user") {
    const mainText =
      blocks.find((block) => block.type === "text" && !isPlaceholderText(block.text ?? ""))
        ?.text ?? "";
    return [
      {
        sourceMessageSeq: row.seq,
        role: "user",
        occurredAt,
        text: mainText,
        ...(imageRefs.length > 0 ? { attachmentRefs: imageRefs } : {}),
      },
    ];
  }

  if (row.role === "trigger") {
    return [{ sourceMessageSeq: row.seq, role: "trigger", occurredAt, text: joinedText(blocks) }];
  }

  if (row.role === "assistant") {
    for (const block of blocks) {
      if (block.type !== "toolCall" || typeof block.id !== "string") continue;
      toolCallsByAssistant.set(block.id, {
        toolName: typeof block.name === "string" ? block.name : "unknown",
        toolArguments: block.arguments === undefined ? undefined : JSON.stringify(block.arguments),
      });
    }
    const callBlockCount = blocks.filter((block) => block.type === "toolCall").length;
    return [
      {
        sourceMessageSeq: row.seq,
        role: "assistant",
        occurredAt,
        text: joinedText(blocks),
        ...(callBlockCount > 0 ? { keepEvenIfEmpty: true } : {}),
      },
    ];
  }

  if (row.role === "toolResult") {
    const callId = typeof message.toolCallId === "string" ? message.toolCallId : undefined;
    const requested = callId ? toolCallsByAssistant.get(callId) : undefined;
    return [
      {
        sourceMessageSeq: row.seq,
        role: "tool",
        occurredAt,
        text: joinedText(blocks),
        ...(callId !== undefined ? { callId } : {}),
        toolName: requested?.toolName ?? (typeof message.toolName === "string" ? message.toolName : undefined),
        ...(requested?.toolArguments !== undefined ? { toolArguments: requested.toolArguments } : {}),
        ...(message.isError === true ? { toolError: true } : {}),
      },
    ];
  }

  return [];
}

/**
 * Import one conversation stream. See the module doc for the boundary rules.
 */
export async function importLegacyTranscript(input: {
  accountId: string;
  conversationId: string;
  maxEntries: number;
  dryRun: boolean;
  /** 测试注入；缺省用全局 Prisma 与端口实现。 */
  injectedPrisma?: PrismaClient;
  conversationEventStore?: ConversationEventStore;
}): Promise<LegacyImportResult> {
  const { accountId, conversationId, maxEntries, dryRun } = input;
  const prisma = input.injectedPrisma ?? getPrisma();
  const eventStore = input.conversationEventStore ?? new PrismaConversationEventStore();

  try {
    // A session boundary anywhere in the stream means the user cleared
    // history — the cleared semantics win and nothing is imported (§5.2).
    const boundary = await prisma.conversationEvent.findFirst({
      where: { accountId, streamId: conversationId, eventType: "session_rotated" },
      select: { eventId: true },
    });
    if (boundary) {
      legacyImportTotal.inc({ result: "skipped_cleared" });
      return { result: "skipped_cleared" };
    }

    // Idempotency first (§5.2): once a stream carries an import event, re-runs
    // short-circuit — the boundary rules below assume an unimported stream,
    // and the stream head now includes the import event itself.
    const existingImport = await prisma.conversationEvent.findFirst({
      where: { accountId, streamId: conversationId, eventType: "legacy_transcript_imported" },
      select: { eventId: true },
    });
    if (existingImport) {
      legacyImportTotal.inc({ result: "skipped_imported" });
      return { result: "skipped_imported" };
    }

    const head = await prisma.conversationStreamHead.findUnique({
      where: { accountId_streamId: { accountId, streamId: conversationId } },
      select: { lastSeq: true },
    });
    const eventCount = head?.lastSeq ?? 0;

    const earliestLink = await prisma.legacyMessageProjectionLink.findFirst({
      where: { accountId, conversationId, state: "persisted" },
      orderBy: { messageSeq: "asc" },
      select: { messageSeq: true },
    });

    let legacyRows: MessageRowLike[];
    if (earliestLink) {
      legacyRows = await prisma.message.findMany({
        where: { accountId, conversationId, seq: { lt: earliestLink.messageSeq } },
        select: { seq: true, role: true, createdAt: true, payload: true },
        orderBy: { seq: "asc" },
      });
    } else if (eventCount === 0) {
      // No links and no events: the conversation was never ledgered —
      // everything is legacy.
      legacyRows = await prisma.message.findMany({
        where: { accountId, conversationId },
        select: { seq: true, role: true, createdAt: true, payload: true },
        orderBy: { seq: "asc" },
      });
    } else {
      // Events exist but no projection link pins the ledger boundary — the
      // split point is undecidable without guessing, so refuse (§5.2).
      legacyImportTotal.inc({ result: "refused_no_boundary" });
      return { result: "refused_no_boundary" };
    }

    if (legacyRows.length === 0) {
      legacyImportTotal.inc({ result: "skipped_empty" });
      return { result: "skipped_empty" };
    }

    const toolCallsByAssistant = new Map<string, { toolName: string; toolArguments?: string }>();
    const drafts = legacyRows.flatMap((row) => draftsForRow(row, toolCallsByAssistant));
    const nonEmpty = drafts.filter(
      (draft) => draft.text !== "" || draft.role === "tool" || draft.keepEvenIfEmpty === true,
    );
    if (nonEmpty.length === 0) {
      legacyImportTotal.inc({ result: "skipped_empty" });
      return { result: "skipped_empty" };
    }

    const oversized = nonEmpty.find((draft) => draft.text.length > MAX_ENTRY_TEXT_LENGTH);
    if (oversized) {
      legacyImportTotal.inc({ result: "refused_too_large" });
      return {
        result: "refused_too_large",
        reason: `entry_text_too_large:${oversized.sourceMessageSeq}`,
      };
    }

    // Cap the batch by omitting the OLDEST entries (explicit, counted — §5.1).
    const ordered = [...nonEmpty].sort((a, b) => a.sourceMessageSeq - b.sourceMessageSeq);
    const omittedEntryCount = Math.max(0, ordered.length - maxEntries);
    const kept = ordered.slice(ordered.length - maxEntries);
    const boundaryMessageSeq = ordered.at(-1)?.sourceMessageSeq ?? 0;

    const entries = kept.map((draft) => {
      const {
        sourceMessageSeq,
        role,
        occurredAt,
        text,
        attachmentRefs,
        callId,
        toolName,
        toolArguments,
        toolError,
      } = draft;
      return {
        sourceMessageSeq,
        role,
        occurredAt,
        text,
        ...(attachmentRefs ? { attachmentRefs } : {}),
        ...(callId !== undefined ? { callId } : {}),
        ...(toolName !== undefined ? { toolName } : {}),
        ...(toolArguments !== undefined ? { toolArguments } : {}),
        ...(toolError !== undefined ? { toolError } : {}),
      };
    });

    const eventId = legacyImportEventId(accountId, conversationId);
    // occurredAt must be deterministic for id-retry equivalence (§5.1): the
    // timestamp of the newest imported message — "when the legacy era ends" —
    // rather than the import wall clock.
    const eventOccurredAt = kept.at(-1)!.occurredAt;
    const eventInput = parseAppendConversationEventInput({
      eventId,
      eventType: "legacy_transcript_imported",
      schemaVersion: 1,
      accountId,
      streamId: conversationId,
      occurredAt: eventOccurredAt,
      receivedAt: new Date().toISOString(),
      actor: { kind: "system" },
      payload: {
        source: "messages_projection",
        reconstructability: "partial",
        boundaryMessageSeq,
        omittedEntryCount,
        entries,
      },
    });

    if (dryRun) {
      return { result: "dry_run", eventId, entryCount: entries.length, omittedEntryCount };
    }

    const appended = await eventStore.append(eventInput);
    if (!appended.appended) {
      // Same id + same payload → already imported (idempotent re-run).
      legacyImportTotal.inc({ result: "skipped_imported" });
      return { result: "skipped_imported" };
    }
    legacyImportTotal.inc({ result: "appended" });
    return {
      result: "appended",
      eventId,
      entryCount: entries.length,
      omittedEntryCount,
    };
  } catch (error) {
    legacyImportTotal.inc({ result: "failed" });
    return {
      result: "failed",
      reason: error instanceof Error ? error.message : "import_failed",
    };
  }
}

export async function runLegacyImport(options: {
  accountId: string;
  conversationId?: string;
  maxEntries: number;
  dryRun: boolean;
  injectedPrisma?: PrismaClient;
  conversationEventStore?: ConversationEventStore;
}): Promise<LegacyImportSummary> {
  const { accountId, conversationId, maxEntries, dryRun } = options;
  const prisma = options.injectedPrisma ?? getPrisma();
  const conversations = await prisma.message.findMany({
    where: { accountId, ...(conversationId ? { conversationId } : {}) },
    distinct: ["conversationId"],
    select: { conversationId: true },
    orderBy: { conversationId: "asc" },
  });

  const streams: LegacyImportSummary["streams"] = [];
  let failed = 0;
  for (const { conversationId: id } of conversations) {
    const result = await importLegacyTranscript({
      accountId,
      conversationId: id,
      maxEntries,
      dryRun,
      injectedPrisma: options.injectedPrisma,
      conversationEventStore: options.conversationEventStore,
    });
    if (result.result === "failed") failed += 1;
    streams.push({ conversationId: id, ...result });
  }

  return { accountId, dryRun, maxEntries, streams, failed };
}

// CLI entry — library callers import { runLegacyImport } instead.
if (process.argv[1] && process.argv[1].endsWith("ledger-legacy-import.ts")) {
  const { values } = parseArgs({
    options: {
      account: { type: "string" },
      conversation: { type: "string" },
      "max-entries": { type: "string", default: "500" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  const accountId = values.account;
  if (!accountId) {
    console.error(
      "usage: ledger:legacy-import --account <id> [--conversation <id>] [--max-entries N] [--dry-run]",
    );
    process.exit(2);
  }
  const maxEntries = Math.min(
    LEGACY_TRANSCRIPT_MAX_ENTRIES,
    Math.max(1, Number.parseInt(values["max-entries"] ?? "500", 10) || 500),
  );
  runLegacyImport({
    accountId,
    conversationId: values.conversation,
    maxEntries,
    dryRun: values["dry-run"] ?? false,
  })
    .then((summary) => {
      console.log(JSON.stringify(summary, null, 2));
      if (summary.failed > 0) process.exit(1);
    })
    .catch((error) => {
      logger.error({ ...getErrorFields(error) }, "ledger:legacy-import failed");
      process.exit(1);
    });
}
