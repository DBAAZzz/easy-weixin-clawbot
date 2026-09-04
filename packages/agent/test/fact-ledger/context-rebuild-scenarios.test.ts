import assert from "node:assert/strict";
import test from "node:test";
import {
  FACT_LEDGER_SCHEMA_VERSION,
  parseContextManifest,
  type ContextManifest,
} from "../../src/shared/fact-ledger/index.js";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function historicalManifest(): ContextManifest {
  return parseContextManifest({
    schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
    manifestId: "manifest-historical-1",
    compilerVersion: "context-compiler/1",
    contextPolicyRevisionId: "policy-2026-08-28",
    conversationEventIds: ["event-user-1", "event-assistant-delivered-1", "event-user-2"],
    runEventIds: ["run-event-tool-result-1"],
    summaryArtifactIds: [],
    memoryEventWatermark: "memory-seq:18",
    memoryArtifactId: "memory-snapshot-18",
    visualObservationIds: ["visual-observation-3"],
    modelRevisionId: "model-gpt-old",
    promptRevisionId: "prompt-chat-old",
    skillRevisionIds: ["skill-calendar-old"],
    toolRevisionIds: ["tool-calendar-old"],
    effectiveTime: "2026-08-28T08:30:00.000+08:00",
    timezone: "Asia/Shanghai",
    trimDecision: { droppedEventIds: [], strategy: "none" },
    canonicalRequestHash: HASH_A,
    providerRequestArtifactId: "provider-request-old",
  });
}

test("历史重放固定使用当时的事实游标、版本和有效时间", () => {
  const recorded = historicalManifest();
  const replayed = parseContextManifest(structuredClone(recorded));

  assert.deepEqual(replayed, recorded);
  assert.equal(replayed.modelRevisionId, "model-gpt-old");
  assert.equal(replayed.effectiveTime, "2026-08-28T08:30:00.000+08:00");
  assert.equal(replayed.canonicalRequestHash, HASH_A);
});

test("反事实重编译复用同一批会话事实，但产生独立的新版本清单", () => {
  const historical = historicalManifest();
  const counterfactual = parseContextManifest({
    ...historical,
    manifestId: "manifest-counterfactual-1",
    contextPolicyRevisionId: "policy-2026-09-01",
    modelRevisionId: "model-gpt-new",
    promptRevisionId: "prompt-chat-new",
    skillRevisionIds: ["skill-calendar-new"],
    toolRevisionIds: ["tool-calendar-new"],
    effectiveTime: "2026-09-01T10:00:00.000+08:00",
    canonicalRequestHash: HASH_B,
    providerRequestArtifactId: "provider-request-new",
  });

  assert.deepEqual(counterfactual.conversationEventIds, historical.conversationEventIds);
  assert.deepEqual(counterfactual.runEventIds, historical.runEventIds);
  assert.equal(counterfactual.memoryEventWatermark, historical.memoryEventWatermark);
  assert.notEqual(counterfactual.manifestId, historical.manifestId);
  assert.notEqual(counterfactual.modelRevisionId, historical.modelRevisionId);
  assert.notEqual(counterfactual.canonicalRequestHash, historical.canonicalRequestHash);

  assert.equal(historical.modelRevisionId, "model-gpt-old");
  assert.equal(historical.promptRevisionId, "prompt-chat-old");
});
