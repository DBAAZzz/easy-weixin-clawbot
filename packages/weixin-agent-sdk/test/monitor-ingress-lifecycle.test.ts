import assert from "node:assert/strict";
import test from "node:test";
import type { WeixinIngressLifecycle } from "../src/agent/interface.js";
import type { WeixinMessage } from "../src/api/types.js";
import { dispatchWeixinBatch } from "../src/monitor/monitor.js";

function message(seq: number, text = "hello"): WeixinMessage {
  return {
    from_user_id: "user-1",
    seq,
    client_id: "client-1",
    create_time_ms: 1_000 + seq,
    item_list: [{ type: 1, text_item: { text } }],
  };
}

test("accept runs before business processing and skip performs no work", async () => {
  const order: string[] = [];
  let processCount = 0;
  const lifecycle: WeixinIngressLifecycle = {
    async accept(input) {
      order.push(`accept:${input.seq}`);
      return { receiptId: `event-${input.seq}`, disposition: input.seq === 1 ? "skip" : "process" };
    },
    async invokeAgent() {
      return {};
    },
    async invokeClear() {},
    async settle({ receiptId, outcome }) {
      order.push(`settle:${receiptId}:${outcome}`);
    },
  };
  const cursor = await dispatchWeixinBatch({
    messages: [message(1), message(2)],
    nextSyncBuf: "next",
    ingressLifecycle: lifecycle,
    async processMessage(_message, context) {
      processCount += 1;
      order.push(`process:${context.receiptId}`);
      return "chat";
    },
    async onSyncBufUpdate() {
      order.push("cursor");
    },
  });
  assert.equal(processCount, 1);
  assert.equal(cursor, "next");
  assert.deepEqual(order, [
    "accept:1",
    "accept:2",
    "process:event-2",
    "settle:event-2:chat",
    "cursor",
  ]);
});

test("append or claim failure prevents cursor persistence", async () => {
  let cursorWrites = 0;
  const lifecycle: WeixinIngressLifecycle = {
    async accept() {
      throw new Error("append_failed");
    },
    async invokeAgent() {
      return {};
    },
    async invokeClear() {},
    async settle() {},
  };
  await assert.rejects(
    () =>
      dispatchWeixinBatch({
        messages: [message(1)],
        nextSyncBuf: "next",
        ingressLifecycle: lifecycle,
        async processMessage() {
          return "chat";
        },
        async onSyncBufUpdate() {
          cursorWrites += 1;
        },
      }),
    /append_failed/,
  );
  assert.equal(cursorWrites, 0);
});

test("settle failure is surfaced without advancing the cursor", async () => {
  let cursorWrites = 0;
  const lifecycle: WeixinIngressLifecycle = {
    async accept() {
      return { receiptId: "event-1", disposition: "process" };
    },
    async invokeAgent() {
      return {};
    },
    async invokeClear() {},
    async settle() {
      throw new Error("settle_failed");
    },
  };
  await assert.rejects(
    () =>
      dispatchWeixinBatch({
        messages: [message(1)],
        nextSyncBuf: "next",
        ingressLifecycle: lifecycle,
        async processMessage() {
          return "chat";
        },
        async onSyncBufUpdate() {
          cursorWrites += 1;
        },
      }),
    /settle_failed/,
  );
  assert.equal(cursorWrites, 0);
});

test("cursor persistence is awaited and failure is surfaced", async () => {
  let processed = false;
  await assert.rejects(
    () =>
      dispatchWeixinBatch({
        messages: [message(1)],
        nextSyncBuf: "next",
        async processMessage() {
          processed = true;
          return "chat";
        },
        async onSyncBufUpdate() {
          throw new Error("cursor_failed");
        },
      }),
    /cursor_failed/,
  );
  assert.equal(processed, true);
});
