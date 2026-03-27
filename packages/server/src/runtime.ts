import { existsSync, readFileSync } from "node:fs";
import { isLoggedIn, start } from "weixin-agent-sdk";
import { createAgent } from "./agent.js";
import { acquireAccountLock } from "./account-lock.js";
import { heartbeatAccounts, markAccountsOffline, upsertAccounts } from "./db/accounts.js";
import { drainMessageQueue } from "./db/messages.js";
import { log } from "./logger.js";
import { ACCOUNTS_FILE } from "./paths.js";

type RunningAccount = {
  abortController: AbortController;
  startPromise: Promise<void>;
};

export interface BotRuntime {
  bootstrap(): Promise<void>;
  ensureAccountStarted(accountId: string): void;
  syncAccountsFromDisk(): Promise<string[]>;
  getRunningAccountIds(): string[];
  getUptimeMs(): number;
  shutdown(): Promise<void>;
}

function loadAccountIds(): string[] {
  if (!existsSync(ACCOUNTS_FILE)) {
    return [];
  }

  const raw = readFileSync(ACCOUNTS_FILE, "utf-8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed) || parsed.some((accountId) => typeof accountId !== "string")) {
    throw new Error(`Invalid accounts file: ${ACCOUNTS_FILE}`);
  }

  return [...new Set(parsed)];
}

export function createBotRuntime(): BotRuntime {
  const startedAt = Date.now();
  const running = new Map<string, RunningAccount>();
  let heartbeatTimer: NodeJS.Timeout | null = null;

  function getRunningAccountIds(): string[] {
    return [...running.keys()];
  }

  function startHeartbeatLoop() {
    if (heartbeatTimer) return;

    heartbeatTimer = setInterval(() => {
      const accountIds = getRunningAccountIds();
      if (accountIds.length === 0) return;

      void heartbeatAccounts(accountIds).catch((error) => {
        log.error("heartbeatAccounts", error);
      });
    }, 60_000);

    heartbeatTimer.unref?.();
  }

  function stopHeartbeatLoop() {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  function launchAccount(accountId: string, abortController: AbortController): Promise<void> {
    return (async () => {
      const lock = acquireAccountLock(accountId);
      if (!lock.acquired) {
        const owner = lock.ownerPid ? ` (pid ${lock.ownerPid})` : "";
        console.log(
          `Skipping bot for account ${accountId}: already running in another process${owner}`
        );
        return;
      }

      console.log(`Starting bot for account: ${accountId}`);

      try {
        await upsertAccounts([accountId]);
        await start(createAgent(accountId), {
          accountId,
          abortSignal: abortController.signal,
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          log.error(`start(${accountId})`, error);
        }
      } finally {
        lock.release();
        running.delete(accountId);
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
    startHeartbeatLoop();
  }

  async function syncAccountsFromDisk(): Promise<string[]> {
    const accountIds = loadAccountIds();

    if (accountIds.length > 0) {
      await upsertAccounts(accountIds);
    }

    for (const accountId of accountIds) {
      ensureAccountStarted(accountId);
    }

    return accountIds;
  }

  async function bootstrap(): Promise<void> {
    if (!isLoggedIn()) {
      console.log("No stored account found — web login is available at /login.");
      return;
    }

    const accountIds = await syncAccountsFromDisk();

    if (accountIds.length === 0) {
      console.log(`No account found in ${ACCOUNTS_FILE}; waiting for a new login.`);
      return;
    }

    console.log(`Found ${accountIds.length} account(s): ${accountIds.join(", ")}`);
  }

  async function shutdown(): Promise<void> {
    stopHeartbeatLoop();

    const accountIds = getRunningAccountIds();
    await Promise.allSettled([
      markAccountsOffline(accountIds),
      drainMessageQueue(),
    ]);

    const startPromises = [...running.values()].map((entry) => entry.startPromise);
    for (const id of [...running.keys()]) {
      stopAccount(id);
    }
    await Promise.allSettled(startPromises);
  }

  return {
    bootstrap,
    ensureAccountStarted,
    syncAccountsFromDisk,
    getRunningAccountIds,
    getUptimeMs: () => Date.now() - startedAt,
    shutdown,
  };
}
