import { start } from "weixin-agent-sdk";
import { createAgent } from "./agent.js";
import { deprecateAccount, getActiveAccountIds, upsertAccount } from "./db/accounts.js";
import { drainMessageQueue } from "./db/messages.js";
import { log } from "./logger.js";

type RunningAccount = {
  abortController: AbortController;
  startPromise: Promise<void>;
};

export interface BotRuntime {
  bootstrap(): Promise<void>;
  ensureAccountStarted(accountId: string): void;
  getRunningAccountIds(): string[];
  getUptimeMs(): number;
  shutdown(): Promise<void>;
}

export function createBotRuntime(): BotRuntime {
  const startedAt = Date.now();
  const running = new Map<string, RunningAccount>();

  function getRunningAccountIds(): string[] {
    return [...running.keys()];
  }

  function launchAccount(accountId: string, abortController: AbortController): Promise<void> {
    return (async () => {
      console.log(`Starting bot for account: ${accountId}`);

      try {
        await upsertAccount(accountId);
        await start(createAgent(accountId), {
          accountId,
          abortSignal: abortController.signal,
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          log.error(`start(${accountId})`, error);
        }
      } finally {
        running.delete(accountId);

        // 非主动中止 → 连接被新扫码顶替，标记为废弃
        if (!abortController.signal.aborted) {
          console.log(`Account ${accountId} disconnected, marking as deprecated`);
          await deprecateAccount(accountId).catch((err) => {
            log.error(`deprecateAccount(${accountId})`, err);
          });
        }
      }
    })();
  }

  function stopAccount(accountId: string) {
    const entry = running.get(accountId);
    if (!entry) return;
    entry.abortController.abort();
    running.delete(accountId);
  }

  function ensureAccountStarted(accountId: string) {
    if (running.has(accountId)) return;

    const abortController = new AbortController();
    const startPromise = launchAccount(accountId, abortController);
    running.set(accountId, { abortController, startPromise });
  }

  async function bootstrap(): Promise<void> {
    const accountIds = await getActiveAccountIds();

    if (accountIds.length === 0) {
      console.log("No active accounts found — web login is available at /login.");
      return;
    }

    console.log(`Found ${accountIds.length} active account(s): ${accountIds.join(", ")}`);

    for (const accountId of accountIds) {
      ensureAccountStarted(accountId);
    }
  }

  async function shutdown(): Promise<void> {
    await drainMessageQueue();

    const startPromises = [...running.values()].map((entry) => entry.startPromise);
    for (const id of [...running.keys()]) {
      stopAccount(id);
    }
    await Promise.allSettled(startPromises);
  }

  return {
    bootstrap,
    ensureAccountStarted,
    getRunningAccountIds,
    getUptimeMs: () => Date.now() - startedAt,
    shutdown,
  };
}
