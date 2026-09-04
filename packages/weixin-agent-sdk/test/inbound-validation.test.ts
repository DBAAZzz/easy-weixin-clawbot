import assert from "node:assert/strict";
import test from "node:test";
import { validateWeixinInbound } from "../src/messaging/inbound-validation.js";

const valid = {
  from_user_id: "user-1",
  to_user_id: "bot-1",
  seq: 7,
  client_id: "client-1",
  create_time_ms: 1_000,
  item_list: [{ type: 1, msg_id: "item-1", text_item: { text: "原文" } }],
};

test("validates the protocol identity and snapshots receipt time", () => {
  const value = validateWeixinInbound(valid, 2_000);
  assert.equal(value.senderId, "user-1");
  assert.equal(value.receivedAtMs, 2_000);
  assert.equal(value.items[0]?.text, "原文");
});

test("requires message_id or a non-empty client_id with safe seq", () => {
  assert.throws(() => validateWeixinInbound({ ...valid, client_id: undefined }, 2_000));
  assert.throws(() => validateWeixinInbound({ ...valid, seq: -1 }, 2_000));
  assert.throws(() => validateWeixinInbound({ ...valid, create_time_ms: 1.5 }, 2_000));
  assert.throws(() => validateWeixinInbound({ ...valid, from_user_id: "" }, 2_000));
  assert.throws(() => validateWeixinInbound({ ...valid, from_user_id: "   " }, 2_000));
  assert.throws(() => validateWeixinInbound({ ...valid, client_id: "   " }, 2_000));
});

test("rejects group chat before ingress lifecycle", () => {
  assert.throws(
    () => validateWeixinInbound({ ...valid, group_id: "group-1" }, 2_000),
    /unsupported_group_chat/,
  );
});
