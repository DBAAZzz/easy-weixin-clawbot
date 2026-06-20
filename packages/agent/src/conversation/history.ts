/**
 * In-memory conversation history management with per-conversation locking.
 *
 * DB operations go through the MessageStore port interface.
 */

import type { AgentMessage } from "../llm/types.js";
import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE } from "@clawbot/shared";
import { getMessageStore } from "../ports/message-store.js";

/**
 * Per-account conversation stores.
 * Key: `${accountId}::${conversationId}` — isolates histories across accounts.
 */
const store = new Map<string, AgentMessage[]>();
const seqCounters = new Map<string, number>();
const loading = new Map<string, Promise<AgentMessage[]>>();
const waitQueues = new Map<string, Array<() => void>>();
/** LRU access-order list (front = most recently used). */
const lruOrder: string[] = [];
const MAX_CACHED_CONVERSATIONS = 500;

function key(accountId: string, conversationId: string) {
  return `${accountId}::${conversationId}`;
}

function touchLru(conversationKey: string): void {
  const idx = lruOrder.indexOf(conversationKey);
  if (idx !== -1) lruOrder.splice(idx, 1);
  lruOrder.unshift(conversationKey);
}

function evictLru(): void {
  while (lruOrder.length > MAX_CACHED_CONVERSATIONS) {
    const oldest = lruOrder.pop()!;
    store.delete(oldest);
    seqCounters.delete(oldest);
    loading.delete(oldest);
  }
}

async function acquireConversationLock(
  lockKey: string,
  timeoutMs = 30_000,
): Promise<() => void> {
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

  return new Promise<() => void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // Remove this waiter from the queue so stale entries don't accumulate
      const idx = queue.indexOf(onAcquire);
      if (idx !== -1) queue.splice(idx, 1);
      reject(new Error("Timed out waiting for conversation lock"));
    }, timeoutMs);

    function onAcquire() {
      clearTimeout(timer);
      resolve(() => {
        const nextQueue = waitQueues.get(lockKey);
        const next = nextQueue?.shift();
        if (next) {
          next();
          return;
        }
        waitQueues.delete(lockKey);
      });
    }

    queue.push(onAcquire);
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
): Promise<AgentMessage[]> {
  const conversationKey = key(accountId, conversationId);

  if (store.has(conversationKey)) {
    touchLru(conversationKey);
    return store.get(conversationKey)!;
  }

  if (!loading.has(conversationKey)) {
    const messageStore = getMessageStore();
    loading.set(
      conversationKey,
      messageStore.restoreHistory(accountId, conversationId)
        .then(({ messages, maxSeq }) => {
          store.set(conversationKey, messages);
          seqCounters.set(conversationKey, maxSeq);
          loading.delete(conversationKey);
          touchLru(conversationKey);
          evictLru();
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

export function getHistory(accountId: string, conversationId: string): AgentMessage[] {
  const k = key(accountId, conversationId);
  if (!store.has(k)) {
    throw new Error(
      `History not loaded for ${accountId}/${conversationId}. ` +
      `ensureHistoryLoaded() must be awaited before calling getHistory().`
    );
  }
  touchLru(k);
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

/** Returns the current (latest persisted) seq number for this conversation. */
export function currentSeq(accountId: string, conversationId: string): number {
  return seqCounters.get(key(accountId, conversationId)) ?? 0;
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
  const lruIdx = lruOrder.indexOf(conversationKey);
  if (lruIdx !== -1) lruOrder.splice(lruIdx, 1);
}

export function clearConversation(accountId: string, conversationId: string): void {
  const conversationKey = key(accountId, conversationId);
  store.delete(conversationKey);
  seqCounters.delete(conversationKey);
  loading.delete(conversationKey);
  const lruIdx = lruOrder.indexOf(conversationKey);
  if (lruIdx !== -1) lruOrder.splice(lruIdx, 1);

  // Also clear from DB so corrupted messages don't get reloaded
  const messageStore = getMessageStore();
  messageStore.clearMessages(accountId, conversationId).catch((err) => {
    console.error(`[conversation] clearMessages DB error (${accountId}/${conversationId}):`, err);
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

  // Roll back in DB
  const messageStore = getMessageStore();
  await messageStore.rollbackMessages(accountId, conversationId, removedCount);
}

export async function appendAssistantTextMessage(
  accountId: string,
  conversationId: string,
  text: string,
): Promise<void> {
  await withConversationLock(accountId, conversationId, async () => {
    await ensureHistoryLoaded(accountId, conversationId);

    const message: AgentMessage = {
      role: MESSAGE_ROLE.ASSISTANT,
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text }],
      timestamp: Date.now(),
    };

    getHistory(accountId, conversationId).push(message);
    getMessageStore().queuePersistMessage({
      accountId,
      conversationId,
      message,
      seq: nextSeq(accountId, conversationId),
    });
  });
}
