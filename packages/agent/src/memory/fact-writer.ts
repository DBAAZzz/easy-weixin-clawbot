import { createHash } from "node:crypto";
import type {
  MemoryAssertionCategory,
  MemoryEventStore,
} from "../ports/memory-event-store.js";
import type { AppendMemoryEventInput } from "../shared/fact-ledger/contracts.js";
import { MEMORY_EVENT_TYPE } from "../shared/fact-ledger/contracts.js";
import { canonicalizeJson, sha256CanonicalJson } from "../shared/fact-ledger/canonical-json.js";
import { memorySupersededTotal } from "@clawbot/observability";
import { GLOBAL_BRANCH } from "./constants.js";
import { recall } from "./service.js";
import type { TapeState } from "./types.js";

/**
 * Memory Event 双写（Phase 5 设计 §5）。
 *
 * 把 extractor 的提取产物以 memory_asserted / memory_superseded 事件落入事实账本，
 * 与 Tape 投影并行（账本先行）。整体在 Tape 串行队列任务内执行（§5.1），
 * 因此同一 key 的并发提取在这里天然串行。
 */

export interface MemoryFactEvidence {
  /** 对话出处：inbound 事件 id。缺失 → 不写事件（宁缺毋假），只写 Tape。 */
  sourceEventId?: string;
  /** Phase 4 确定性 runId —— assistant 侧证据经它解析 run 链。 */
  runId?: string;
  /** extractor 模型的 MODEL_CONFIG_REVISION（与 prompt revision 成对必填）。 */
  extractionModelRevisionId?: string;
  /** memory_extract prompt 的 PROMPT_REVISION。 */
  extractionPromptRevisionId?: string;
}

export interface MemoryFactInput {
  accountId: string;
  /** 事实账本 branch（global / session 对应 extraction 的 scope）。 */
  branch: string;
  scope: "global" | "session";
  category: MemoryAssertionCategory;
  key: string;
  value: unknown;
  confidence: number;
  evidence: MemoryFactEvidence;
}

export type MemoryFactLedgerResult =
  | { result: "appended"; assertedEventId: string }
  | { result: "skipped_unchanged" }
  | { result: "skipped_no_evidence" }
  | { result: "conflict" };

function sha256Nul(...parts: string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function hashValue(value: unknown): string {
  return sha256CanonicalJson(value);
}

/** 事件 id：断言表达"在某次 run 中，key 从 prev 变为 value"（设计 §5.2）。 */
export function deriveMemoryAssertionEventId(input: {
  accountId: string;
  branch: string;
  category: MemoryAssertionCategory;
  key: string;
  prevHash: string;
  valueHash: string;
  sourceRunId: string;
}): string {
  return `memory-event-v1:${sha256Nul(
    input.accountId,
    input.branch,
    input.category,
    input.key,
    input.prevHash,
    input.valueHash,
    input.sourceRunId,
  )}`;
}

export function deriveMemorySupersededEventId(input: {
  accountId: string;
  branch: string;
  category: MemoryAssertionCategory;
  key: string;
  prevHash: string;
  valueHash: string;
  sourceRunId: string;
}): string {
  return `memory-event-v1:${sha256Nul(
    input.accountId,
    input.branch,
    input.category,
    input.key,
    "superseded",
    input.prevHash,
    input.valueHash,
    input.sourceRunId,
  )}`;
}

/** value 等价比较走 canonical JSON，对象/原始值统一处理。 */
function sameValue(left: unknown, right: unknown): boolean {
  return canonicalizeJson(left) === canonicalizeJson(right);
}

/**
 * 从 Tape 投影读取该 key 的当前值（previous）。
 * fact/preference 按 key 唯一；decision 是时间线，取同 context 的最后一条描述。
 */
export function lookupPreviousValue(
  state: TapeState,
  category: MemoryAssertionCategory,
  key: string,
): unknown {
  if (category === "fact") return state.facts.get(key)?.value;
  if (category === "preference") return state.preferences.get(key)?.value;
  const decisions = state.decisions.filter((decision) => decision.context === key);
  return decisions.at(-1)?.description;
}

export interface WriteMemoryFactOptions {
  /** 队列任务的当前时间（测试可注入）。 */
  now?: () => Date;
}

/**
 * 账本侧写入：derive → （必要时）superseded → asserted。
 * 由 Tape 串行队列任务调用；事件失败向上抛出，由队列决定指标与 Tape 继续。
 */
export async function writeMemoryFactToLedger(
  deps: { memoryEventStore: MemoryEventStore },
  input: MemoryFactInput,
  options: WriteMemoryFactOptions = {},
): Promise<MemoryFactLedgerResult> {
  const { evidence } = input;
  const now = options.now ?? ((): Date => new Date());
  // 证据链不完整 → 宁缺毋假：不写事件，只写 Tape（设计 §5.2）。
  if (!evidence.sourceEventId || !evidence.runId) {
    return { result: "skipped_no_evidence" };
  }
  if (!evidence.extractionModelRevisionId || !evidence.extractionPromptRevisionId) {
    return { result: "skipped_no_evidence" };
  }

  const state = await recall(input.accountId, input.branch);
  const previousValue = lookupPreviousValue(state, input.category, input.key);
  const valueHash = hashValue(input.value);
  const prevHash = previousValue === undefined ? "initial" : hashValue(previousValue);

  // 同值幂等：值未变就没有新信息，不产生事件。
  if (previousValue !== undefined && sameValue(previousValue, input.value)) {
    return { result: "skipped_unchanged" };
  }

  const occurredAt = now().toISOString();
  const assertedEventId = deriveMemoryAssertionEventId({
    accountId: input.accountId,
    branch: input.branch,
    category: input.category,
    key: input.key,
    prevHash,
    valueHash,
    sourceRunId: evidence.runId,
  });

  // superseded 的 target 必须真实可解析：live 断言必须在写入新断言"之前"
  // 捕获，否则查到的会是刚写入的新断言自身。校验其值与 Tape previous 一致
  // 才引用（Tape 存量 / 投影缺口时不伪造）。
  let liveTargetEventId: string | undefined;
  if (input.category !== "decision" && previousValue !== undefined) {
    const live = await deps.memoryEventStore.findLiveAssertionByKey(
      input.accountId,
      input.branch,
      input.category,
      input.key,
    );
    const liveValue = live ? (live.payload as { value?: unknown }).value : undefined;
    if (
      live &&
      live.eventType === MEMORY_EVENT_TYPE.MEMORY_ASSERTED &&
      sameValue(liveValue, previousValue)
    ) {
      liveTargetEventId = live.eventId;
    }
  }

  // 断言先行：保证 superseded 的 replacement 在写入时已存在（防悬挂引用）。
  const asserted: AppendMemoryEventInput = {
    eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
    schemaVersion: 1,
    accountId: input.accountId,
    branch: input.branch,
    occurredAt,
    actor: { kind: "agent", id: input.accountId },
    causationId: evidence.runId,
    correlationId: evidence.sourceEventId,
    eventId: assertedEventId,
    payload: {
      category: input.category,
      scope: input.scope,
      key: input.key,
      value: input.value,
      confidence: input.confidence,
      sourceConversationEventIds: [evidence.sourceEventId],
      sourceRunId: evidence.runId,
      extractionModelRevisionId: evidence.extractionModelRevisionId,
      extractionPromptRevisionId: evidence.extractionPromptRevisionId,
    },
  } as AppendMemoryEventInput;

  try {
    await deps.memoryEventStore.append(asserted);
  } catch (error) {
    // 同 id 不同 payload（重投重跑的 confidence 抖动）→ 既有事件是权威版本。
    if ((error as { name?: string }).name === "FactLedgerIdConflictError") {
      return { result: "conflict" };
    }
    throw error;
  }

  // decision 在 Tape 里是时间线（不按 key 替换），没有"被替换的旧值"语义；
  // live 断言缺失（Tape 存量 key）或与 Tape 前值不一致（投影缺口）→ 只写
  // asserted，绝不写 target 缺失的 superseded（设计 §5.2，宁缺毋假）。
  if (
    input.category === "decision" ||
    previousValue === undefined ||
    liveTargetEventId === undefined
  ) {
    memorySupersededTotal.inc({ result: "orphan_target" });
    return { result: "appended", assertedEventId };
  }

  const superseded: AppendMemoryEventInput = {
    eventType: MEMORY_EVENT_TYPE.MEMORY_SUPERSEDED,
    schemaVersion: 1,
    accountId: input.accountId,
    branch: input.branch,
    occurredAt,
    actor: { kind: "agent", id: input.accountId },
    causationId: evidence.runId,
    correlationId: evidence.sourceEventId,
    eventId: deriveMemorySupersededEventId({
      accountId: input.accountId,
      branch: input.branch,
      category: input.category,
      key: input.key,
      prevHash,
      valueHash,
      sourceRunId: evidence.runId,
    }),
    payload: {
      targetMemoryEventId: liveTargetEventId,
      replacementMemoryEventId: assertedEventId,
      reason: "value_updated",
    },
  } as AppendMemoryEventInput;
  await deps.memoryEventStore.append(superseded);
  memorySupersededTotal.inc({ result: "appended" });

  return { result: "appended", assertedEventId };
}

/** scope → 事实账本 branch（global scope 写入全局分支）。 */
export function branchForScope(scope: "global" | "session", sessionBranch: string): string {
  return scope === "global" ? GLOBAL_BRANCH : sessionBranch;
}
