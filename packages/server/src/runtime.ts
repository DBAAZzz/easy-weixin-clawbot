import { monitorWeixinProvider, getDefaultCdnBaseUrl } from "@clawbot/weixin-agent-sdk";
import { createAgent } from "./agent.js";
import { credentialStore, syncStateStore } from "./credentials/index.js";
import { getActiveAccountIds as getNonDeprecatedAccountIds, upsertAccount } from "./db/accounts.js";
import { drainMessageQueue } from "./db/messages.js";
import { drainUsageQueue } from "./db/usage.js";
import { WeixinIngressRolloutStore } from "./db/weixin-ingress-rollout-store.js";
import { createWeixinIngressLifecycle } from "./weixin/ingress-controller.js";
import { createModuleLogger, log } from "./logger.js";
import { PrismaContextCompilerShadowRolloutStore } from "./db/context-compiler-shadow-rollout-store.js";
import { RunLedgerRolloutStore } from "./db/run-ledger-rollout-store.js";
import { createServerContextShadowObserver } from "./context-shadow-observer.js";
import {
  setProjectionWriteModeResolver,
  type ProjectionWriteMode,
} from "@clawbot/agent";
import type { ContextShadowObserver } from "@clawbot/agent";

/**
 * Phase 7 (§6.3): per-account projection write mode snapshot, refreshed at
 * each account start. The resolver is process-global because the write gate
 * lives inside the agent engine; accounts without a snapshot entry keep the
 * Phase 0–6 behaviour.
 */
const projectionWriteModes = new Map<string, ProjectionWriteMode>();
setProjectionWriteModeResolver((accountId) => projectionWriteModes.get(accountId) ?? "prompt_shaped");

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

async function drainContextShadow(observer: ContextShadowObserver): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timeout = setTimeout(() => resolve("timeout"), 5_000);
    timeout.unref?.();
  });
  const result = await Promise.race([observer.drain().then(() => "drained" as const), timedOut]);
  if (timeout) clearTimeout(timeout);
  if (result === "timeout") {
    runtimeLogger.warn({}, "Context compiler shadow drain timed out");
  }
}

export function createBotRuntime(): BotRuntime {
  const startedAt = Date.now();
  const running = new Map<string, RunningAccount>();

  function getRunningAccountIds(): string[] {
    return [...running.keys()];
  }

  function launchAccount(
    accountId: string,
    abortController: AbortController,
    isCurrentEntry: () => boolean,
  ): Promise<void> {
    return (async () => {
      runtimeLogger.info({ accountId }, "开始启动账号运行时");
      let contextShadowObserver: ContextShadowObserver | undefined;

      try {
        const credential = await credentialStore.getDecrypted(accountId);
        if (!credential) {
          runtimeLogger.warn({ accountId }, "账号缺少已绑定凭据，跳过启动");
          return;
        }

        await upsertAccount(accountId);

        // Load rollout once per account start; a restart applies operator changes.
        const ingressEnabled = await new WeixinIngressRolloutStore().isEnabled(accountId);
        const shadowEnabled = await new PrismaContextCompilerShadowRolloutStore().isEnabled(
          accountId,
        );
        const runLedgerRolloutStore = new RunLedgerRolloutStore();
        const runLedgerEnabled = await runLedgerRolloutStore.isEnabled(accountId);
        const contextReadPath = await runLedgerRolloutStore.readPath(accountId);
        // Phase 7 (§6.3): `clean`/`suspended` writes require the canonical
        // read path — otherwise the persisted user text would no longer match
        // what the legacy/dual model context assembles. Non-canonical accounts
        // keep prompt_shaped regardless of the rollout column.
        const configuredWriteMode = await runLedgerRolloutStore.legacyWriteMode(accountId);
        const legacyWriteMode: ProjectionWriteMode =
          contextReadPath === "canonical" ? configuredWriteMode : "prompt_shaped";
        if (configuredWriteMode !== "prompt_shaped" && legacyWriteMode === "prompt_shaped") {
          runtimeLogger.warn(
            { accountId, configuredWriteMode, readPath: contextReadPath },
            "legacy_write_mode requires read_path=canonical; downgraded to prompt_shaped",
          );
        }
        projectionWriteModes.set(accountId, legacyWriteMode);
        // Phase 7 (§7.3): memory injection needs ledger evidence; without run
        // events there is nothing to replay, so non-ledger accounts stay on Tape.
        let memoryReadPath = await runLedgerRolloutStore.memoryReadPath(accountId);
        if (memoryReadPath !== "tape" && !runLedgerEnabled) {
          runtimeLogger.warn(
            { accountId, memoryReadPath },
            "memory_read_path requires the run ledger; staying on tape",
          );
          memoryReadPath = "tape";
        }
        contextShadowObserver = shadowEnabled ? createServerContextShadowObserver() : undefined;
        const agent = createAgent(accountId, {
          contextShadowObserver,
          runLedgerEnabled,
          contextReadPath,
          memoryReadPath,
        });
        const syncBuf = await syncStateStore.load(accountId);

        await monitorWeixinProvider({
          baseUrl: credential.baseUrl,
          cdnBaseUrl: getDefaultCdnBaseUrl(),
          token: credential.token,
          accountId,
          agent,
          abortSignal: abortController.signal,
          syncBufInitial: syncBuf,
          onSyncBufUpdate: (buf) => syncStateStore.save(accountId, buf),
          ...(ingressEnabled
            ? {
                ingressLifecycle: createWeixinIngressLifecycle({
                  accountId,
                  rolloutEnabled: ingressEnabled,
                  agent,
                }),
              }
            : {}),
        });
      } catch (error) {
        if (!abortController.signal.aborted) {
          log.error(`start(${accountId})`, error);
        }
      } finally {
        if (contextShadowObserver) await drainContextShadow(contextShadowObserver);
        // Only retract our own registration. A newer launch may already own this
        // accountId (restart during teardown), and deleting its entry would leave
        // a live session unreachable — and a later ensureAccountStarted would then
        // start a second concurrent session for the same account.
        if (isCurrentEntry()) {
          running.delete(accountId);
        }

        if (!abortController.signal.aborted) {
          runtimeLogger.info({ accountId }, "账号连接已断开");
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
    const entry: RunningAccount = {
      abortController,
      startPromise: Promise.resolve(),
    };
    entry.startPromise = launchAccount(
      accountId,
      abortController,
      () => running.get(accountId) === entry,
    );
    running.set(accountId, entry);
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
    const startPromises = [...running.values()].map((entry) => entry.startPromise);
    for (const id of running.keys()) {
      stopAccount(id);
    }
    await Promise.allSettled(startPromises);

    await drainMessageQueue();
    await drainUsageQueue();
  }

  return {
    bootstrap,
    ensureAccountStarted,
    getRunningAccountIds,
    getUptimeMs: () => Date.now() - startedAt,
    shutdown,
  };
}
