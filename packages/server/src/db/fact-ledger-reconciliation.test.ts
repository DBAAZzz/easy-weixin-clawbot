import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { reconcileWeixinIngress } from "./fact-ledger-reconciliation.js";

test("reconciliation keeps healthy links in summary and returns only actionable issues", async () => {
  const old = new Date(Date.now() - 600_000);
  const rows = [
    {
      eventId: "linked", accountId: "account-1", status: "completed", outcome: "chat",
      claimedAt: old, completedAt: old, errorCode: null,
      event: { eventType: "inbound_message_received", accountId: "account-1" },
    },
    {
      eventId: "missing", accountId: "account-1", status: "completed", outcome: "chat",
      claimedAt: old, completedAt: old, errorCode: null,
      event: { eventType: "inbound_message_received", accountId: "account-1" },
    },
    {
      eventId: "stuck", accountId: "account-1", status: "processing", outcome: null,
      claimedAt: old, completedAt: null, errorCode: null,
      event: { eventType: "inbound_message_received", accountId: "account-1" },
    },
  ];
  const links = [{
    eventId: "linked", state: "persisted", messageId: 1n, clearedAt: null,
    message: { role: "user" },
  }];
  const prisma = {
    weixinIngressDispatch: { findMany: async () => rows },
    legacyMessageProjectionLink: { findMany: async () => links },
  } as unknown as PrismaClient;

  const report = await reconcileWeixinIngress(
    "account-1",
    { graceSeconds: 0, stuckSeconds: 300 },
    prisma,
  );
  assert.equal(report.summary.linked, 1);
  assert.deepEqual(report.issues.map((issue) => issue.result).sort(), ["missing", "stuck"]);
  assert.equal(report.issues.some((issue) => issue.eventId === "linked"), false);
});
