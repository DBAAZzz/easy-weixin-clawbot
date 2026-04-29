import { monitorWeixinProvider, getDefaultCdnBaseUrl } from "@clawbot/weixin-agent-sdk";
import { createAgent } from "./agent.js";
import { credentialStore, syncStateStore } from "./credentials/index.js";
import { getActiveAccountIds as getNonDeprecatedAccountIds, upsertAccount } from "./db/accounts.js";
import { drainMessageQueue } from "./db/messages.js";
import { createModuleLogger, log } from "./logger.js";

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

const runtimeLogger = createModuleLogger("runtime");

export function createBotRuntime(): BotRuntime {
  const startedAt = Date.now();
  const running = new Map<string, RunningAccount>();

  function getRunningAccountIds(): string[] {
    return [...running.keys()];
  }

  function launchAccount(accountId: string, abortController: AbortController): Promise<void> {
    return (async () => {
      runtimeLogger.info({ accountId }, "开始启动账号运行时");

      try {
        const credential = await credentialStore.getDecrypted(accountId);
        if (!credential) {
          runtimeLogger.warn(
            { accountId },
            "账号缺少已绑定凭据，跳过启动",
          );
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

        if (!abortController.signal.aborted) {
          runtimeLogger.info(
            { accountId },
            "账号连接已断开",
          );
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

    if (accountIds.length === 0) {
      runtimeLogger.info("当前没有已绑定账号，请在网页上绑定登录");
      return;
    }

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
