import assert from "node:assert/strict";
import test from "node:test";
import {
  createCallId,
  createDeliveryId,
  createManifestId,
  createOutboundFactEventId,
  createRunEventId,
  createRunId,
  toStableErrorCode,
} from "../../src/engine/run-ledger/ids.js";

test("run ledger ids are deterministic and unambiguous", () => {
  const first = createRunId("account-1", "event-1");
  const second = createRunId("account-1", "event-1");
  assert.equal(first, second);
  assert.match(first, /^run-v1:[a-f0-9]{64}$/);

  // NUL separators must prevent concatenation ambiguity.
  assert.notEqual(createRunId("account", "1event"), createRunId("account1", "event"));

  assert.match(createCallId("run-1", 3), /^call-v1:[a-f0-9]{64}$/);
  assert.notEqual(createCallId("run-1", 1), createCallId("run-1", 2));
  assert.match(createDeliveryId("account-1", "event-1"), /^delivery-v1:[a-f0-9]{64}$/);
  assert.match(createManifestId("account-1", "run-1"), /^context-manifest-v1:[a-f0-9]{64}$/);
  assert.match(
    createOutboundFactEventId("account-1", "event-1", "delivered"),
    /^outbound-v1:[a-f0-9]{64}$/,
  );

  const eventId = createRunEventId("account-1", "run-1", "model_call_started", "call-1");
  assert.match(eventId, /^run-event-v1:[a-f0-9]{64}$/);
  assert.equal(eventId, createRunEventId("account-1", "run-1", "model_call_started", "call-1"));
  // Same localKey under a different event kind must not collide.
  assert.notEqual(eventId, createRunEventId("account-1", "run-1", "model_call_completed", "call-1"));
});

test("toStableErrorCode maps known errors and collapses everything else", () => {
  assert.equal(toStableErrorCode(Object.assign(new Error("boom"), { code: "model_timeout" })), "model_timeout");
  const abort = new Error("aborted");
  abort.name = "AbortError";
  assert.equal(toStableErrorCode(abort), "aborted");
  assert.equal(toStableErrorCode(new Error("raw message with secret")), "internal_error");
  assert.equal(toStableErrorCode("string error"), "internal_error");
  assert.equal(toStableErrorCode(undefined), "internal_error");
  // Unsafe code shapes must not pass through.
  assert.equal(
    toStableErrorCode(Object.assign(new Error("x"), { code: "DROP TABLE users;--" })),
    "internal_error",
  );
});
