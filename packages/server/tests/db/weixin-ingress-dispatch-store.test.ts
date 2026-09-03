import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { WeixinIngressDispatchStore } from "../../src/db/weixin-ingress-dispatch-store.js";

test("dispatch store claims once and rejects account rebinding", async () => {
  let claimed = true;
  let receiptAccount = "account-1";
  let queryCount = 0;
  const tx = {
    $executeRaw: async () => 1,
    $queryRaw: async () => {
      queryCount += 1;
      if (queryCount % 2 === 1) return [{ accountId: receiptAccount }];
      return claimed ? [{ eventId: "event-1" }] : [];
    },
  };
  const prisma = {
    $transaction: async (operation: (client: typeof tx) => unknown) => operation(tx),
  } as unknown as PrismaClient;
  const store = new WeixinIngressDispatchStore(prisma);
  assert.equal(await store.createAndClaim("event-1", "account-1"), true);
  claimed = false;
  assert.equal(await store.createAndClaim("event-1", "account-1"), false);
  receiptAccount = "account-2";
  await assert.rejects(() => store.createAndClaim("event-1", "account-1"), /account_mismatch/);
});

test("dispatch store refuses invalid settle transitions", async () => {
  let transitioned = false;
  const prisma = {
    $queryRaw: async () => transitioned ? [{ eventId: "event-1" }] : [],
  } as unknown as PrismaClient;
  const store = new WeixinIngressDispatchStore(prisma);
  await assert.rejects(() => store.settle("event-1", "chat"), /invalid_ingress_settle_transition/);
  transitioned = true;
  await assert.doesNotReject(() => store.settle("event-1", "failed", "test_failure"));
});
