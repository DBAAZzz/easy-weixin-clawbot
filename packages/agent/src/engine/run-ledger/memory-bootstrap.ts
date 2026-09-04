import { ARTIFACT_KIND } from "../../shared/fact-ledger/contracts.js";
import { serializeState } from "../../memory/fold.js";
import { GLOBAL_BRANCH } from "../../memory/constants.js";
import { recall } from "../../memory/service.js";
import type { MemoryEventStore } from "../../ports/memory-event-store.js";
import type { TapeStore } from "../../ports/tape-store.js";
import { createHash } from "node:crypto";

/**
 * Phase 5：manifest 记忆字段读取与 MEMORY_SNAPSHOT 制品（设计 §6）。
 *
 * 语义为 "as of compile time"——读取发生在模型调用前，本 run 提取的新记忆
 * 不在其中。全部读取/写入失败只降级自身（watermark 回退、字段缺省），
 * 绝不使 run 降级：memory 字段是增益信息，不是 manifest 必备项。
 */

export interface MemoryCoverageResult {
  /** "wm-v1:<globalSeq>/<sessionSeq>" 或回退值 "unavailable-v1"。 */
  watermark: string;
  /** MEMORY_SNAPSHOT 制品 id；put 失败时 undefined。 */
  memoryArtifactId?: string;
}

function snapshotArtifactId(accountId: string, runId: string): string {
  const digest = createHash("sha256")
    .update(accountId, "utf8")
    .update("\0", "utf8")
    .update(runId, "utf8")
    .digest("hex");
  return `memory-snapshot-v1:${digest}`;
}

export async function readMemoryCoverage(input: {
  accountId: string;
  runId: string;
  sessionBranch: string;
  memoryEventStore: MemoryEventStore;
  putArtifact: (
    kind: (typeof ARTIFACT_KIND)[keyof typeof ARTIFACT_KIND],
    document: unknown,
    options?: { artifactId?: string },
  ) => Promise<{ artifactId: string; sha256: string } | undefined>;
}): Promise<MemoryCoverageResult> {
  const { accountId, runId, sessionBranch, memoryEventStore } = input;
  try {
    const [globalSeq, sessionSeq] = await Promise.all([
      memoryEventStore.headSeq(accountId, GLOBAL_BRANCH),
      memoryEventStore.headSeq(accountId, sessionBranch),
    ]);
    const watermark = `wm-v1:${globalSeq}/${sessionSeq}`;

    // 快照与 <memory> 注入同源（recall + serializeState），重放可重建注入文本。
    const [globalState, sessionState] = await Promise.all([
      recall(accountId, GLOBAL_BRANCH),
      recall(accountId, sessionBranch),
    ]);
    const snapshotDoc = {
      watermark,
      branches: {
        global: serializeState(globalState),
        session: serializeState(sessionState),
      },
    };

    const artifact = await input.putArtifact(ARTIFACT_KIND.MEMORY_SNAPSHOT, snapshotDoc, {
      artifactId: snapshotArtifactId(accountId, runId),
    });
    if (!artifact) return { watermark: "unavailable-v1" };
    return { watermark, memoryArtifactId: artifact.artifactId };
  } catch {
    // 增益信息失败 → 字段回退，不影响 run（设计 §6.2）。
    return { watermark: "unavailable-v1" };
  }
}

/** 已制品化的 checkpoint SUMMARY 制品 ids（as of compile time，最新在前，截断保护）。 */
export async function readSummaryArtifactIds(input: {
  accountId: string;
  sessionBranch: string;
  tapeStore: TapeStore;
}): Promise<string[]> {
  try {
    const anchors = await input.tapeStore.listAnchors(input.accountId, input.sessionBranch, 20);
    return anchors
      .map((anchor) => anchor.summaryArtifactId ?? null)
      .filter((id): id is string => id !== null);
  } catch {
    return [];
  }
}
