import type { Message } from "@mariozechner/pi-ai";
import { restoreHistory } from "./db/messages.js";
import { getPrisma } from "./db/prisma.js";
import { log } from "./logger.js";

/**
 * Per-account conversation stores.
 * Key: `${accountId}::${conversationId}` — isolates histories across accounts.
 */
const store = new Map<string, Message[]>();
const seqCounters = new Map<string, number>();
const loading = new Map<string, Promise<Message[]>>();
const waitQueues = new Map<string, Array<() => void>>();

function key(accountId: string, conversationId: string) {
  return `${accountId}::${conversationId}`;
}

async function acquireConversationLock(lockKey: string): Promise<() => void> {
  const queue = waitQueues.get(lockKey);

  if (!queue) {
    waitQueues.set(lockKey, []);
    return () => {
      const nextQueue = waitQueues.get(lockKey);
      const next = nextQueue?.shift();
      if (next) {
        next();
        return;
      }
      waitQueues.delete(lockKey);
    };
  }

  return new Promise((resolve) => {
    queue.push(() => {
      resolve(() => {
        const nextQueue = waitQueues.get(lockKey);
        const next = nextQueue?.shift();
        if (next) {
          next();
          return;
        }
        waitQueues.delete(lockKey);
      });
    });
  });
}

export async function withConversationLock<T>(
  accountId: string,
  conversationId: string,
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = key(accountId, conversationId);
  const release = await acquireConversationLock(lockKey);

  try {
    return await fn();
  } finally {
    release();
  }
}

export async function ensureHistoryLoaded(
  accountId: string,
  conversationId: string
): Promise<Message[]> {
  const conversationKey = key(accountId, conversationId);

  if (store.has(conversationKey)) {
    return store.get(conversationKey)!;
  }

  if (!loading.has(conversationKey)) {
    loading.set(
      conversationKey,
      restoreHistory(accountId, conversationId)
        .then(({ messages, maxSeq }) => {
          store.set(conversationKey, messages);
          seqCounters.set(conversationKey, maxSeq);
          loading.delete(conversationKey);
          return messages;
        })
        .catch((error) => {
          loading.delete(conversationKey);
          throw error;
        })
    );
  }

  return loading.get(conversationKey)!;
}

export function getHistory(accountId: string, conversationId: string): Message[] {
  const k = key(accountId, conversationId);
  if (!store.has(k)) {
    throw new Error(
      `History not loaded for ${accountId}/${conversationId}. ` +
      `ensureHistoryLoaded() must be awaited before calling getHistory().`
    );
  }
  return store.get(k)!;
}

/** Returns the next seq number for this conversation, monotonically increasing. */
export function nextSeq(accountId: string, conversationId: string): number {
  const k = key(accountId, conversationId);
  const current = seqCounters.get(k) ?? 0;
  const next = current + 1;
  seqCounters.set(k, next);
  return next;
}

/**
 * Evict a conversation from memory only — DB is untouched.
 * Used when rotating to a new session so the old effectiveConvId
 * doesn't linger in the in-memory store.
 */
export function evictConversation(accountId: string, conversationId: string): void {
  const conversationKey = key(accountId, conversationId);
  store.delete(conversationKey);
  seqCounters.delete(conversationKey);
  loading.delete(conversationKey);
}

export function clearConversation(accountId: string, conversationId: string): void {
  const conversationKey = key(accountId, conversationId);
  store.delete(conversationKey);
  seqCounters.delete(conversationKey);
  loading.delete(conversationKey);

  // Also clear from DB so corrupted messages don't get reloaded
  getPrisma().message.deleteMany({
    where: { accountId, conversationId },
  }).then((result) => {
    log.clear(accountId, `${conversationId} (deleted ${result.count} DB rows)`);
  }).catch((err) => {
    log.error(`clearConversation DB(${accountId}/${conversationId})`, err);
  });
}

/** Remove the last N messages from both in-memory history and DB for this conversation. */
export async function rollbackMessages(
  accountId: string,
  conversationId: string,
  count: number,
): Promise<void> {
  const conversationKey = key(accountId, conversationId);
  const hist = store.get(conversationKey);
  if (!hist || count <= 0) return;

  // Roll back in-memory
  const removedCount = Math.min(count, hist.length);
  hist.length = hist.length - removedCount;

  // Roll back seq counter
  const currentSeq = seqCounters.get(conversationKey) ?? 0;
  seqCounters.set(conversationKey, Math.max(0, currentSeq - removedCount));

  // Delete from DB: remove the highest-seq rows for this conversation
  try {
    const rows = await getPrisma().message.findMany({
      where: { accountId, conversationId },
      orderBy: { seq: "desc" },
      take: removedCount,
      select: { id: true },
    });
    if (rows.length > 0) {
      await getPrisma().message.deleteMany({
        where: { id: { in: rows.map((r) => r.id) } },
      });
    }
  } catch (err) {
    log.error(`rollbackMessages(${accountId}/${conversationId}, ${count})`, err);
  }
}
