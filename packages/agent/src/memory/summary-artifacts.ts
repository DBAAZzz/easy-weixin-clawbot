import type { ArtifactRevisionStore } from "../ports/artifact-revision-store.js";
import type { MemoryEventStore } from "../ports/memory-event-store.js";
import {
  MEMORY_EVENT_TYPE,
  type AppendMemoryEventInput,
  type JsonValue,
} from "../shared/fact-ledger/contracts.js";
import { sha256CanonicalJson } from "../shared/fact-ledger/canonical-json.js";
import type { SerializedTapeState } from "./types.js";

/**
 * Phase 5：compaction checkpoint 的 SUMMARY 制品化（设计 §8.2）。
 *
 * 制品文档与 Tape anchor 快照同源；memory_anchor_created 事件引用制品 id，
 * 使"记忆在何时被压缩固化"可审计。全部失败由调用方 fail-open 处理。
 */

export interface SummaryDocumentInput {
  accountId: string;
  branch: string;
  anchorType: string;
  /** 与 Tape anchor snapshot 同源的序列化状态。 */
  state: SerializedTapeState;
  /** 被压缩覆盖的 entry eids（与 anchor.manifest 同源）。 */
  entryIds: string[];
  createdAt: string;
}

export function buildSummaryDocument(input: SummaryDocumentInput): Record<string, unknown> {
  return {
    schemaVersion: 1,
    accountId: input.accountId,
    branch: input.branch,
    anchorType: input.anchorType,
    state: input.state,
    entryIds: [...input.entryIds],
    createdAt: input.createdAt,
  };
}

export function summaryArtifactId(document: Record<string, unknown>): string {
  return `summary-v1:${sha256CanonicalJson(document)}`;
}

export async function putSummaryArtifact(
  deps: { artifactRevisionStore: ArtifactRevisionStore },
  document: Record<string, unknown>,
): Promise<string | undefined> {
  try {
    const result = await deps.artifactRevisionStore.put({
      artifactId: summaryArtifactId(document),
      kind: "summary",
      sha256: sha256CanonicalJson(document),
      schemaVersion: 1,
      inlineJson: document as JsonValue,
    });
    return result.value.artifactId;
  } catch {
    return undefined;
  }
}

/**
 * compaction 固化后追加 memory_anchor_created（throughMemorySeq = 当前 branch
 * watermark），使 SUMMARY 制品在 Memory Event 流中有因果锚点。失败静默——
 * anchor 与制品已存在，事件缺口由对账/指标暴露。
 */
export async function appendMemoryAnchorCreated(input: {
  memoryEventStore: MemoryEventStore;
  accountId: string;
  branch: string;
  anchorAid: string;
  snapshotArtifactId: string;
  throughMemorySeq: number;
}): Promise<void> {
  try {
    await input.memoryEventStore.append({
      eventType: MEMORY_EVENT_TYPE.MEMORY_ANCHOR_CREATED,
      schemaVersion: 1,
      accountId: input.accountId,
      branch: input.branch,
      occurredAt: new Date().toISOString(),
      actor: { kind: "agent", id: input.accountId },
      causationId: input.anchorAid,
      correlationId: input.anchorAid,
      eventId: `memory-anchor-v1:${sha256CanonicalJson({
        accountId: input.accountId,
        branch: input.branch,
        anchorAid: input.anchorAid,
        snapshotArtifactId: input.snapshotArtifactId,
      })}`,
      payload: {
        snapshotArtifactId: input.snapshotArtifactId,
        throughMemorySeq: input.throughMemorySeq,
      },
    } as AppendMemoryEventInput);
  } catch {
    // 静默降级：事件缺失不破坏 anchor / 制品（设计 §8.2）。
  }
}
