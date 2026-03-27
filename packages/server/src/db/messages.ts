import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { Prisma } from "@prisma/client";
import type { ImageContent, Message, TextContent } from "@mariozechner/pi-ai";
import type { MessageRow, PaginatedResponse } from "@clawbot/shared";
import { log } from "../logger.js";
import { MEDIA_CACHE_DIR } from "../paths.js";
import { getPrisma } from "./prisma.js";

type StoredMessageRecord = Omit<MessageRow, "id" | "created_at">;
type QueueItem = {
  record: StoredMessageRecord;
  attempts: number;
};

type StoredImageContent = ImageContent & {
  filePath?: string;
  stripped?: boolean;
};

const queue: QueueItem[] = [];
let flushing = false;
let retryTimer: NodeJS.Timeout | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTextContent(value: unknown): value is TextContent {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      (value as { type?: string }).type === "text" &&
      typeof (value as { text?: unknown }).text === "string"
  );
}

function isImageContent(value: unknown): value is StoredImageContent {
  return Boolean(
    value &&
      typeof value === "object" &&
      "type" in value &&
      (value as { type?: string }).type === "image" &&
      typeof (value as { mimeType?: unknown }).mimeType === "string"
  );
}

function extractText(message: Message): string | null {
  if (typeof message.content === "string") {
    return message.content;
  }

  if (!Array.isArray(message.content)) {
    return null;
  }

  const parts = message.content
    .map((block) => {
      if (isTextContent(block)) return block.text;
      if (
        block &&
        typeof block === "object" &&
        "type" in block &&
        (block as { type?: string }).type === "toolCall"
      ) {
        const name = String((block as { name?: unknown }).name ?? "tool");
        return `[tool:${name}]`;
      }
      return "";
    })
    .filter(Boolean);

  return parts.length > 0 ? parts.join("\n") : null;
}

function extractMediaType(message: Message): string | null {
  if (typeof message.content !== "object" || !Array.isArray(message.content)) return null;
  return message.content.some((block) => isImageContent(block)) ? "image" : null;
}

async function copyMediaToCache(
  sourcePath: string,
  accountId: string,
  conversationId: string,
  seq: number
): Promise<string> {
  await mkdir(MEDIA_CACHE_DIR, { recursive: true });
  const extension = extname(sourcePath) || ".bin";
  const fileName = `${accountId}-${conversationId}-${seq}-${randomUUID()}${extension}`;
  const targetPath = join(MEDIA_CACHE_DIR, fileName);
  await copyFile(sourcePath, targetPath);
  return targetPath;
}

async function serializeMessage(
  accountId: string,
  conversationId: string,
  message: Message,
  seq: number,
  mediaSourcePath?: string
): Promise<Record<string, unknown>> {
  const clone = structuredClone(message) as Message & { content: unknown };

  if (!Array.isArray(clone.content)) {
    return clone as unknown as Record<string, unknown>;
  }

  let cachedPath: string | undefined;

  for (const block of clone.content) {
    if (!isImageContent(block)) continue;
    if (typeof block.data !== "string" || block.data.length === 0) continue;

    if (!cachedPath && mediaSourcePath) {
      cachedPath = await copyMediaToCache(mediaSourcePath, accountId, conversationId, seq);
    }

    block.data = "";
    block.stripped = true;
    if (cachedPath) {
      block.filePath = cachedPath;
    }
  }

  return clone as unknown as Record<string, unknown>;
}

async function hydrateMessage(payload: Record<string, unknown>): Promise<Message> {
  const clone = structuredClone(payload) as unknown as Message & { content: unknown };

  if (!Array.isArray(clone.content)) {
    return clone as Message;
  }

  const hydratedContent: Array<TextContent | ImageContent | Record<string, unknown>> = [];

  for (const block of clone.content) {
    if (!isImageContent(block) || !block.stripped || typeof block.filePath !== "string") {
      hydratedContent.push(block as unknown as Record<string, unknown>);
      continue;
    }

    try {
      const data = await readFile(block.filePath, { encoding: "base64" });
      hydratedContent.push({
        type: "image",
        data,
        mimeType: block.mimeType,
      });
    } catch (error) {
      hydratedContent.push({
        type: "text",
        text: `[image unavailable: ${basename(block.filePath)}]`,
      });
      log.error(`hydrateMessage(${block.filePath})`, error);
    }
  }

  clone.content = hydratedContent as Message["content"];
  return clone as Message;
}

async function persistRecord(record: StoredMessageRecord): Promise<void> {
  const prisma = getPrisma();

  try {
    await prisma.$transaction(async (tx) => {
      await tx.account.upsert({
        where: { id: record.account_id },
        update: {},
        create: { id: record.account_id },
      });

      await tx.message.create({
        data: {
          accountId: record.account_id,
          conversationId: record.conversation_id,
          seq: record.seq,
          role: record.role,
          contentText: record.content_text,
          payload: record.payload as Prisma.InputJsonValue,
          mediaType: record.media_type,
        },
      });

      await tx.conversation.upsert({
        where: {
          accountId_conversationId: {
            accountId: record.account_id,
            conversationId: record.conversation_id,
          },
        },
        update: {
          lastMessageAt: new Date(),
          messageCount: {
            increment: 1,
          },
        },
        create: {
          accountId: record.account_id,
          conversationId: record.conversation_id,
          title: record.content_text?.trim() || record.conversation_id,
          lastMessageAt: new Date(),
          messageCount: 1,
        },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      log.error(
        `persistRecord(${record.account_id}/${record.conversation_id}#${record.seq})`,
        `Duplicate seq=${record.seq} — likely stale in-memory history after restart`,
      );
      return;
    }
    throw error;
  }
}

async function flushQueue(): Promise<void> {
  if (flushing) return;
  flushing = true;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }

  while (queue.length > 0) {
    const current = queue[0];

    try {
      await persistRecord(current.record);
      queue.shift();
    } catch (error) {
      current.attempts += 1;
      const backoffMs = Math.min(30_000, 1_000 * 2 ** Math.min(current.attempts, 5));
      log.error(
        `persistMessage(${current.record.account_id}/${current.record.conversation_id}#${current.record.seq})`,
        error
      );
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void flushQueue();
      }, backoffMs);
      retryTimer.unref?.();
      break;
    }
  }

  flushing = false;
}

export function queuePersistMessage(params: {
  accountId: string;
  conversationId: string;
  message: Message;
  seq: number;
  mediaSourcePath?: string;
}): void {
  void (async () => {
    const record: StoredMessageRecord = {
      account_id: params.accountId,
      conversation_id: params.conversationId,
      seq: params.seq,
      role: params.message.role,
      content_text: extractText(params.message),
      payload: await serializeMessage(
        params.accountId,
        params.conversationId,
        params.message,
        params.seq,
        params.mediaSourcePath
      ),
      media_type: extractMediaType(params.message),
    };

    queue.push({ record, attempts: 0 });
    await flushQueue();
  })().catch((error) => {
    log.error(
      `queuePersistMessage(${params.accountId}/${params.conversationId}#${params.seq})`,
      error
    );
  });
}

export interface RestoredHistory {
  messages: Message[];
  maxSeq: number;
}

export async function restoreHistory(accountId: string, conversationId: string): Promise<RestoredHistory> {
  const data = await getPrisma().message.findMany({
    where: {
      accountId,
      conversationId,
    },
    select: {
      seq: true,
      payload: true,
    },
    orderBy: {
      seq: "asc",
    },
  });

  const messages = await Promise.all(
    data.map(async (row) => hydrateMessage(row.payload as Record<string, unknown>))
  );

  const maxSeq = data.length > 0 ? data[data.length - 1].seq : 0;

  return { messages, maxSeq };
}

export async function listMessages(
  accountId: string,
  conversationId: string,
  limit: number,
  before?: number
): Promise<PaginatedResponse<MessageRow>> {
  const rows = await getPrisma().message.findMany({
    where: {
      accountId,
      conversationId,
      ...(before !== undefined ? { id: { lt: BigInt(before) } } : {}),
    },
    orderBy: {
      id: "desc",
    },
    take: limit + 1,
  });

  const mappedRows: MessageRow[] = rows.map((row) => ({
    id: Number(row.id),
    account_id: row.accountId,
    conversation_id: row.conversationId,
    seq: row.seq,
    role: row.role as MessageRow["role"],
    content_text: row.contentText,
    payload: row.payload as Record<string, unknown>,
    media_type: row.mediaType,
    created_at: row.createdAt.toISOString(),
  }));

  const hasMore = mappedRows.length > limit;
  const page = mappedRows.slice(0, limit);
  const nextCursor = hasMore ? page.at(-1)?.id : undefined;

  return {
    data: [...page].reverse(),
    has_more: hasMore,
    next_cursor: nextCursor,
  };
}

export function getPendingMessageWriteCount(): number {
  return queue.length;
}

export async function drainMessageQueue(timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (queue.length > 0 && Date.now() < deadline) {
    await flushQueue();
    if (queue.length > 0) {
      await delay(100);
    }
  }
}
