import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { encryptToken, decryptToken, getMasterKey } from "./crypto.js";

describe("credential crypto", () => {
  const masterKey = randomBytes(32);

  it("encrypts and decrypts a token correctly", () => {
    const plaintext = "bot-token-abc123-xyz";
    const accountId = "test-account-01";
    const encrypted = encryptToken(plaintext, accountId, masterKey);
    const decrypted = decryptToken(encrypted, accountId, masterKey);
    assert.equal(decrypted, plaintext);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const plaintext = "same-token";
    const accountId = "acct-1";
    const a = encryptToken(plaintext, accountId, masterKey);
    const b = encryptToken(plaintext, accountId, masterKey);
    assert.notDeepEqual(a.iv, b.iv);
    assert.notDeepEqual(a.ciphertext, b.ciphertext);
  });

  it("derives different keys for different accounts", () => {
    const plaintext = "shared-token";
    const a = encryptToken(plaintext, "acct-a", masterKey);
    const b = encryptToken(plaintext, "acct-b", masterKey);
    // Even with same plaintext, different account → different ciphertext
    // Decrypt with correct account succeeds
    assert.equal(decryptToken(a, "acct-a", masterKey), plaintext);
    assert.equal(decryptToken(b, "acct-b", masterKey), plaintext);
    // Decrypt with wrong account fails
    assert.throws(() => decryptToken(a, "acct-b", masterKey));
  });

  it("rejects tampered ciphertext", () => {
    const plaintext = "secret";
    const accountId = "acct";
    const encrypted = encryptToken(plaintext, accountId, masterKey);
    // Flip a byte in the ciphertext
    const tampered = { ...encrypted, ciphertext: Buffer.from(encrypted.ciphertext) };
    tampered.ciphertext[0] ^= 0xff;
    assert.throws(() => decryptToken(tampered, accountId, masterKey));
  });

  it("rejects wrong master key", () => {
    const plaintext = "secret";
    const accountId = "acct";
    const encrypted = encryptToken(plaintext, accountId, masterKey);
    const wrongKey = randomBytes(32);
    assert.throws(() => decryptToken(encrypted, accountId, wrongKey));
  });

  it("handles empty string tokens", () => {
    const encrypted = encryptToken("", "acct", masterKey);
    assert.equal(decryptToken(encrypted, "acct", masterKey), "");
  });

  it("handles unicode tokens", () => {
    const plaintext = "令牌-🔑-token";
    const encrypted = encryptToken(plaintext, "acct", masterKey);
    assert.equal(decryptToken(encrypted, "acct", masterKey), plaintext);
  });

  it("getMasterKey falls back in non-production", () => {
    const saved = process.env.CLAWBOT_CREDENTIAL_KEY;
    const savedNodeEnv = process.env.NODE_ENV;
    delete process.env.CLAWBOT_CREDENTIAL_KEY;
    delete process.env.NODE_ENV;
    try {
      const key = getMasterKey();
      assert.equal(key.length, 32);
    } finally {
      if (saved !== undefined) process.env.CLAWBOT_CREDENTIAL_KEY = saved;
      if (savedNodeEnv !== undefined) process.env.NODE_ENV = savedNodeEnv;
    }
  });

  it("getMasterKey accepts 64-char hex key", () => {
    const saved = process.env.CLAWBOT_CREDENTIAL_KEY;
    const hex = randomBytes(32).toString("hex");
    process.env.CLAWBOT_CREDENTIAL_KEY = hex;
    try {
      const key = getMasterKey();
      assert.equal(key.length, 32);
      assert.equal(key.toString("hex"), hex);
    } finally {
      if (saved !== undefined) {
        process.env.CLAWBOT_CREDENTIAL_KEY = saved;
      } else {
        delete process.env.CLAWBOT_CREDENTIAL_KEY;
      }
    }
  });

  it("getMasterKey accepts base64 key", () => {
    const saved = process.env.CLAWBOT_CREDENTIAL_KEY;
    const b64 = randomBytes(32).toString("base64");
    process.env.CLAWBOT_CREDENTIAL_KEY = b64;
    try {
      const key = getMasterKey();
      assert.equal(key.length, 32);
    } finally {
      if (saved !== undefined) {
        process.env.CLAWBOT_CREDENTIAL_KEY = saved;
      } else {
        delete process.env.CLAWBOT_CREDENTIAL_KEY;
      }
    }
  });
});
