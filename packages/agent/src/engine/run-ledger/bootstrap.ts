import type { CompiledContextV1 } from "../../context-compiler/types.js";
import {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID_V2,
  CONTEXT_TIMEZONE,
} from "../../context-compiler/types.js";
import {
  buildCanonicalRequestDocument,
  buildContextManifestDocument,
} from "../../context-compiler/manifest.js";
import { ARTIFACT_KIND } from "../../shared/fact-ledger/contracts.js";
import { createManifestId } from "./ids.js";
import type { RunLedgerRecorder } from "./recorder.js";

/**
 * Manifest bootstrap (Phase 4 design §9): compile → pin revisions →
 * round-1 canonical request → CONTEXT_MANIFEST artifact → context_compiled.
 * Everything runs through the recorder's serialized queue; any failure
 * degrades the run and returns `ready: false`.
 */

export interface RoundRequestInputV1 {
  round: number;
  system: string;
  /** Post-trim model-visible messages, already serialized for the document. */
  messages: unknown[];
  tools: ReadonlyArray<{ name: string; description: string; parameters: unknown }>;
  trim: {
    trimLevel: number;
    originalTokens: number;
    trimmedTokens: number;
    droppedMessages: number;
    fixedOverheadTokens: number;
  };
}

export interface BootstrapRunLedgerInput {
  recorder: RunLedgerRecorder;
  compileContext: () => Promise<CompiledContextV1>;
  /** Round-1 request, serialized exactly as the runner will send it (design §9.3). */
  round1Request: RoundRequestInputV1;
  prompt: { key: string; body: string };
  skills: ReadonlyArray<{ name: string; version?: string; body: string }>;
  tools: ReadonlyArray<{
    name: string;
    description: string;
    parameters: unknown;
    handler?: string;
  }>;
  model: {
    modelId: string;
    purpose: string;
    contextWindow: number;
    maxOutputTokens: number;
    supportsImageInput?: boolean;
    requiresReasonedToolHistory?: boolean;
  };
  effectiveTime: string;
}

export interface RunLedgerBootstrapResult {
  ready: boolean;
  manifestId?: string;
  round1RequestArtifactId?: string;
  modelRevisionId?: string;
  toolRevisionIds: Map<string, string>;
}

export async function bootstrapRunLedger(
  input: BootstrapRunLedgerInput,
): Promise<RunLedgerBootstrapResult> {
  const { recorder } = input;
  const toolRevisionIds = new Map<string, string>();

  const compiled = await recorder.enqueueWrite(() => input.compileContext());
  if (!compiled || recorder.isDegraded()) return { ready: false, toolRevisionIds };

  const revisions = await recorder.enqueueWrite(async () => {
    const prompt = await recorder.putArtifact(ARTIFACT_KIND.PROMPT_REVISION, {
      key: input.prompt.key,
      body: input.prompt.body,
    });
    if (!prompt) return undefined;
    const skillRevisionIds: string[] = [];
    for (const skill of input.skills) {
      const artifact = await recorder.putArtifact(ARTIFACT_KIND.SKILL_REVISION, {
        name: skill.name,
        ...(skill.version === undefined ? {} : { version: skill.version }),
        body: skill.body,
      });
      if (!artifact) return undefined;
      skillRevisionIds.push(artifact.artifactId);
    }
    for (const tool of input.tools) {
      const artifact = await recorder.putArtifact(ARTIFACT_KIND.TOOL_REVISION, {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        ...(tool.handler === undefined ? {} : { handler: tool.handler }),
      });
      if (!artifact) return undefined;
      toolRevisionIds.set(tool.name, artifact.artifactId);
    }
    const model = await recorder.putArtifact(ARTIFACT_KIND.MODEL_CONFIG_REVISION, {
      modelId: input.model.modelId,
      purpose: input.model.purpose,
      contextWindow: input.model.contextWindow,
      maxOutputTokens: input.model.maxOutputTokens,
      ...(input.model.supportsImageInput === undefined
        ? {}
        : { supportsImageInput: input.model.supportsImageInput }),
      ...(input.model.requiresReasonedToolHistory === undefined
        ? {}
        : { requiresReasonedToolHistory: input.model.requiresReasonedToolHistory }),
    });
    if (!model) return undefined;
    return {
      promptRevisionId: prompt.artifactId,
      skillRevisionIds,
      modelRevisionId: model.artifactId,
    };
  });
  if (!revisions || recorder.isDegraded()) return { ready: false, toolRevisionIds };

  const manifestId = createManifestId(recorder.accountId, recorder.runId);
  const round1 = await recorder.enqueueWrite(async () => {
    const requestDoc = buildCanonicalRequestDocument({
      runId: recorder.runId,
      round: 1,
      modelRevisionId: revisions.modelRevisionId,
      system: input.round1Request.system,
      messages: input.round1Request.messages,
      tools: input.round1Request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      })),
      trim: input.round1Request.trim,
    });
    const requestArtifact = await recorder.putArtifact(
      ARTIFACT_KIND.CANONICAL_REQUEST,
      requestDoc,
    );
    if (!requestArtifact) return undefined;
    const manifest = buildContextManifestDocument({
      accountId: recorder.accountId,
      runId: recorder.runId,
      manifestId,
      compilerVersion: CONTEXT_COMPILER_VERSION,
      contextPolicyRevisionId: CONTEXT_POLICY_REVISION_ID_V2,
      conversationEventIds: compiled.conversationEventIds,
      runEventIds: compiled.runEntrySourceIds ?? [],
      modelRevisionId: revisions.modelRevisionId,
      promptRevisionId: revisions.promptRevisionId,
      skillRevisionIds: revisions.skillRevisionIds,
      toolRevisionIds: [...toolRevisionIds.values()],
      effectiveTime: input.effectiveTime,
      timezone: CONTEXT_TIMEZONE,
      trimDecision: input.round1Request.trim,
      canonicalRequestHash: requestArtifact.sha256,
    });
    const manifestArtifact = await recorder.putArtifact(
      ARTIFACT_KIND.CONTEXT_MANIFEST,
      manifest,
      { artifactId: manifestId },
    );
    if (!manifestArtifact) return undefined;
    return { manifestId, round1RequestArtifactId: requestArtifact.artifactId };
  });
  if (!round1 || recorder.isDegraded()) return { ready: false, toolRevisionIds };

  // recordContextCompiled is itself an inline queue task; calling it inside
  // enqueueWrite would deadlock (nested queue). The FIFO order still places it
  // after the manifest put above.
  const contextCompiledOk = await recorder.recordContextCompiled(round1.manifestId);
  if (!contextCompiledOk || recorder.isDegraded()) return { ready: false, toolRevisionIds };

  return {
    ready: true,
    manifestId: round1.manifestId,
    round1RequestArtifactId: round1.round1RequestArtifactId,
    modelRevisionId: revisions.modelRevisionId,
    toolRevisionIds,
  };
}
