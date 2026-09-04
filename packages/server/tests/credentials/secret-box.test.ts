import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { decodeSealedSecret, encodeSealedSecret, openSecret, sealSecret } from "../../src/credentials/secret-box.js";

describe("secret box", () => {
  it("round-trips a secret under the same scope", () => {
    const sealed = sealSecret("scope-a", "sk-live-abc123");
    assert.equal(openSecret("scope-a", sealed), "sk-live-abc123");
  });

  it("does not store the plaintext in the sealed value", () => {
    const sealed = sealSecret("scope-a", "sk-live-abc123");
    assert.ok(!sealed.includes("sk-live-abc123"));
  });

  it("produces a different ciphertext each time", () => {
    const a = sealSecret("scope-a", "same");
    const b = sealSecret("scope-a", "same");
    assert.notEqual(a, b);
  });

  it("refuses to open a secret sealed under a different scope", () => {
    const sealed = sealSecret("model-provider-template:1", "sk-live-abc123");
    assert.throws(() => openSecret("model-provider-template:2", sealed));
  });

  it("rejects tampered ciphertext", () => {
    const sealed = sealSecret("scope-a", "sk-live-abc123");
    const parts = sealed.split(".");
    const body = Buffer.from(parts[2], "base64url");
    body[0] ^= 0xff;
    parts[2] = body.toString("base64url");
    assert.throws(() => openSecret("scope-a", parts.join(".")));
  });

  it("round-trips the encoding", () => {
    const sealed = sealSecret("scope-a", "value");
    const decoded = decodeSealedSecret(sealed);
    assert.equal(encodeSealedSecret(decoded), sealed);
  });

  it("rejects malformed encodings", () => {
    assert.throws(() => decodeSealedSecret("not-sealed"));
    assert.throws(() => decodeSealedSecret("a.b"));
    assert.throws(() => decodeSealedSecret(".b.c"));
    assert.throws(() => decodeSealedSecret("a..c"));
  });

  it("accepts an empty ciphertext part, which an empty secret legitimately produces", () => {
    const sealed = sealSecret("s", "");
    assert.ok(sealed.endsWith("."));
    assert.equal(openSecret("s", sealed), "");
  });

  it("handles empty and unicode secrets", () => {
    assert.equal(openSecret("s", sealSecret("s", "")), "");
    assert.equal(openSecret("s", sealSecret("s", "密钥-🔑")), "密钥-🔑");
  });
});
