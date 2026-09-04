import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTEXT_COMPILER_SHADOW_RESULT_DIFF_CATEGORIES,
  type ContextCompilerShadowResultDiffCounts,
  type ContextCompilerShadowResultRecord,
} from "@clawbot/agent";
import { ContextCompilerShadowResultEquivalenceError } from "@clawbot/agent";
import { Prisma, type ContextCompilerShadowResult, type PrismaClient } from "@prisma/client";
import {
  PrismaContextCompilerShadowResultStore,
  parseContextCompilerShadowDiffCounts,
  parseContextCompilerShadowResultRecord,
} from "../../src/db/context-compiler-shadow-result-store.js";

function diffCounts(): ContextCompilerShadowResultDiffCounts {
  return Object.fromEntries(
    CONTEXT_COMPILER_SHADOW_RESULT_DIFF_CATEGORIES.map((category) => [category, 0]),
  ) as ContextCompilerShadowResultDiffCounts;
}

function successRecord(): ContextCompilerShadowResultRecord {
  return {
    sourceEventId: "event-1",
    accountId: "account-1",
    compilerVersion: "context-compiler-v1",
    contextPolicyRevisionId: "context-policy-v1",
    eventCursor: 1,
    effectiveTime: "2026-08-28T08:00:00.000+08:00",
    timezone: "Asia/Shanghai",
    canonicalContextHash: "a".repeat(64),
    canonicalMemoryInputHash: "b".repeat(64),
    legacySummaryHash: "c".repeat(64),
    canonicalEntryCount: 1,
    legacyEntryCount: 1,
    diffCounts: diffCounts(),
    status: "success",
  };
}

test("shadow result parser accepts only hash/count operational fields", () => {
  const parsed = parseContextCompilerShadowResultRecord(successRecord());
  assert.equal(parsed.status, "success");
  assert.equal(parsed.effectiveTime, "2026-08-28T00:00:00.000Z");
  assert.equal("text" in parsed, false);
  assert.equal("payload" in parsed, false);
  assert.equal("prompt" in parsed, false);
});

test("shadow result parser rejects bodies, unknown categories and negative counts", () => {
  assert.throws(
    () => parseContextCompilerShadowResultRecord({ ...successRecord(), text: "secret" }),
    /invalid_context_compiler_shadow_result_field/u,
  );
  assert.throws(
    () => parseContextCompilerShadowDiffCounts({ ...diffCounts(), new_category: 1 }),
    /invalid_context_compiler_shadow_diff_category/u,
  );
  assert.throws(
    () => parseContextCompilerShadowDiffCounts({ ...diffCounts(), match_user_text: -1 }),
    /invalid_context_compiler_shadow_diff_count/u,
  );
});

test("failed shadow result requires a stable error code but no body hashes", () => {
  const parsed = parseContextCompilerShadowResultRecord({
    sourceEventId: "event-1",
    accountId: "account-1",
    compilerVersion: "context-compiler-v1",
    contextPolicyRevisionId: "context-policy-v1",
    eventCursor: 1,
    effectiveTime: "2026-08-28T00:00:00.000Z",
    timezone: "Asia/Shanghai",
    diffCounts: { ...diffCounts(), shadow_compile_failed: 1 },
    status: "failed",
    errorCode: "unsupported_schema_version",
  });
  assert.equal(parsed.status, "failed");
  assert.equal(parsed.canonicalContextHash, undefined);
});

test("result store creates once, accepts an equivalent replay and rejects changed identity", async () => {
  let row: ContextCompilerShadowResult | null = null;
  const prisma = {
    contextCompilerShadowResult: {
      async create({ data }: { data: Record<string, unknown> }) {
        if (row) {
          throw new Prisma.PrismaClientKnownRequestError("duplicate", {
            code: "P2002",
            clientVersion: Prisma.prismaVersion.client,
          });
        }
        const now = new Date();
        row = {
          sourceEventId: data.sourceEventId as string,
          accountId: data.accountId as string,
          compilerVersion: data.compilerVersion as string,
          contextPolicyRevisionId: data.contextPolicyRevisionId as string,
          eventCursor: data.eventCursor as number,
          effectiveTime: data.effectiveTime as Date,
          timezone: data.timezone as string,
          canonicalContextHash: data.canonicalContextHash as string | null,
          canonicalMemoryInputHash: data.canonicalMemoryInputHash as string | null,
          legacySummaryHash: data.legacySummaryHash as string | null,
          canonicalEntryCount: data.canonicalEntryCount as number | null,
          legacyEntryCount: data.legacyEntryCount as number | null,
          diffCounts: data.diffCounts as Prisma.JsonValue,
          status: data.status as string,
          errorCode: data.errorCode as string | null,
          createdAt: now,
          updatedAt: now,
        };
        return row;
      },
      async findUnique() {
        return row;
      },
    },
  } as unknown as PrismaClient;
  const store = new PrismaContextCompilerShadowResultStore(prisma);
  const base = successRecord();
  await store.createOrVerifyEquivalent(base);
  await store.createOrVerifyEquivalent(base);
  await assert.rejects(
    () =>
      store.createOrVerifyEquivalent({
        ...base,
        effectiveTime: "2026-08-28T08:00:01.000+08:00",
      }),
    (error: unknown) => {
      assert.ok(error instanceof ContextCompilerShadowResultEquivalenceError);
      assert.equal(error.code, "context_compiler_shadow_result_equivalence_conflict");
      return true;
    },
  );
});
