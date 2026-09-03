/**
 * In-memory conversation history cache with per-conversation locking.
 *
 * DB operations go through the MessageStore port interface. Instantiate one
 * ConversationCache per process (see ChatEngine) — no module-level state here.
 */

import type { AgentMessage } from "../../llm/types.js";
import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE } from "@clawbot/shared";
import { getMessageStore } from "../../ports/message-store.js";
import { projectionWriteModeFor } from "../../ports/projection-write.js";
import { projectionWriteSkippedTotal, projectionWriteTotal } from "@clawbot/observability";

export interface ConversationCacheOptions {
  /** Max number of conversations kept in memory before LRU eviction. Default 500. */
  maxCachedConversations?: number;
  /** Max time to wait for a conversation lock before rejecting. Default 30_000ms. */
  lockTimeoutMs?: number;
}

export interface ConversationCache {
  ensureLoaded(accountId: string, conversationId: string): Promise<AgentMessage[]>;
  get(accountId: string, conversationId: string): AgentMessage[];
  /** Returns the next seq number for this conversation, monotonically increasing. */
  nextSeq(accountId: string, conversationId: string): number;
  /** Returns the current (latest persisted) seq number for this conversation. */
  currentSeq(accountId: string, conversationId: string): number;
  /** Evict a conversation from memory only — DB is untouched. */
  evict(accountId: string, conversationId: string): void;
  /** Evict from memory and clear DB — used when a conversation is corrupted/reset. */
  clear(accountId: string, conversationId: string): Promise<void>;
  /** Remove the last N messages from both in-memory history and DB. */
  rollback(accountId: string, conversationId: string, count: number): Promise<void>;
  appendAssistantText(accountId: string, conversationId: string, text: string): Promise<void>;
  withLock<T>(accountId: string, conversationId: string, fn: () => Promise<T>): Promise<T>;
  /**
   * Whether *someone* currently holds this conversation's lock.
   *
   * Deliberately not "whether the caller holds it" — tracking ownership would
   * need AsyncLocalStorage, which this package has decided against. That makes
   * this a guard against forgetting `withLock` entirely (the realistic mistake),
   * not a proof of mutual exclusion.
   */
  isLocked(accountId: string, conversationId: string): boolean;
}

const DEFAULT_MAX_CACHED_CONVERSATIONS = 500;
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

export function createConversationCache(opts: ConversationCacheOptions = {}): ConversationCache {
  const maxCachedConversations = opts.maxCachedConversations ?? DEFAULT_MAX_CACHED_CONVERSATIONS;
  const lockTimeoutMs = opts.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;

  /** Key: `${accountId}::${conversationId}` — isolates histories across accounts. */
  const store = new Map<string, AgentMessage[]>();
  const seqCounters = new Map<string, number>();
  const loading = new Map<string, Promise<AgentMessage[]>>();
  const waitQueues = new Map<string, Array<() => void>>();
  /** LRU access-order list (front = most recently used). */
  const lruOrder: string[] = [];

  function key(accountId: string, conversationId: string): string {
    return `${accountId}::${conversationId}`;
  }

  function touchLru(conversationKey: string): void {
    const idx = lruOrder.indexOf(conversationKey);
    if (idx !== -1) lruOrder.splice(idx, 1);
    lruOrder.unshift(conversationKey);
  }

  function evictLru(): void {
    while (lruOrder.length > maxCachedConversations) {
      const oldest = lruOrder.pop()!;
      store.delete(oldest);
      seqCounters.delete(oldest);
      loading.delete(oldest);
    }
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

    return new Promise<() => void>((resolve, reject) => {
      const timer = setTimeout(() => {
        // Remove this waiter from the queue so stale entries don't accumulate
        const idx = queue.indexOf(onAcquire);
        if (idx !== -1) queue.splice(idx, 1);
        reject(new Error("Timed out waiting for conversation lock"));
      }, lockTimeoutMs);

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

  async function withLock<T>(
    accountId: string,
    conversationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const lockKey = key(accountId, conversationId);
    const release = await acquireConversationLock(lockKey);

    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * `waitQueues` doubles as the held-lock set: `acquireConversationLock` seeds an
   * empty queue on acquisition and deletes the key on the last release, so key
   * presence is exactly "held".
   */
  function isLocked(accountId: string, conversationId: string): boolean {
    return waitQueues.has(key(accountId, conversationId));
  }

  async function ensureLoaded(accountId: string, conversationId: string): Promise<AgentMessage[]> {
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

  function get(accountId: string, conversationId: string): AgentMessage[] {
    const k = key(accountId, conversationId);
    if (!store.has(k)) {
      throw new Error(
        `History not loaded for ${accountId}/${conversationId}. ` +
        `ensureLoaded() must be awaited before calling get().`
      );
    }
    touchLru(k);
    return store.get(k)!;
  }

  function nextSeq(accountId: string, conversationId: string): number {
    const k = key(accountId, conversationId);
    const current = seqCounters.get(k) ?? 0;
    const next = current + 1;
    seqCounters.set(k, next);
    return next;
  }

  function currentSeq(accountId: string, conversationId: string): number {
    return seqCounters.get(key(accountId, conversationId)) ?? 0;
  }

  function evict(accountId: string, conversationId: string): void {
    const conversationKey = key(accountId, conversationId);
    store.delete(conversationKey);
    seqCounters.delete(conversationKey);
    loading.delete(conversationKey);
    const lruIdx = lruOrder.indexOf(conversationKey);
    if (lruIdx !== -1) lruOrder.splice(lruIdx, 1);
  }

  async function clear(accountId: string, conversationId: string): Promise<void> {
    evict(accountId, conversationId);
    await getMessageStore().clearMessages(accountId, conversationId);
  }

  async function rollback(accountId: string, conversationId: string, count: number): Promise<void> {
    const conversationKey = key(accountId, conversationId);
    const hist = store.get(conversationKey);
    if (!hist || count <= 0) return;

    // Roll back in-memory
    const removedCount = Math.min(count, hist.length);
    hist.length = hist.length - removedCount;

    // Roll back seq counter
    const current = seqCounters.get(conversationKey) ?? 0;
    seqCounters.set(conversationKey, Math.max(0, current - removedCount));

    // Roll back in DB
    const messageStore = getMessageStore();
    await messageStore.rollbackMessages(accountId, conversationId, removedCount);
  }

  async function appendAssistantText(accountId: string, conversationId: string, text: string): Promise<void> {
    await withLock(accountId, conversationId, async () => {
      await ensureLoaded(accountId, conversationId);

      const message: AgentMessage = {
        role: MESSAGE_ROLE.ASSISTANT,
        content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text }],
        timestamp: Date.now(),
      };

      get(accountId, conversationId).push(message);
      // Phase 7 (§6.2): suspended keeps the live history but stops the
      // messages projection write.
      const writeMode = projectionWriteModeFor(accountId);
      if (writeMode === "suspended") {
        projectionWriteSkippedTotal.inc({ reason: "suspended" });
      } else {
        projectionWriteTotal.inc({ mode: writeMode });
        getMessageStore().queuePersistMessage({
          accountId,
          conversationId,
          message,
          seq: nextSeq(accountId, conversationId),
        });
      }
    });
  }

  return {
    ensureLoaded,
    get,
    nextSeq,
    currentSeq,
    evict,
    clear,
    rollback,
    appendAssistantText,
    withLock,
    isLocked,
  };
}
