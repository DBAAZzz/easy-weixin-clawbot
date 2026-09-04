/**
 * Dual comparison (Phase 6 design §9) — hashes both assembled histories over
 * the fixed (role, text) projection and classifies differences into the fixed
 * dimensions. Never logs message bodies: dimension counters and entry indexes
 * only (§14).
 */

import { createHash } from "node:crypto";
import type { AgentMessage } from "../../llm/types.js";
import { MESSAGE_CONTENT_TYPE } from "@clawbot/shared";

export type DualDiffDimension = "entry_count" | "role_order" | "text_mismatch" | "media_missing";

export interface DualComparison {
  result: "same" | "different";
  dimensions: DualDiffDimension[];
  /** First diverging entry index (both sides), for diff logs. Never content. */
  firstDivergenceIndex?: number;
}

interface MessageProjection {
  role: string;
  text: string;
  mediaCount: number;
}

function project(messages: AgentMessage[]): MessageProjection[] {
  return messages.map((message) => {
    const rawContent = (message as { content: unknown }).content;
    const content = (
      Array.isArray(rawContent) ? rawContent : [{ type: "text", text: String(rawContent ?? "") }]
    ) as Array<{ type?: string; text?: string }>;
    let text = "";
    let mediaCount = 0;
    for (const block of content) {
      if (block.type === MESSAGE_CONTENT_TYPE.TEXT) text += block.text ?? "";
      if (block.type === MESSAGE_CONTENT_TYPE.IMAGE) mediaCount += 1;
    }
    return { role: message.role, text, mediaCount };
  });
}

/**
 * Canonical hash over the fixed (role, text) projection (§9). Media blocks are
 * intentionally excluded from the hash — a missing replay shows up as the
 * `media_missing` dimension instead of a hash mismatch.
 */
export function canonicalMessagesHash(messages: AgentMessage[]): string {
  const hash = createHash("sha256");
  for (const projection of project(messages)) {
    hash.update(projection.role);
    hash.update("\0");
    hash.update(projection.text);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function compareDualHistories(
  legacy: AgentMessage[],
  canonical: AgentMessage[],
): DualComparison {
  const left = project(legacy);
  const right = project(canonical);
  const dimensions: DualDiffDimension[] = [];

  if (left.length !== right.length) dimensions.push("entry_count");
  const common = Math.min(left.length, right.length);
  let firstDivergenceIndex: number | undefined;
  for (let i = 0; i < common; i += 1) {
    if (left[i].role !== right[i].role) {
      dimensions.push("role_order");
      firstDivergenceIndex ??= i;
      break;
    }
  }
  for (let i = 0; i < common; i += 1) {
    if (left[i].text !== right[i].text) {
      dimensions.push("text_mismatch");
      firstDivergenceIndex ??= i;
      break;
    }
  }
  const leftMedia = left.reduce((sum, p) => sum + p.mediaCount, 0);
  const rightMedia = right.reduce((sum, p) => sum + p.mediaCount, 0);
  if (leftMedia !== rightMedia) dimensions.push("media_missing");

  return {
    result: dimensions.length === 0 ? "same" : "different",
    dimensions,
    ...(firstDivergenceIndex !== undefined ? { firstDivergenceIndex } : {}),
  };
}
