import { login } from "@clawbot/weixin-agent-sdk";
import type { LoginState } from "@clawbot/shared";
import { log } from "../logger.js";
import { captureStdout, isTerminalQrText } from "./qr-capture.js";

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
    state = { status: "idle" };

    let qrText = "";
    let stdoutReleased = false;
    const releaseStdout = captureStdout((qrBlock) => {
      if (cancelled || stdoutReleased) return;
      if (!isTerminalQrText(qrBlock)) return;

      qrText = qrBlock;
      state = { status: "qr_ready", qr_text: qrBlock };
      stopCapture();
    });

    function stopCapture() {
      if (!stdoutReleased) {
        stdoutReleased = true;
        releaseStdout();
      }
    }

    // 立即切到 scanning 以便前端开始轮询
    state = { status: "scanning", message: "正在获取二维码…" };

    activePromise = (async () => {
      try {
        const accountId = await login({
          log: (message) => {
            if (cancelled) return;

            const qr = qrText.length > 0
              ? qrText
              : ("qr_text" in state ? state.qr_text : undefined);

            if (qr) {
              state = { status: "qr_ready", qr_text: qr };
            } else {
              state = { status: "scanning", message };
            }
          },
        });

        if (cancelled) return;
        state = { status: "done", account_id: accountId };
        await options.onSuccess(accountId);
      } catch (error) {
        if (cancelled) {
          state = { status: "expired" };
          return;
        }

        state = {
          status: "error",
          message: error instanceof Error ? error.message : String(error),
        };
        log.error("login()", error);
      } finally {
        stopCapture();
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
