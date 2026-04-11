/**
 * Memory extractor — uses LLM to extract structured memories from conversation turns.
 *
 * Runs asynchronously after response delivery (fire-and-forget) to avoid
 * blocking the user-facing response path.
 */

import {
  extractJsonMiddleware,
  generateText,
  NoOutputGeneratedError,
  Output,
  type LanguageModel,
  wrapLanguageModel,
} from "ai";
import { withSpan } from "@clawbot/observability";
import { z } from "zod";
import { recall } from "./service.js";
import { queueRecordEntry } from "./queue.js";
import type { RecordParams, Fragment, TapeState } from "./types.js";
import { getPromptAssets } from "../prompts/port.js";
import { renderTemplate } from "../prompts/assembler.js";
import { PROMPT_PROFILES } from "../prompts/profiles.js";

interface ConversationTurn {
  userText: string;
  assistantText: string;
}

interface ExtractedMemory {
  category: "fact" | "preference" | "decision";
  scope: "global" | "session";
  key: string;
  value: unknown;
  confidence: number;
}

const extractedMemorySchema = z.object({
  category: z.enum(["fact", "preference", "decision"]),
  scope: z.enum(["global", "session"]),
  key: z.string().trim().min(1),
  value: z.unknown(),
  confidence: z.number().min(0).max(1).default(1),
});

const extractorOutputSchema = z.object({
  memories: z.array(extractedMemorySchema).default([]),
});

/**
 * Format existing memory keys for injection into the extraction prompt.
 * This prevents the LLM from re-extracting information that's already stored.
 */
function formatExistingKeys(globalState: TapeState, sessionState: TapeState): string {
  const lines: string[] = [];

  for (const [key, fact] of globalState.facts) {
    lines.push(`- [global/fact] ${key}: ${JSON.stringify(fact.value)}`);
  }
  for (const [key, pref] of globalState.preferences) {
    lines.push(`- [global/preference] ${key}: ${JSON.stringify(pref.value)}`);
  }
  for (const [key, fact] of sessionState.facts) {
    lines.push(`- [session/fact] ${key}: ${JSON.stringify(fact.value)}`);
  }
  for (const [key, pref] of sessionState.preferences) {
    lines.push(`- [session/preference] ${key}: ${JSON.stringify(pref.value)}`);
  }

  return lines.length > 0 ? lines.join("\n") : "(暂无已有记忆)";
}

/**
 * Extract memories from a conversation turn using LLM.
 * Returns parsed memories or empty array on failure.
 */
async function callExtractor(
  model: LanguageModel,
  turn: ConversationTurn,
  existingKeys: string,
  _apiKey?: string,
): Promise<ExtractedMemory[]> {
  const turnText = `用户: ${turn.userText}\n\n助手: ${turn.assistantText}`;
  const assets = getPromptAssets();
  const template = assets.get(PROMPT_PROFILES.memory_extract.systemPromptKey);
  const prompt = renderTemplate(template, { EXISTING_KEYS: existingKeys }, { strict: true });

  try {
    const result = await generateText({
      model: wrapLanguageModel({
        model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
        middleware: extractJsonMiddleware(),
      }),
      system: prompt,
      messages: [
        {
          role: "user" as const,
          content: turnText,
        },
      ],
      output: Output.object({
        schema: extractorOutputSchema,
      }),
    });

    return result.output.memories;
  } catch (error) {
    if (NoOutputGeneratedError.isInstance(error)) {
      return [];
    }
    throw error;
  }
}

/**
 * Convert extracted memories to RecordParams grouped by branch.
 */
function toRecordParams(
  memories: ExtractedMemory[],
  actor: string,
): Array<{ scope: "global" | "session"; params: RecordParams }> {
  return memories.map((mem) => {
    const fragment: Fragment = {
      kind: "text",
      data: {
        key: mem.key,
        value: mem.value,
        ...(mem.category === "fact" ? { confidence: mem.confidence ?? 1 } : {}),
        ...(mem.category === "decision"
          ? { description: mem.value, context: mem.key }
          : {}),
      },
    };

    return {
      scope: mem.scope,
      params: {
        category: mem.category,
        actor,
        source: "chat",
        payload: { fragments: [fragment] },
      },
    };
  });
}

/**
 * Run memory extraction and queue writes. Fire-and-forget — errors are logged, not thrown.
 *
 * @param model - LLM model to use for extraction
 * @param accountId - Account ID
 * @param sessionBranch - Session conversation ID (branch)
 * @param turn - The conversation turn to extract from
 * @param actor - Actor identifier (e.g. "agent:claude-sonnet-4-20250514")
 * @param apiKey - Optional API key
 */
export function fireExtractAndRecord(
  model: LanguageModel,
  accountId: string,
  sessionBranch: string,
  turn: ConversationTurn,
  actor: string,
  apiKey?: string,
): void {
  // Skip extraction for very short turns (unlikely to contain memorable info)
  if (turn.userText.length < 5 && turn.assistantText.length < 20) return;

  void withSpan(
    "tape.extract",
    { accountId, branch: sessionBranch },
    async (span) => {
      try {
        // Load existing memory state to avoid duplicate extraction
        const [globalState, sessionState] = await Promise.all([
          recall(accountId, "__global__").catch(() => ({ facts: new Map(), preferences: new Map(), decisions: [], version: 0 } as TapeState)),
          recall(accountId, sessionBranch).catch(() => ({ facts: new Map(), preferences: new Map(), decisions: [], version: 0 } as TapeState)),
        ]);
        const existingKeys = formatExistingKeys(globalState, sessionState);

        const memories = await callExtractor(model, turn, existingKeys, apiKey);

        span.addAttributes({
          extractedCount: memories.length,
          categories: [...new Set(memories.map((m) => m.category))].join(","),
        });

        if (memories.length === 0) return;

        const records = toRecordParams(memories, actor);

        for (const { scope, params } of records) {
          const branch = scope === "global" ? "__global__" : sessionBranch;
          queueRecordEntry(accountId, branch, params);
        }

        console.log(
          `[tape] extracted ${memories.length} memories ` +
            `(${records.filter((r) => r.scope === "global").length} global, ` +
            `${records.filter((r) => r.scope === "session").length} session)`,
        );
      } catch (err) {
        console.error(`[tape] extract error (${accountId}/${sessionBranch}):`, err);
      }
    },
  ).catch((err) => {
    console.error(`[tape] extract span error (${accountId}/${sessionBranch}):`, err);
  });
}
