/**
 * Canonical context build (Phase 6 design §7.3/§8.2) — reconstructs the
 * model-visible `AgentMessage[]` from a policy-v3 canonical compile.
 *
 * Memory injection stays out of this module by design (§1.7): Tape recall
 * remains the runtime memory projection, so the caller assembles the current
 * user message exactly as the legacy path does. Only *history* is rebuilt here.
 */

import type { ArtifactRevisionStore } from "../../ports/artifact-revision-store.js";
import type { ArtifactContentSink } from "../../ports/artifact-content-sink.js";
import { ARTIFACT_KIND } from "../../shared/fact-ledger/contracts.js";
import type {
  AgentMessage,
  ImageContent,
  TextContent,
  ToolCallContent,
} from "../../llm/types.js";
import { MESSAGE_CONTENT_TYPE, MESSAGE_ROLE } from "@clawbot/shared";
import type {
  CanonicalConversationEntryV1,
  CompiledContextV1,
} from "../../context-compiler/types.js";

export interface CanonicalHistoryBuildDeps {
  accountId: string;
  /** Policy-v3 compile closure (run-ledger wiring, design §8.2). */
  compileContext: (hints: {
    coverageHints?: { memoryFacts?: boolean; immutableMediaArtifacts?: boolean };
  }) => Promise<CompiledContextV1>;
  artifactRevisionStore?: ArtifactRevisionStore;
  /** Reads back MEDIA_ASSET bytes for vision replay; absent → media unresolved → placeholders. */
  contentSink?: ArtifactContentSink;
  /** 当前 chat 模型的视觉能力——媒体重放按当前能力决定，与历史当时无关（§7.3）。 */
  supportsImageInput: boolean;
  /** Per-turn media replay cap (§20.2); beyond this, entries fall back to placeholders. */
  mediaReplayLimit?: number;
}

export interface CanonicalHistoryBuild {
  messages: AgentMessage[];
  compiled: CompiledContextV1;
}

export const DEFAULT_MEDIA_REPLAY_LIMIT = 8;

const IMAGE_PLACEHOLDER_TEXT = "[图片消息：媒体内容未重放]";

export class CanonicalContextBuildError extends Error {
  override readonly name = "CanonicalContextBuildError";
  constructor(
    public readonly code:
      | "compile_failed"
      | "media_failed"
      | "build_failed",
    cause: unknown,
  ) {
    super(`canonical context build failed: ${code}`);
    this.cause = cause;
  }
}

function parseToolArguments(serialized: string | undefined): Record<string, unknown> {
  if (serialized === undefined) return {};
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return {};
  }
}

/**
 * Replay one resolved image attachment: MEDIA_ASSET bytes read through the
 * sink → base64 ImageContent. Returns undefined when the artifact cannot be
 * loaded (caller degrades to a placeholder).
 */
async function replayImageAttachment(
  deps: CanonicalHistoryBuildDeps,
  entry: CanonicalConversationEntryV1,
  sourceRef: string,
): Promise<{ data: string; mimeType: string } | undefined> {
  if (!deps.artifactRevisionStore || !deps.contentSink) return undefined;
  const resolution = entry.attachments.find(
    (attachment) =>
      attachment.sourceRef === sourceRef && attachment.resolution.status === "resolved",
  );
  if (!resolution || resolution.resolution.status !== "resolved") return undefined;
  if (resolution.resolution.mimeType && !resolution.resolution.mimeType.startsWith("image/")) {
    return undefined;
  }
  try {
    const artifact = await deps.artifactRevisionStore.getById(resolution.resolution.artifactId);
    if (!artifact || artifact.kind !== ARTIFACT_KIND.MEDIA_ASSET) return undefined;
    if (artifact.storageRef === undefined) return undefined;
    const bytes = await deps.contentSink.get(artifact.storageRef.key);
    if (bytes === null) return undefined;
    return {
      data: Buffer.from(bytes).toString("base64"),
      mimeType: resolution.resolution.mimeType ?? "image/jpeg",
    };
  } catch {
    return undefined;
  }
}

async function buildUserEntryMessage(
  deps: CanonicalHistoryBuildDeps,
  entry: CanonicalConversationEntryV1,
  mediaBudget: { remaining: number },
): Promise<AgentMessage> {
  const content: (TextContent | ImageContent)[] = [];
  if (entry.text) {
    content.push({ type: MESSAGE_CONTENT_TYPE.TEXT, text: entry.text });
  }
  for (const attachment of entry.attachments) {
    const placeholder = { type: MESSAGE_CONTENT_TYPE.TEXT, text: IMAGE_PLACEHOLDER_TEXT } as const;
    if (!deps.supportsImageInput || mediaBudget.remaining <= 0) {
      content.push({ ...placeholder });
      continue;
    }
    const replayed = await replayImageAttachment(deps, entry, attachment.sourceRef);
    if (replayed === undefined) {
      content.push({ ...placeholder });
      continue;
    }
    mediaBudget.remaining -= 1;
    content.push({
      type: MESSAGE_CONTENT_TYPE.IMAGE,
      data: replayed.data,
      mimeType: replayed.mimeType,
    });
  }
  if (content.length === 0) content.push({ type: MESSAGE_CONTENT_TYPE.TEXT, text: "" });
  return {
    role: MESSAGE_ROLE.USER,
    content,
    timestamp: Date.parse(entry.occurredAt),
  };
}

/**
 * Reconstruct the model-visible history from canonical entries (§7.3 mapping).
 *
 * Tool-call pairing: within one run, an assistant entry immediately followed by
 * tool entries of the same run is re-expanded into an assistant message with
 * `tool_call` blocks (v3 carries callId/toolName/toolArguments/toolError) plus
 * the matching TOOL_RESULT messages, so provider tool history stays valid.
 */
export async function buildCanonicalHistory(
  deps: CanonicalHistoryBuildDeps,
  coverageHints?: { memoryFacts?: boolean; immutableMediaArtifacts?: boolean },
): Promise<CanonicalHistoryBuild> {
  let compiled: CompiledContextV1;
  try {
    compiled = await deps.compileContext(coverageHints ? { coverageHints } : {});
  } catch (error) {
    throw new CanonicalContextBuildError("compile_failed", error);
  }

  const mediaBudget = { remaining: deps.mediaReplayLimit ?? DEFAULT_MEDIA_REPLAY_LIMIT };
  const messages: AgentMessage[] = [];
  const entries = compiled.context.entries;

  let index = 0;
  while (index < entries.length) {
    const entry = entries[index];
    if (entry.role === "user") {
      try {
        messages.push(await buildUserEntryMessage(deps, entry, mediaBudget));
      } catch (error) {
        throw new CanonicalContextBuildError("media_failed", error);
      }
      index += 1;
      continue;
    }

    if (entry.role === "trigger") {
      // Trigger entries come from heartbeat pulses (scheduler prompts are
      // recorded as user turns), so the "pulse" meta is the faithful cause.
      messages.push({
        role: MESSAGE_ROLE.TRIGGER,
        content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: entry.text }],
        timestamp: Date.parse(entry.occurredAt),
        meta: { kind: "pulse" },
      });
      index += 1;
      continue;
    }

    if (entry.role === "assistant") {
      const content: (TextContent | ToolCallContent)[] = [];
      if (entry.text) {
        content.push({ type: MESSAGE_CONTENT_TYPE.TEXT, text: entry.text });
      }
      const toolEntries: CanonicalConversationEntryV1[] = [];
      let cursor = index + 1;
      while (
        cursor < entries.length &&
        entries[cursor].role === "tool" &&
        entries[cursor].runId === entry.runId
      ) {
        toolEntries.push(entries[cursor]);
        cursor += 1;
      }
      for (const tool of toolEntries) {
        if (tool.callId === undefined || tool.toolName === undefined) continue;
        content.push({
          type: MESSAGE_CONTENT_TYPE.TOOL_CALL,
          id: tool.callId,
          name: tool.toolName,
          arguments: parseToolArguments(tool.toolArguments),
        });
      }
      messages.push({
        role: MESSAGE_ROLE.ASSISTANT,
        content,
        timestamp: Date.parse(entry.occurredAt),
      });
      for (const tool of toolEntries) {
        messages.push({
          role: MESSAGE_ROLE.TOOL_RESULT,
          toolCallId: tool.callId ?? tool.eventId,
          toolName: tool.toolName ?? "unknown",
          content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: tool.text }],
          isError: tool.toolError ?? false,
          timestamp: Date.parse(tool.occurredAt),
        });
      }
      index = cursor;
      continue;
    }

    // Standalone tool entry without a preceding assistant of the same run
    // (defensive; the reducer always pairs them).
    messages.push({
      role: MESSAGE_ROLE.TOOL_RESULT,
      toolCallId: entry.callId ?? entry.eventId,
      toolName: entry.toolName ?? "unknown",
      content: [{ type: MESSAGE_CONTENT_TYPE.TEXT, text: entry.text }],
      isError: entry.toolError ?? false,
      timestamp: Date.parse(entry.occurredAt),
    });
    index += 1;
  }

  return { messages, compiled };
}
