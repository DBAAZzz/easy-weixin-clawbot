import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { canonicalizeJson } from "@clawbot/agent";
import { verifyArtifact } from "./ledger-replay-audit.js";

const shaOf = (content: string) => createHash("sha256").update(Buffer.from(content)).digest("hex");

const sink = {
  async get(key: string) {
    if (key === "canonical_request/missing.json") return null;
    return new Uint8Array(Buffer.from(key.includes(".bin") ? "\u0001\u0002" : "{\"ok\":true}"));
  },
};

test("inline 制品：sha256 与 canonical JSON 重算一致 → ok；不一致 → hash_mismatch", async () => {
  const doc = { messages: [{ role: "user", text: "hi" }] };
  const ok = await verifyArtifact(
    { artifactId: "a", kind: "canonical_request", sha256: shaOf(canonicalizeJson(doc)), inlineJson: doc },
    sink,
  );
  assert.equal(ok, undefined);

  const bad = await verifyArtifact(
    {
      artifactId: "a",
      kind: "canonical_request",
      sha256: shaOf(canonicalizeJson({ tampered: true })),
      inlineJson: doc,
    },
    sink,
  );
  assert.equal(bad, "hash_mismatch");
});

test("storageRef 制品：可读且 hash 一致 → ok；不可读 → sink_unreadable", async () => {
  const ok = await verifyArtifact(
    {
      artifactId: "a",
      kind: "model_response",
      sha256: shaOf("{\"ok\":true}"),
      storageRef: { provider: "local-fact-ledger", key: "model_response/deadbeef.json" },
    },
    sink,
  );
  assert.equal(ok, undefined);

  const unreadable = await verifyArtifact(
    {
      artifactId: "a",
      kind: "model_response",
      sha256: shaOf("whatever"),
      storageRef: { provider: "local-fact-ledger", key: "canonical_request/missing.json" },
    },
    sink,
  );
  assert.equal(unreadable, "sink_unreadable");
});

test("既无 inline 也无 storageRef → hash_mismatch（契约本应拒绝）", async () => {
  const result = await verifyArtifact(
    { artifactId: "a", kind: "canonical_request", sha256: shaOf("x") },
    sink,
  );
  assert.equal(result, "hash_mismatch");
});
