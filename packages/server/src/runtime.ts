import { monitorWeixinProvider, getDefaultCdnBaseUrl } from "@clawbot/weixin-agent-sdk";
import { createAgent } from "./agent.js";
import { credentialStore, syncStateStore } from "./credentials/index.js";
import { getActiveAccountIds as getNonDeprecatedAccountIds, upsertAccount } from "./db/accounts.js";
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
        // Read credentials from DB (decrypted)
        const credential = await credentialStore.getDecrypted(accountId);
        if (!credential || credential.status !== "active") {
          console.warn(`Account ${accountId} has no valid credential (status=${credential?.status ?? "missing"}), skipping`);
          return;
        }

        await upsertAccount(accountId);

        // Load sync buf from DB
        const syncBuf = await syncStateStore.load(accountId);

        await monitorWeixinProvider({
          baseUrl: credential.baseUrl,
          cdnBaseUrl: getDefaultCdnBaseUrl(),
          token: credential.token,
          accountId,
          agent: createAgent(accountId),
          abortSignal: abortController.signal,
          syncBufInitial: syncBuf,
          onSyncBufUpdate: (buf) => {
            void syncStateStore.save(accountId, buf).catch((err) => {
              log.error(`syncStateStore.save(${accountId})`, err);
            });
          },
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          log.error(`start(${accountId})`, error);
        }
      } finally {
        running.delete(accountId);

        // Non-abort disconnect → credential may need re-login
        if (!abortController.signal.aborted) {
          console.log(`Account ${accountId} disconnected, marking credential as relogin_required`);
          await credentialStore.updateStatus(accountId, "relogin_required", "connection lost").catch((err) => {
            log.error(`credentialStore.updateStatus(${accountId})`, err);
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
    const accountIds = await getNonDeprecatedAccountIds();
    const activeAccountIds: string[] = [];

    for (const accountId of accountIds) {
      if (await credentialStore.isActive(accountId)) {
        activeAccountIds.push(accountId);
      }
    }

    if (activeAccountIds.length === 0) {
      console.log("No active credentials found — web login is available at /login.");
      return;
    }

    console.log(`Found ${activeAccountIds.length} active credential(s): ${activeAccountIds.join(", ")}`);

    for (const accountId of activeAccountIds) {
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
