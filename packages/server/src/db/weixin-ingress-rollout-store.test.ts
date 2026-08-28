import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { WeixinIngressRolloutStore } from "./weixin-ingress-rollout-store.js";

test("rollout defaults off and only enables explicit true rows", async () => {
  let value: { enabled: boolean } | null = null;
  const prisma = {
    weixinIngressRollout: {
      findUnique: async () => value,
    },
  } as unknown as PrismaClient;
  const store = new WeixinIngressRolloutStore(prisma);
  assert.equal(await store.isEnabled("account-1"), false);
  value = { enabled: false };
  assert.equal(await store.isEnabled("account-1"), false);
  value = { enabled: true };
  assert.equal(await store.isEnabled("account-1"), true);
});
