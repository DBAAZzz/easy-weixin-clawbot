import { createModuleLogger, getErrorFields } from "../logger.js";
import { decryptToken, encryptToken, getMasterKey, type EncryptedToken } from "./crypto.js";

const secretBoxLogger = createModuleLogger("secret-box");

/**
 * Text-column representation of an {@link EncryptedToken}: `iv.authTag.ciphertext`,
 * each part base64url-encoded.
 */
export function encodeSealedSecret(value: EncryptedToken): string {
  return [value.iv, value.authTag, value.ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decodeSealedSecret(value: string): EncryptedToken {
  const parts = value.split(".");
  // The ciphertext part is legitimately empty when the sealed secret was an
  // empty string; only the iv and authTag are always present.
  if (parts.length !== 3 || !parts[0] || !parts[1]) {
    throw new Error("Invalid sealed secret encoding");
  }

  return {
    iv: Buffer.from(parts[0], "base64url"),
    authTag: Buffer.from(parts[1], "base64url"),
    ciphertext: Buffer.from(parts[2], "base64url"),
  };
}

/**
 * Encrypt a secret for storage in a text column, bound to `scope`.
 *
 * `scope` selects the per-secret derived key, so a ciphertext moved to another
 * row (a different provider or account) fails to decrypt rather than silently
 * revealing the value.
 */
export function sealSecret(scope: string, plaintext: string): string {
  return encodeSealedSecret(encryptToken(plaintext, scope, getMasterKey()));
}

export function openSecret(scope: string, sealed: string): string {
  return decryptToken(decodeSealedSecret(sealed), scope, getMasterKey());
}

/**
 * Read path variant of {@link openSecret}: a secret that cannot be opened —
 * rotated or missing `CLAWBOT_CREDENTIAL_KEY`, corrupted ciphertext — degrades
 * to "this credential is unavailable" instead of throwing through whatever
 * request happened to read the row.
 *
 * The failure is logged with the scope only; the ciphertext never reaches logs.
 */
export function openSecretOrNull(scope: string, sealed: string): string | null {
  try {
    return openSecret(scope, sealed);
  } catch (error) {
    secretBoxLogger.error(
      { ...getErrorFields(error), scope },
      "解密密钥失败，该凭据按缺失处理（请检查 CLAWBOT_CREDENTIAL_KEY 是否变更）",
    );
    return null;
  }
}
