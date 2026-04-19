import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Resolve the master credential encryption key from environment.
 * Returns a 32-byte Buffer derived from the env var.
 *
 * Accepted formats:
 *   - 64 hex chars  → decoded to 32 bytes
 *   - base64 string → decoded to 32 bytes
 *
 * Falls back to a deterministic dev-only key when NODE_ENV !== "production".
 */
export function getMasterKey(): Buffer {
  const raw = process.env.CLAWBOT_CREDENTIAL_KEY?.trim();
  if (raw) {
    // Try hex first (64 chars)
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, "hex");
    }
    // Try base64
    const buf = Buffer.from(raw, "base64");
    if (buf.length === 32) {
      return buf;
    }
    throw new Error(
      "CLAWBOT_CREDENTIAL_KEY must be 64 hex chars or 32-byte base64. Got length=" + buf.length,
    );
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "CLAWBOT_CREDENTIAL_KEY is required in production. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  // Dev-only fallback: deterministic key so restarts don't lose access
  console.warn("[credentials] CLAWBOT_CREDENTIAL_KEY not set, using dev-only key");
  return Buffer.from("0".repeat(64), "hex");
}

/**
 * Derive a per-account encryption key using HMAC-SHA256.
 * This ensures each account's ciphertext is encrypted with a unique derived key,
 * so compromising one account's data doesn't directly reveal the key for others.
 */
function deriveKey(masterKey: Buffer, accountId: string): Buffer {
  return createHmac("sha256", masterKey)
    .update("clawbot-credential-v1:" + accountId)
    .digest();
}

export type EncryptedToken = {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
};

/**
 * Encrypt a plaintext token using AES-256-GCM with a per-account derived key.
 */
export function encryptToken(
  plaintext: string,
  accountId: string,
  masterKey: Buffer,
): EncryptedToken {
  const key = deriveKey(masterKey, accountId);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext: encrypted, iv, authTag };
}

/**
 * Decrypt a token using AES-256-GCM with a per-account derived key.
 * Throws if tampered or wrong key.
 */
export function decryptToken(
  encrypted: EncryptedToken,
  accountId: string,
  masterKey: Buffer,
): string {
  const key = deriveKey(masterKey, accountId);
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(encrypted.authTag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]);
  return decrypted.toString("utf-8");
}
