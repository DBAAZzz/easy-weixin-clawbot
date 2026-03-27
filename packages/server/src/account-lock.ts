import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

const LOCK_DIR = join(homedir(), ".openclaw", "openclaw-weixin", "locks");

type LockFilePayload = {
  accountId: string;
  nonce: string;
  pid: number;
  startedAt: string;
};

export type AccountLockResult =
  | {
      acquired: true;
      lockFilePath: string;
      release: () => void;
    }
  | {
      acquired: false;
      lockFilePath: string;
      ownerPid?: number;
    };

export function acquireAccountLock(accountId: string): AccountLockResult {
  mkdirSync(LOCK_DIR, { recursive: true });

  const lockFilePath = join(LOCK_DIR, `${encodeURIComponent(accountId)}.lock`);
  const created = tryCreateLock(lockFilePath, accountId);
  if (created) return created;

  let owner = readLockFile(lockFilePath);
  if (!owner || !isProcessAlive(owner.pid)) {
    rmSync(lockFilePath, { force: true });

    const recovered = tryCreateLock(lockFilePath, accountId);
    if (recovered) return recovered;

    owner = readLockFile(lockFilePath);
  }

  return {
    acquired: false,
    lockFilePath,
    ownerPid: owner?.pid,
  };
}

function tryCreateLock(lockFilePath: string, accountId: string): Extract<AccountLockResult, { acquired: true }> | null {
  const payload: LockFilePayload = {
    accountId,
    nonce: randomUUID(),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  try {
    const fd = openSync(lockFilePath, "wx");
    try {
      writeFileSync(fd, JSON.stringify(payload), "utf-8");
    } finally {
      closeSync(fd);
    }

    return {
      acquired: true,
      lockFilePath,
      release: createRelease(lockFilePath, payload.nonce),
    };
  } catch (err) {
    if (isAlreadyExistsError(err)) return null;
    throw err;
  }
}

function createRelease(lockFilePath: string, nonce: string): () => void {
  let released = false;

  return () => {
    if (released) return;
    released = true;

    const current = readLockFile(lockFilePath);
    if (current?.nonce === nonce) {
      rmSync(lockFilePath, { force: true });
    }
  };
}

function readLockFile(lockFilePath: string): LockFilePayload | null {
  try {
    const raw = readFileSync(lockFilePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LockFilePayload>;

    if (
      typeof parsed.accountId === "string" &&
      typeof parsed.nonce === "string" &&
      typeof parsed.pid === "number" &&
      typeof parsed.startedAt === "string"
    ) {
      return parsed as LockFilePayload;
    }
  } catch {}

  return null;
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM") return true;
    if (code === "ESRCH") return false;
    return false;
  }
}

function isAlreadyExistsError(err: unknown): err is NodeJS.ErrnoException {
  return typeof err === "object" && err !== null && "code" in err && err.code === "EEXIST";
}
