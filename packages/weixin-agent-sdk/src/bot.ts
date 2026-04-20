import {
  CDN_BASE_URL,
  DEFAULT_BASE_URL,
  normalizeAccountId,
} from "./auth/accounts.js";
import {
  DEFAULT_ILINK_BOT_TYPE,
  startWeixinLoginWithQr,
  waitForWeixinLogin,
} from "./auth/login-qr.js";

export { monitorWeixinProvider } from "./monitor/monitor.js";
export type { MonitorWeixinOpts } from "./monitor/monitor.js";

export type LoginOptions = {
  /** Override the API base URL. */
  baseUrl?: string;
  /** Log callback (defaults to console.log). */
  log?: (msg: string) => void;
};

/** Result returned by loginWithEvents on successful login. */
export type LoginResult = {
  accountId: string;
  botToken: string;
  baseUrl: string;
  userId?: string;
};

/** Structured event callbacks for the login flow. */
export type LoginEvents = {
  onQrReady?: (data: { qrcodeUrl: string }) => void;
  onScanned?: () => void;
  onExpired?: () => void;
  onError?: (error: Error) => void;
};

/**
 * Structured login API — performs QR-code login without any file IO.
 * Returns the raw credentials on success; the caller (Server) is responsible for persistence.
 *
 * This is the supported login entrypoint for runtime callers.
 */
export async function loginWithEvents(
  opts: LoginOptions & LoginEvents,
): Promise<LoginResult> {
  const apiBaseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;

  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (!startResult.qrcodeUrl) {
    const err = new Error(startResult.message);
    opts.onError?.(err);
    throw err;
  }

  opts.onQrReady?.({ qrcodeUrl: startResult.qrcodeUrl });

  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl,
    timeoutMs: 480_000,
    botType: DEFAULT_ILINK_BOT_TYPE,
    onQrReady: opts.onQrReady,
    onScanned: opts.onScanned,
    onExpired: opts.onExpired,
  });

  if (!waitResult.connected || !waitResult.botToken || !waitResult.accountId) {
    const err = new Error(waitResult.message);
    opts.onError?.(err);
    throw err;
  }

  return {
    accountId: normalizeAccountId(waitResult.accountId),
    botToken: waitResult.botToken,
    baseUrl: waitResult.baseUrl ?? apiBaseUrl,
    userId: waitResult.userId,
  };
}

/**
 * Get the default CDN base URL.
 */
export function getDefaultCdnBaseUrl(): string {
  return CDN_BASE_URL;
}

/**
 * Get the default API base URL.
 */
export function getDefaultBaseUrl(): string {
  return DEFAULT_BASE_URL;
}
