import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { RunLedgerRolloutStore } from "./run-ledger-rollout-store.js";

test("missing run ledger rollout row is disabled by default", async () => {
  const prisma = {
    runLedgerRollout: {
      findUnique: async () => null,
    },
  } as unknown as PrismaClient;
  const store = new RunLedgerRolloutStore(prisma);
  assert.equal(await store.isEnabled("account-1"), false);
});

test("explicit rollout row enables the run ledger", async () => {
  let queriedAccount: string | undefined;
  const prisma = {
    runLedgerRollout: {
      findUnique: async (args: { where: { accountId: string } }) => {
        queriedAccount = args.where.accountId;
        return { enabled: true };
      },
    },
  } as unknown as PrismaClient;
  const store = new RunLedgerRolloutStore(prisma);
  assert.equal(await store.isEnabled("account-9"), true);
  assert.equal(queriedAccount, "account-9");
});

test("disabled rollout row keeps the run ledger off", async () => {
  const prisma = {
    runLedgerRollout: {
      findUnique: async () => ({ enabled: false }),
    },
  } as unknown as PrismaClient;
  const store = new RunLedgerRolloutStore(prisma);
  assert.equal(await store.isEnabled("account-1"), false);
});

test("read_path defaults to legacy for a missing or disabled row (Phase 6)", async () => {
  const missingRow = {
    runLedgerRollout: { findUnique: async () => null },
  } as unknown as PrismaClient;
  const disabledRow = {
    runLedgerRollout: { findUnique: async () => ({ enabled: false, readPath: "canonical" }) },
  } as unknown as PrismaClient;
  const store = new RunLedgerRolloutStore(missingRow);
  assert.equal(await store.readPath("account-1"), "legacy");
  const store2 = new RunLedgerRolloutStore(disabledRow);
  assert.equal(await store2.readPath("account-1"), "legacy");
});

test("read_path returns the stored state only when the rollout is enabled", async () => {
  const prisma = {
    runLedgerRollout: {
      findUnique: async () => ({ enabled: true, readPath: "dual" }),
    },
  } as unknown as PrismaClient;
  const store = new RunLedgerRolloutStore(prisma);
  assert.equal(await store.readPath("account-1"), "dual");
});
