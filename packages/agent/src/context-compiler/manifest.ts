import {
  parseContextManifest,
  type ContextManifest,
} from "../shared/fact-ledger/contracts.js";
import { sha256CanonicalJson } from "../shared/fact-ledger/canonical-json.js";

/**
 * Context Manifest / Canonical Request document builders (Phase 4 design §8/§9).
 * Pure functions — the L5 run-ledger layer supplies resolved facts, revision
 * ids and the manifestId, and persists the documents as artifacts.
 */

export interface CanonicalRequestTrimV1 {
  trimLevel: number;
  originalTokens: number;
  trimmedTokens: number;
  droppedMessages: number;
  fixedOverheadTokens: number;
}

/**
 * The exact model-visible input of one call: system prompt, post-trim history
 * (including the Tape-injected user message — the manifest records reality,
 * not the canonical facts), tool descriptors and trim decisions.
 */
export interface CanonicalRequestDocumentV1 {
  schemaVersion: 1;
  runId: string;
  round: number;
  modelRevisionId: string;
  system: string;
  messages: unknown[];
  tools: unknown[];
  trim: CanonicalRequestTrimV1;
}

export function buildCanonicalRequestDocument(input: {
  runId: string;
  round: number;
  modelRevisionId: string;
  system: string;
  messages: unknown[];
  tools: unknown[];
  trim: CanonicalRequestTrimV1;
}): CanonicalRequestDocumentV1 {
  return {
    schemaVersion: 1,
    runId: input.runId,
    round: input.round,
    modelRevisionId: input.modelRevisionId,
    system: input.system,
    messages: input.messages,
    tools: input.tools,
    trim: input.trim,
  };
}

export function hashCanonicalRequestDocument(document: CanonicalRequestDocumentV1): string {
  return sha256CanonicalJson(document);
}

export interface BuildContextManifestInput {
  accountId: string;
  runId: string;
  manifestId: string;
  compilerVersion: string;
  contextPolicyRevisionId: string;
  /** Every conversation event id in the compile window (boundary included). */
  conversationEventIds: string[];
  /** Run event ids whose output became entries of prior terminal runs. */
  runEventIds: string[];
  modelRevisionId: string;
  promptRevisionId: string;
  skillRevisionIds: string[];
  toolRevisionIds: string[];
  effectiveTime: string;
  timezone: string;
  trimDecision: CanonicalRequestTrimV1;
  /** sha256 of the round-1 canonical request document. */
  canonicalRequestHash: string;
}

export function buildContextManifestDocument(
  input: BuildContextManifestInput,
): ContextManifest {
  return parseContextManifest({
    schemaVersion: 1,
    manifestId: input.manifestId,
    compilerVersion: input.compilerVersion,
    contextPolicyRevisionId: input.contextPolicyRevisionId,
    conversationEventIds: [...input.conversationEventIds],
    runEventIds: [...input.runEventIds],
    summaryArtifactIds: [],
    memoryEventWatermark: "unavailable-v1",
    visualObservationIds: [],
    modelRevisionId: input.modelRevisionId,
    promptRevisionId: input.promptRevisionId,
    skillRevisionIds: [...input.skillRevisionIds],
    toolRevisionIds: [...input.toolRevisionIds],
    effectiveTime: input.effectiveTime,
    timezone: input.timezone,
    trimDecision: { ...input.trimDecision },
    canonicalRequestHash: input.canonicalRequestHash,
  });
}
