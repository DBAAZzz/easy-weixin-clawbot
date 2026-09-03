import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { reconcileWeixinIngress } from "./fact-ledger-reconciliation.js";

test("reconciliation keeps healthy links in summary and returns only actionable issues", async () => {
  const old = new Date(Date.now() - 600_000);
  const rows = [
    {
      eventId: "linked",
      accountId: "account-1",
      status: "completed",
      outcome: "chat",
      claimedAt: old,
      completedAt: old,
      errorCode: null,
      commandName: null,
      event: { eventType: "inbound_message_received", accountId: "account-1" },
    },
    {
      eventId: "missing",
      accountId: "account-1",
      status: "completed",
      outcome: "chat",
      claimedAt: old,
      completedAt: old,
      errorCode: null,
      commandName: null,
      event: { eventType: "inbound_message_received", accountId: "account-1" },
    },
    {
      eventId: "stuck",
      accountId: "account-1",
      status: "processing",
      outcome: null,
      claimedAt: old,
      completedAt: null,
      errorCode: null,
      commandName: null,
      event: { eventType: "inbound_message_received", accountId: "account-1" },
    },
  ];
  const links = [
    {
      eventId: "linked",
      state: "persisted",
      messageId: 1n,
      clearedAt: null,
      message: { role: "user" },
    },
  ];
  const prisma = {
    weixinIngressDispatch: { findMany: async () => rows },
    legacyMessageProjectionLink: { findMany: async () => links },
    conversationEvent: { findMany: async () => [] },
    agentRunEvent: { findMany: async () => [] },
  } as unknown as PrismaClient;

  const report = await reconcileWeixinIngress(
    "account-1",
    { graceSeconds: 0, stuckSeconds: 300 },
    prisma,
  );
  assert.equal(report.summary.linked, 1);
  assert.deepEqual(report.issues.map((issue) => issue.result).sort(), ["missing", "stuck"]);
  assert.equal(
    report.issues.some((issue) => issue.eventId === "linked"),
    false,
  );
});

test("reconciliation rejects a completed clear receipt without its causation boundary", async () => {
  const old = new Date(Date.now() - 600_000);
  const rows = [
    {
      eventId: "clear-source",
      accountId: "account-1",
      status: "completed",
      outcome: "command",
      commandName: "clear",
      claimedAt: old,
      completedAt: old,
      errorCode: null,
      event: { eventType: "inbound_message_received", accountId: "account-1" },
    },
  ];
  let boundaries: Array<{ causationId: string | null }> = [];
  let deliveredFacts: Array<{ eventId: string; causationId: string | null; streamId: string }> = [];
  const prisma = {
    weixinIngressDispatch: { findMany: async () => rows },
    legacyMessageProjectionLink: { findMany: async () => [] },
    conversationEvent: {
      findMany: async (args: { where: { eventType?: string } }) => {
        if (args.where.eventType === "outbound_message_delivered") return deliveredFacts;
        return boundaries;
      },
    },
    agentRunEvent: { findMany: async () => [] },
  } as unknown as PrismaClient;

  const missing = await reconcileWeixinIngress("account-1", {}, prisma);
  assert.deepEqual(missing.issues, [
    {
      eventId: "clear-source",
      accountId: "account-1",
      result: "unexpected",
    },
  ]);

  boundaries = [{ causationId: "clear-source" }];
  const healthy = await reconcileWeixinIngress("account-1", {}, prisma);
  assert.deepEqual(healthy.issues, []);
});

test("proactive outbound facts correlate by runId across streams (Phase 6 §12)", async () => {
  const runId = "run-v1:abc";
  const delivered = [
    {
      eventId: "fact-proactive",
      accountId: "account-1",
      causationId: runId,
      // scheduler 场景：run 执行流(scheduler:1) ≠ 目标会话(target-conv)。
      streamId: "target-conv",
    },
  ];
  const prisma = {
    weixinIngressDispatch: { findMany: async () => [] },
    legacyMessageProjectionLink: { findMany: async () => [] },
    conversationEvent: { findMany: async () => delivered },
    agentRunEvent: {
      findMany: async (args: { where: Record<string, unknown> }) => {
        const eventType = args.where.eventType;
        const eventTypeIn =
          typeof eventType === "object" && eventType !== null && "in" in eventType
            ? (eventType as { in: string[] }).in
            : eventType;
        const isStarted = eventTypeIn === "run_started";
        const isTerminal =
          Array.isArray(eventTypeIn) &&
          eventTypeIn.includes("run_completed") &&
          eventTypeIn.includes("run_interrupted");
        const hasCausation = "causationId" in args.where;
        const runIdFilter = args.where.runId as { in?: string[] } | string | undefined;
        const requestedRunIds = Array.isArray(runIdFilter)
          ? runIdFilter
          : typeof runIdFilter === "object" && runIdFilter !== null
            ? (runIdFilter.in ?? [])
            : runIdFilter === undefined
              ? []
              : [runIdFilter];
        if (isStarted && hasCausation) return []; // receipt-keyed starts: none
        if (isStarted && requestedRunIds.includes(runId)) return [{ runId }];
        if (isTerminal && requestedRunIds.includes(runId)) return [{ runId }];
        return [];
      },
    },
  } as unknown as PrismaClient;

  const report = await reconcileWeixinIngress("account-1", {}, prisma);
  assert.equal(report.summary.unexpected, 0, "proactive fact with terminal run is expected");
  assert.equal(
    report.issues.some((issue) => issue.eventId === "fact-proactive"),
    false,
  );
});

test("proactive outbound fact without a terminal run is unexpected", async () => {
  const delivered = [
    {
      eventId: "fact-orphan",
      accountId: "account-1",
      causationId: "run-v1:ghost",
      streamId: "target-conv",
    },
  ];
  const prisma = {
    weixinIngressDispatch: { findMany: async () => [] },
    legacyMessageProjectionLink: { findMany: async () => [] },
    conversationEvent: { findMany: async () => delivered },
    agentRunEvent: { findMany: async () => [] },
  } as unknown as PrismaClient;

  const report = await reconcileWeixinIngress("account-1", {}, prisma);
  assert.equal(report.summary.unexpected, 1);
  assert.equal(report.issues[0]?.eventId, "fact-orphan");
});
