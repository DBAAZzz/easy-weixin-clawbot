/**
 * Memory extractor — uses LLM to extract structured memories from conversation turns.
 *
 * Runs asynchronously after response delivery (fire-and-forget) to avoid
 * blocking the user-facing response path.
 */

import { complete, type Model } from "@mariozechner/pi-ai";
import { withSpan } from "@clawbot/observability";
import { recall } from "./service.js";
import { queueRecordEntry } from "./queue.js";
import type { RecordParams, Fragment, TapeState } from "./types.js";

const EXTRACTION_PROMPT = `你是一个记忆提取器。分析下面的对话轮次，提取值得长期记住的结构化信息。

## 提取规则

只提取**明确的、有价值的**信息，不要猜测或推断。跳过以下内容：
- 临时性的问答（"今天天气怎么样"）
- 纯粹的任务执行细节（"帮我翻译这段话"的具体内容）
- Agent 自己的输出内容
- **已经记住的信息**（见下方已有记忆列表）。如果某条信息的 key 和 value 都没有变化，不要重复提取

## 已有记忆

{{EXISTING_KEYS}}

## Key 规范

- **必须复用已有的 key**：如果要更新一条已有记忆的值，使用完全相同的 key
- key 使用简短的中文名词短语，不加"用户"前缀（如用"职业"而非"用户职业"）
- 同一语义只用一个 key（如"职业"和"当前岗位"应统一为"职业"）

## 输出格式

返回一个 JSON 数组，每个元素是一条记忆：

\`\`\`json
[
  {
    "category": "fact" | "preference" | "decision",
    "scope": "global" | "session",
    "key": "简短的唯一标识（中文）",
    "value": "具体内容",
    "confidence": 0.0-1.0
  }
]
\`\`\`

### category 说明
- **fact**: 客观事实（姓名、职业、地点、关系等）
- **preference**: 偏好（饮食、语言风格、工具偏好等）
- **decision**: 重要决策（选择了某方案、确认了某计划等）

### scope 说明
- **global**: 跨会话有效的持久信息（用户身份、长期偏好）
- **session**: 仅当前会话有意义的临时信息（当前任务的决策）

如果没有值得提取的信息（包括所有信息都已记住），返回空数组 \`[]\`。

只输出 JSON，不要其他解释文字。`;

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
  model: Model<any>,
  turn: ConversationTurn,
  existingKeys: string,
  apiKey?: string,
): Promise<ExtractedMemory[]> {
  const turnText = `用户: ${turn.userText}\n\n助手: ${turn.assistantText}`;
  const prompt = EXTRACTION_PROMPT.replace("{{EXISTING_KEYS}}", existingKeys);

  const result = await complete(
    model,
    {
      systemPrompt: prompt,
      messages: [
        {
          role: "user" as const,
          content: [{ type: "text" as const, text: turnText }],
          timestamp: Date.now(),
        },
      ],
      tools: [],
    },
    apiKey ? { apiKey } : {},
  );

  // Parse the response
  const responseText = result.content
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("");

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = responseText.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (m: unknown): m is ExtractedMemory =>
        typeof m === "object" &&
        m !== null &&
        "category" in m &&
        "key" in m &&
        "value" in m &&
        ["fact", "preference", "decision"].includes((m as any).category),
    );
  } catch {
    return [];
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
  model: Model<any>,
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
