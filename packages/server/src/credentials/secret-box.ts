import { decryptToken, encryptToken, getMasterKey, type EncryptedToken } from "./crypto.js";

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
