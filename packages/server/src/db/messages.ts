import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Prisma } from "@prisma/client";
import type { AgentMessage, ImageContent, TextContent } from "@clawbot/agent/llm";
import { legacyPayloadToAgentMessage } from "@clawbot/agent/llm";
import type { MessageRow, PaginatedResponse } from "@clawbot/shared";
import { log } from "../logger.js";
import { getAssetService } from "../assets/index.js";
import { getPrisma } from "./prisma.js";

type StoredMessageRecord = Omit<MessageRow, "id" | "created_at">;
type QueueItem = {
  record: StoredMessageRecord;
  attempts: number;
};

type StoredImageContent = ImageContent & {
  assetId?: string;
  filePath?: string;
  stripped?: boolean;
};

type MessagePayload = Record<string, unknown> & {
  content?: unknown;
};

type DisplayAssetRef = {
  id: string;
  provider: string;
  objectKey: string | null;
  localPath: string | null;
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

function extractText(message: AgentMessage): string | null {
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

function extractMediaType(message: AgentMessage): string | null {
  if (typeof message.content !== "object" || !Array.isArray(message.content)) return null;
  return message.content.some((block) => isImageContent(block)) ? "image" : null;
}

function toPayloadRecord(value: unknown): MessagePayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as MessagePayload;
}

function collectPayloadAssetIds(payload: MessagePayload): string[] {
  if (!Array.isArray(payload.content)) {
    return [];
  }

  return payload.content
    .map((block) =>
      block &&
      typeof block === "object" &&
      typeof (block as { assetId?: unknown }).assetId === "string"
        ? (block as { assetId: string }).assetId
        : null
    )
    .filter((assetId): assetId is string => Boolean(assetId));
}

function addDisplayPathsToPayload(
  payload: MessagePayload,
  assetsById: Map<string, DisplayAssetRef>,
): MessagePayload {
  if (!Array.isArray(payload.content)) {
    return payload;
  }

  const clone = structuredClone(payload) as MessagePayload;
  if (!Array.isArray(clone.content)) {
    return clone;
  }

  clone.content = clone.content.map((block) => {
    if (!block || typeof block !== "object") {
      return block;
    }

    const imageBlock = block as Record<string, unknown>;
    if (imageBlock.type !== "image" || typeof imageBlock.assetId !== "string") {
      return block;
    }

    const asset = assetsById.get(imageBlock.assetId);
    if (!asset) {
      return block;
    }

    if (asset.provider === "s3-compatible" && asset.objectKey) {
      return {
        ...imageBlock,
        filePath: asset.objectKey,
        storageProvider: asset.provider,
      };
    }

    if (asset.provider === "local" && asset.localPath) {
      return {
        ...imageBlock,
        filePath: asset.localPath,
        storageProvider: asset.provider,
      };
    }

    return block;
  });

  return clone;
}

async function serializeMessage(
  accountId: string,
  conversationId: string,
  message: AgentMessage,
  seq: number
): Promise<Record<string, unknown>> {
  const clone = structuredClone(message) as AgentMessage & { content: unknown };

  if (!Array.isArray(clone.content)) {
    return clone as unknown as Record<string, unknown>;
  }

  for (const block of clone.content) {
    if (!isImageContent(block)) continue;
    if (typeof block.data !== "string" || block.data.length === 0) continue;
    block.data = "";
    block.stripped = true;
  }

  return clone as unknown as Record<string, unknown>;
}

async function hydrateMessage(payload: Record<string, unknown>): Promise<AgentMessage> {
  const clone = structuredClone(payload) as unknown as AgentMessage & { content: unknown };

  if (!Array.isArray(clone.content)) {
    return legacyPayloadToAgentMessage(clone as unknown as Record<string, unknown>);
  }

  const hydratedContent: Array<TextContent | ImageContent | Record<string, unknown>> = [];

  for (const block of clone.content) {
    if (!isImageContent(block) || !block.stripped) {
      hydratedContent.push(block as unknown as Record<string, unknown>);
      continue;
    }

    if (typeof block.assetId === "string") {
      try {
        const asset = await getAssetService().read(block.assetId);
        hydratedContent.push({
          type: "image",
          data: Buffer.from(asset.bytes).toString("base64"),
          mimeType: asset.mimeType,
          assetId: block.assetId,
          ...(block.promptReplacementText ? { promptReplacementText: block.promptReplacementText } : {}),
        });
      } catch (error) {
        hydratedContent.push({
          type: "text",
          text: `[image unavailable: ${block.assetId}]`,
        });
        log.error(`hydrateMessage(${block.assetId})`, error);
      }
      continue;
    }

    if (typeof block.filePath !== "string") {
      hydratedContent.push({
        type: "text",
        text: "[image unavailable: missing asset reference]",
      });
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

  clone.content = hydratedContent as AgentMessage["content"];
  return legacyPayloadToAgentMessage(clone as unknown as Record<string, unknown>);
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
  message: AgentMessage;
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
        params.seq
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
  messages: AgentMessage[];
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
    select: {
      id: true,
      accountId: true,
      conversationId: true,
      seq: true,
      role: true,
      contentText: true,
      payload: true,
      mediaType: true,
      createdAt: true,
    },
    orderBy: {
      id: "desc",
    },
    take: limit + 1,
  });

  const payloads = rows.map((row) => toPayloadRecord(row.payload));
  const assetIds = [...new Set(payloads.flatMap((payload) => collectPayloadAssetIds(payload)))];
  const assetRows =
    assetIds.length > 0
      ? await getPrisma().asset.findMany({
          where: {
            id: {
              in: assetIds,
            },
          },
          select: {
            id: true,
            provider: true,
            objectKey: true,
            localPath: true,
          },
        })
      : [];
  const assetsById = new Map(assetRows.map((asset) => [asset.id, asset]));

  const mappedRows: MessageRow[] = rows.map((row, index) => ({
    id: Number(row.id),
    account_id: row.accountId,
    conversation_id: row.conversationId,
    seq: row.seq,
    role: row.role as MessageRow["role"],
    content_text: row.contentText,
    payload: addDisplayPathsToPayload(payloads[index] ?? {}, assetsById),
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
