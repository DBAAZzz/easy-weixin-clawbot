import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type StoredSession = {
  accountId: string;
  token: string;
  baseUrl: string;
  userId?: string;
  syncBuf?: string;
  savedAt: string;
};

function resolveStateDir(): string {
  return (
    process.env.OPENCLAW_STATE_DIR?.trim() ||
    process.env.CLAWDBOT_STATE_DIR?.trim() ||
    path.join(os.homedir(), ".openclaw")
  );
}

function resolveSessionPath(): string {
  return path.join(resolveStateDir(), "weixin-acp", "session.json");
}

export function loadSession(): StoredSession | null {
  const filePath = resolveSessionPath();
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (
      typeof parsed.accountId !== "string" ||
      typeof parsed.token !== "string" ||
      typeof parsed.baseUrl !== "string"
    ) {
      return null;
    }
    return {
      accountId: parsed.accountId,
      token: parsed.token,
      baseUrl: parsed.baseUrl,
      ...(typeof parsed.userId === "string" && parsed.userId.trim() ? { userId: parsed.userId } : {}),
      ...(typeof parsed.syncBuf === "string" ? { syncBuf: parsed.syncBuf } : {}),
      savedAt:
        typeof parsed.savedAt === "string" && parsed.savedAt.trim()
          ? parsed.savedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveSession(session: Omit<StoredSession, "savedAt">): StoredSession {
  const stored: StoredSession = {
    ...session,
    savedAt: new Date().toISOString(),
  };
  const filePath = resolveSessionPath();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(stored, null, 2), "utf-8");
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
  return stored;
}

export function clearSession(): void {
  try {
    fs.unlinkSync(resolveSessionPath());
  } catch {
    // ignore if not found
  }
}

export function saveSessionSyncBuf(syncBuf: string): void {
  const current = loadSession();
  if (!current) return;
  saveSession({
    accountId: current.accountId,
    token: current.token,
    baseUrl: current.baseUrl,
    ...(current.userId ? { userId: current.userId } : {}),
    syncBuf,
  });
}
