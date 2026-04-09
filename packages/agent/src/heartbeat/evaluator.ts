/**
 * Heartbeat Evaluator — two-phase goal evaluation.
 *
 * Phase 1: reasonInternal() → lightweight structured verdict (act/wait/resolve/abandon)
 * Phase 2: HeartbeatExecutorPort → full chat() in the original conversation (only on verdict=act)
 */

import { reasonInternal } from "./reason-internal.js";
import { getHeartbeatStore } from "../ports/heartbeat-store.js";
import { getHeartbeatExecutor } from "../ports/heartbeat-executor.js";
import { getMessageStore } from "../ports/message-store.js";
import {
  type GoalTransition,
  type PendingGoalRow,
  type Verdict,
  LIMITS,
  nextBackoff,
} from "./types.js";

// ── Eval system prompt ─────────────────────────────────────────────

const EVAL_SYSTEM_PROMPT = `你是一个内部状态检查器，不是对话助手。
你只输出一个 JSON 对象，不输出其他任何内容。

JSON 格式（严格遵守）：
{"verdict":"act|wait|resolve|abandon","reason":"一句话"}

verdict 含义：
- act: 需要立即行动（调用工具、与用户交互）
- wait: 还不到时候，继续等
- resolve: 目标已达成
- abandon: 目标不再有意义

只输出 JSON。`;

// ── Verdict parsing ────────────────────────────────────────────────

const VALID_VERDICTS = new Set<Verdict>(["act", "wait", "resolve", "abandon"]);

function isValidVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && VALID_VERDICTS.has(v as Verdict);
}

export function parseEvalResult(text: string): { verdict: Verdict; reason: string } {
  // 1. Try direct JSON.parse
  try {
    const parsed = JSON.parse(text.trim());
    if (isValidVerdict(parsed.verdict)) return parsed;
  } catch {}

  // 2. Try extracting from markdown code block
  const jsonMatch = text.match(/\{[\s\S]*?\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (isValidVerdict(parsed.verdict)) return parsed;
    } catch {}
  }

  // 3. Keyword fallback (logged, not silent)
  if (/完成|达成|resolved/i.test(text)) return { verdict: "resolve", reason: "keyword match" };
  if (/放弃|没有意义|abandon/i.test(text)) return { verdict: "abandon", reason: "keyword match" };
  if (/执行|行动|需要|act/i.test(text)) return { verdict: "act", reason: "keyword match" };

  // 4. Default wait + warning
  console.warn(`[heartbeat] eval parse failed, defaulting to wait. raw: ${text.slice(0, 200)}`);
  return { verdict: "wait", reason: "parse_failed" };
}

// ── Recent context reader ──────────────────────────────────────────

async function getRecentContextSince(
  accountId: string,
  conversationId: string,
  sinceSeq: number,
  maxMessages = 10,
): Promise<string> {
  const messageStore = getMessageStore();
  const recent = await messageStore.getMessagesSince(accountId, conversationId, sinceSeq, maxMessages);

  if (recent.length === 0) return "";

  return recent
    .map((msg) => {
      if (msg.role === "user") return `用户: ${msg.textContent}`;
      if (msg.role === "assistant") return `助手: ${msg.textContent}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

// ── Phase 1: lightweight evaluation ────────────────────────────────

async function phase1Evaluate(
  goal: PendingGoalRow,
  recentContext: string,
): Promise<{ verdict: Verdict; reason: string; usage: { input: number; output: number } }> {
  const userPrompt = `## 目标
${goal.description}

## 上下文
${goal.context}

## 当前状态
- 来源: ${goal.originType}
- 已检查 ${goal.checkCount} 次（上限 ${goal.maxChecks}）
- 上次检查结果: ${goal.lastCheckResult ?? "无"}
- 创建时间: ${goal.createdAt.toISOString()}
${goal.resumeSignal ? `- 恢复信号: ${goal.resumeSignal}` : ""}

请判断此目标现在是否需要采取行动。`;

  const result = await reasonInternal({
    accountId: goal.accountId,
    sourceConversationId: goal.sourceConversationId,
    systemPrompt: EVAL_SYSTEM_PROMPT,
    userPrompt,
    recentContext: recentContext || undefined,
  });

  const { verdict, reason } = parseEvalResult(result.text);
  return { verdict, reason, usage: result.usage };
}

// ── Core evaluator ─────────────────────────────────────────────────

export async function evaluateGoal(goal: PendingGoalRow): Promise<GoalTransition> {
  const store = getHeartbeatStore();
  const now = new Date();

  // Mark as checking
  await store.updateGoal(goal.goalId, { status: "checking" });

  try {
    // Token budget check
    const totalTokens = goal.totalInputTokens + goal.totalOutputTokens;
    if (totalTokens > LIMITS.maxTokensPerGoal) {
      return {
        goalId: goal.goalId,
        newStatus: "abandoned",
        updates: {
          status: "abandoned",
          lastCheckAt: now,
          lastCheckResult: "token budget exceeded",
          resolution: `abandoned: token budget exceeded (${totalTokens} tokens used)`,
          checkCount: goal.checkCount + 1,
        },
      };
    }

    // Read incremental context from source conversation
    const recentContext = goal.latestSourceMessageSeq
      ? await getRecentContextSince(
          goal.accountId,
          goal.sourceConversationId,
          goal.latestSourceMessageSeq,
        ).catch(() => "")
      : "";

    // ── Phase 1: lightweight evaluation ──
    const { verdict, reason, usage } = await phase1Evaluate(goal, recentContext);

    const tokenUpdates = {
      totalInputTokens: goal.totalInputTokens + usage.input,
      totalOutputTokens: goal.totalOutputTokens + usage.output,
    };

    if (verdict === "resolve") {
      return {
        goalId: goal.goalId,
        newStatus: "resolved",
        updates: {
          status: "resolved",
          lastCheckAt: now,
          lastCheckResult: reason,
          resolution: reason,
          checkCount: goal.checkCount + 1,
          resumeSignal: null,
          ...tokenUpdates,
        },
        requestPush: {
          accountId: goal.accountId,
          conversationId: goal.sourceConversationId,
          text: `✅ 待办完成：${goal.description}\n\n${reason}`,
        },
      };
    }

    if (verdict === "abandon" || goal.checkCount + 1 >= goal.maxChecks) {
      const abandonReason =
        goal.checkCount + 1 >= goal.maxChecks
          ? `max checks reached (${goal.maxChecks})`
          : reason;
      return {
        goalId: goal.goalId,
        newStatus: "abandoned",
        updates: {
          status: "abandoned",
          lastCheckAt: now,
          lastCheckResult: abandonReason,
          resolution: `abandoned: ${abandonReason}`,
          checkCount: goal.checkCount + 1,
          resumeSignal: null,
          ...tokenUpdates,
        },
      };
    }

    if (verdict === "wait") {
      const newBackoff = nextBackoff(goal.backoffMs);
      return {
        goalId: goal.goalId,
        newStatus: "pending",
        updates: {
          status: "pending",
          lastCheckAt: now,
          lastCheckResult: reason,
          checkCount: goal.checkCount + 1,
          backoffMs: newBackoff,
          nextCheckAt: new Date(now.getTime() + newBackoff),
          resumeSignal: null,
          ...tokenUpdates,
        },
      };
    }

    // ── Phase 2: verdict === "act" → full execution ──
    const executor = getHeartbeatExecutor();

    const phase2Prompt =
      `[执行上下文: heartbeat/phase2, 目标: ${goal.goalId}]\n` +
      `[限制: 本次执行中不能创建新的 pending goal]\n\n` +
      `你正在推进一个待完成的目标：\n\n` +
      `## 目标\n${goal.description}\n\n` +
      `## 上下文\n${goal.context}\n\n` +
      `## 评估结论\n${reason}\n\n` +
      (recentContext ? `## 近期对话\n${recentContext}\n\n` : "") +
      `请尽你所能推进这个目标。完成后在回复中正常总结即可。` +
      `如果你需要用户确认某些信息才能继续，请明确说明需要什么。`;

    const execResult = await executor.execute({
      accountId: goal.accountId,
      conversationId: goal.sourceConversationId,
      prompt: phase2Prompt,
    });

    if (execResult.status === "error") {
      const newBackoff = nextBackoff(goal.backoffMs);
      return {
        goalId: goal.goalId,
        newStatus: "pending",
        updates: {
          status: "pending",
          lastCheckAt: now,
          lastCheckResult: `phase2 error: ${execResult.error}`,
          checkCount: goal.checkCount + 1,
          backoffMs: newBackoff,
          nextCheckAt: new Date(now.getTime() + newBackoff),
          resumeSignal: null,
          ...tokenUpdates,
        },
      };
    }

    // Analyze Phase 2 result to determine next state
    const resultText = execResult.text ?? "";
    const needsUser =
      /需要.*确认|请.*回复|等待.*输入|请告诉我|请提供/.test(resultText);

    if (needsUser) {
      return {
        goalId: goal.goalId,
        newStatus: "waiting_user",
        updates: {
          status: "waiting_user",
          lastCheckAt: now,
          lastCheckResult: resultText.slice(0, 500),
          checkCount: goal.checkCount + 1,
          resumeSignal: null,
          ...tokenUpdates,
        },
      };
    }

    // Phase 2 completed an action — defer to next check to see if goal is done
    const newBackoff = nextBackoff(goal.backoffMs);
    return {
      goalId: goal.goalId,
      newStatus: "pending",
      updates: {
        status: "pending",
        lastCheckAt: now,
        lastCheckResult: resultText.slice(0, 500),
        checkCount: goal.checkCount + 1,
        backoffMs: newBackoff,
        nextCheckAt: new Date(now.getTime() + newBackoff),
        resumeSignal: null,
        ...tokenUpdates,
      },
    };
  } catch (err) {
    // Exception → back to pending with backoff
    const newBackoff = nextBackoff(goal.backoffMs);
    return {
      goalId: goal.goalId,
      newStatus: "pending",
      updates: {
        status: "pending",
        lastCheckAt: now,
        lastCheckResult: `error: ${(err as Error).message}`,
        checkCount: goal.checkCount + 1,
        backoffMs: newBackoff,
        nextCheckAt: new Date(now.getTime() + newBackoff),
        resumeSignal: null,
      },
    };
  }
}
