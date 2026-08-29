import {
  CONTEXT_COMPILER_SHADOW_RESULT_DIFF_CATEGORIES,
  ContextCompilerShadowResultEquivalenceError,
  canonicalizeJson,
  type ContextCompilerShadowResultDiffCounts,
  type ContextCompilerShadowResultRecord,
  type ContextCompilerShadowResultStore,
} from "@clawbot/agent";
import { Prisma, type ContextCompilerShadowResult, type PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma.js";

const RECORD_KEYS = new Set([
  "sourceEventId",
  "accountId",
  "compilerVersion",
  "contextPolicyRevisionId",
  "eventCursor",
  "effectiveTime",
  "timezone",
  "canonicalContextHash",
  "canonicalMemoryInputHash",
  "legacySummaryHash",
  "canonicalEntryCount",
  "legacyEntryCount",
  "diffCounts",
  "status",
  "errorCode",
]);
const HASH_PATTERN = /^[a-f0-9]{64}$/u;

function requiredString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value;
}

function optionalHash(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !HASH_PATTERN.test(value)) {
    throw new Error("invalid_context_compiler_shadow_hash");
  }
  return value;
}

function optionalCount(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error("invalid_context_compiler_shadow_count");
  }
  return value as number;
}

export function parseContextCompilerShadowDiffCounts(
  value: unknown,
): ContextCompilerShadowResultDiffCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_context_compiler_shadow_diff_counts");
  }
  const input = value as Record<string, unknown>;
  const expected = new Set<string>(CONTEXT_COMPILER_SHADOW_RESULT_DIFF_CATEGORIES);
  if (
    Object.keys(input).length !== expected.size ||
    Object.keys(input).some((key) => !expected.has(key))
  ) {
    throw new Error("invalid_context_compiler_shadow_diff_category");
  }
  const parsed = {} as ContextCompilerShadowResultDiffCounts;
  for (const category of CONTEXT_COMPILER_SHADOW_RESULT_DIFF_CATEGORIES) {
    const count = input[category];
    if (!Number.isInteger(count) || (count as number) < 0) {
      throw new Error("invalid_context_compiler_shadow_diff_count");
    }
    parsed[category] = count as number;
  }
  return parsed;
}

export function parseContextCompilerShadowResultRecord(
  value: unknown,
): ContextCompilerShadowResultRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_context_compiler_shadow_result");
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !RECORD_KEYS.has(key))) {
    throw new Error("invalid_context_compiler_shadow_result_field");
  }
  const status = input.status;
  if (status !== "success" && status !== "failed") {
    throw new Error("invalid_context_compiler_shadow_status");
  }
  const eventCursor = input.eventCursor;
  if (!Number.isInteger(eventCursor) || (eventCursor as number) <= 0) {
    throw new Error("invalid_context_compiler_shadow_cursor");
  }
  const effectiveTimeInput = requiredString(
    input.effectiveTime,
    "invalid_context_compiler_shadow_time",
  );
  if (!Number.isFinite(Date.parse(effectiveTimeInput))) {
    throw new Error("invalid_context_compiler_shadow_time");
  }
  const effectiveTime = new Date(effectiveTimeInput).toISOString();
  const parsed: ContextCompilerShadowResultRecord = {
    sourceEventId: requiredString(input.sourceEventId, "invalid_context_compiler_shadow_identity"),
    accountId: requiredString(input.accountId, "invalid_context_compiler_shadow_identity"),
    compilerVersion: requiredString(
      input.compilerVersion,
      "invalid_context_compiler_shadow_identity",
    ),
    contextPolicyRevisionId: requiredString(
      input.contextPolicyRevisionId,
      "invalid_context_compiler_shadow_identity",
    ),
    eventCursor: eventCursor as number,
    effectiveTime,
    timezone: requiredString(input.timezone, "invalid_context_compiler_shadow_timezone"),
    diffCounts: parseContextCompilerShadowDiffCounts(input.diffCounts),
    status,
  };
  const canonicalContextHash = optionalHash(input.canonicalContextHash);
  const canonicalMemoryInputHash = optionalHash(input.canonicalMemoryInputHash);
  const legacySummaryHash = optionalHash(input.legacySummaryHash);
  const canonicalEntryCount = optionalCount(input.canonicalEntryCount);
  const legacyEntryCount = optionalCount(input.legacyEntryCount);
  const errorCode =
    input.errorCode === undefined
      ? undefined
      : requiredString(input.errorCode, "invalid_context_compiler_shadow_error_code");
  if (
    status === "success" &&
    (!canonicalContextHash ||
      !canonicalMemoryInputHash ||
      !legacySummaryHash ||
      canonicalEntryCount === undefined ||
      legacyEntryCount === undefined ||
      errorCode)
  ) {
    throw new Error("invalid_context_compiler_shadow_success_fields");
  }
  if (status === "failed" && !errorCode) {
    throw new Error("invalid_context_compiler_shadow_failed_fields");
  }
  return {
    ...parsed,
    ...(canonicalContextHash ? { canonicalContextHash } : {}),
    ...(canonicalMemoryInputHash ? { canonicalMemoryInputHash } : {}),
    ...(legacySummaryHash ? { legacySummaryHash } : {}),
    ...(canonicalEntryCount !== undefined ? { canonicalEntryCount } : {}),
    ...(legacyEntryCount !== undefined ? { legacyEntryCount } : {}),
    ...(errorCode ? { errorCode } : {}),
  };
}

function fromRow(row: ContextCompilerShadowResult): ContextCompilerShadowResultRecord {
  return parseContextCompilerShadowResultRecord({
    sourceEventId: row.sourceEventId,
    accountId: row.accountId,
    compilerVersion: row.compilerVersion,
    contextPolicyRevisionId: row.contextPolicyRevisionId,
    eventCursor: row.eventCursor,
    effectiveTime: row.effectiveTime.toISOString(),
    timezone: row.timezone,
    ...(row.canonicalContextHash ? { canonicalContextHash: row.canonicalContextHash } : {}),
    ...(row.canonicalMemoryInputHash
      ? { canonicalMemoryInputHash: row.canonicalMemoryInputHash }
      : {}),
    ...(row.legacySummaryHash ? { legacySummaryHash: row.legacySummaryHash } : {}),
    ...(row.canonicalEntryCount !== null ? { canonicalEntryCount: row.canonicalEntryCount } : {}),
    ...(row.legacyEntryCount !== null ? { legacyEntryCount: row.legacyEntryCount } : {}),
    diffCounts: row.diffCounts,
    status: row.status,
    ...(row.errorCode ? { errorCode: row.errorCode } : {}),
  });
}

function equivalent(
  left: ContextCompilerShadowResultRecord,
  right: ContextCompilerShadowResultRecord,
): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

export class PrismaContextCompilerShadowResultStore implements ContextCompilerShadowResultStore {
  constructor(private readonly injectedPrisma?: PrismaClient) {}

  private get prisma(): PrismaClient {
    return this.injectedPrisma ?? getPrisma();
  }

  async createOrVerifyEquivalent(raw: ContextCompilerShadowResultRecord): Promise<void> {
    const result = parseContextCompilerShadowResultRecord(raw);
    try {
      await this.prisma.contextCompilerShadowResult.create({
        data: {
          sourceEventId: result.sourceEventId,
          accountId: result.accountId,
          compilerVersion: result.compilerVersion,
          contextPolicyRevisionId: result.contextPolicyRevisionId,
          eventCursor: result.eventCursor,
          effectiveTime: new Date(result.effectiveTime),
          timezone: result.timezone,
          canonicalContextHash: result.canonicalContextHash,
          canonicalMemoryInputHash: result.canonicalMemoryInputHash,
          legacySummaryHash: result.legacySummaryHash,
          canonicalEntryCount: result.canonicalEntryCount,
          legacyEntryCount: result.legacyEntryCount,
          diffCounts: result.diffCounts as Prisma.InputJsonValue,
          status: result.status,
          errorCode: result.errorCode,
        },
      });
      return;
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
    }

    const existing = await this.prisma.contextCompilerShadowResult.findUnique({
      where: {
        sourceEventId_compilerVersion_contextPolicyRevisionId: {
          sourceEventId: result.sourceEventId,
          compilerVersion: result.compilerVersion,
          contextPolicyRevisionId: result.contextPolicyRevisionId,
        },
      },
    });
    if (!existing || !equivalent(fromRow(existing), result)) {
      throw new ContextCompilerShadowResultEquivalenceError(result.sourceEventId);
    }
  }
}
