import { loginWithEvents } from "@clawbot/weixin-agent-sdk";
import type { LoginState } from "@clawbot/shared";
import { credentialStore, allowFromStore } from "../credentials/index.js";
import { upsertAccount } from "../db/accounts.js";
import { log } from "../logger.js";

export interface LoginManager {
  start(): Promise<LoginState>;
  getState(): LoginState;
  cancel(): LoginState;
}

export function createLoginManager(options: {
  onSuccess: (accountId: string) => Promise<void>;
}): LoginManager {
  let state: LoginState = { status: "idle" };
  let activePromise: Promise<void> | null = null;
  let cancelled = false;

  function getState(): LoginState {
    return state;
  }

  async function start(): Promise<LoginState> {
    if (activePromise) {
      return state;
    }

    cancelled = false;
    state = { status: "scanning", message: "正在获取二维码…" };

    activePromise = (async () => {
      try {
        const result = await loginWithEvents({
          onQrReady: ({ qrcodeUrl }) => {
            if (cancelled) return;
            state = { status: "qr_ready", qr_text: qrcodeUrl };
          },
          onScanned: () => {
            if (cancelled) return;
            // Keep showing the QR text so the frontend knows it's still active
            if ("qr_text" in state) {
              state = { status: "scanning", qr_text: state.qr_text, message: "已扫码，等待确认…" };
            }
          },
          onExpired: () => {
            if (cancelled) return;
            state = { status: "scanning", message: "二维码已过期，正在刷新…" };
          },
          onError: () => {
            // Error will be caught in the try/catch below
          },
        });

        if (cancelled) return;

        await upsertAccount(result.accountId);

        // Persist credentials to database (encrypted)
        await credentialStore.save({
          accountId: result.accountId,
          token: result.botToken,
          baseUrl: result.baseUrl,
          userId: result.userId,
        });

        // Save the scanning user to the allow-from list
        if (result.userId) {
          await allowFromStore.addUser(result.accountId, result.userId);
        }

        state = { status: "done", account_id: result.accountId };
        await options.onSuccess(result.accountId);
      } catch (error) {
        if (cancelled) {
          state = { status: "expired" };
          return;
        }

        state = {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
        log.error("loginWithEvents()", error);
      } finally {
        activePromise = null;
      }
    })();

    return state;
  }

  function cancel(): LoginState {
    cancelled = true;
    activePromise = null;
    state = { status: "expired" };
    return state;
  }

  return {
    start,
    getState,
    cancel,
  };
}
