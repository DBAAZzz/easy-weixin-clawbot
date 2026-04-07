/**
 * Memory extractor — uses LLM to extract structured memories from conversation turns.
 *
 * Runs asynchronously after response delivery (fire-and-forget) to avoid
 * blocking the user-facing response path.
 */

import { complete, type Model } from "@mariozechner/pi-ai";
import { withSpan } from "@clawbot/observability";
import { queueRecordEntry } from "./queue.js";
import type { RecordParams, Fragment } from "./types.js";

const EXTRACTION_PROMPT = `你是一个记忆提取器。分析下面的对话轮次，提取值得长期记住的结构化信息。

## 提取规则

只提取**明确的、有价值的**信息，不要猜测或推断。跳过以下内容：
- 临时性的问答（"今天天气怎么样"）
- 纯粹的任务执行细节（"帮我翻译这段话"的具体内容）
- Agent 自己的输出内容

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

如果没有值得提取的信息，返回空数组 \`[]\`。

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
 * Extract memories from a conversation turn using LLM.
 * Returns parsed memories or empty array on failure.
 */
async function callExtractor(
  model: Model<any>,
  turn: ConversationTurn,
  apiKey?: string,
): Promise<ExtractedMemory[]> {
  const turnText = `用户: ${turn.userText}\n\n助手: ${turn.assistantText}`;

  const result = await complete(
    model,
    {
      systemPrompt: EXTRACTION_PROMPT,
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
        const memories = await callExtractor(model, turn, apiKey);

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
