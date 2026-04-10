/**
 * Heartbeat Agent Tools — create/resolve/list pending goals.
 *
 * These tools are registered into the ToolRegistry and called by the Agent
 * during normal conversations. The Agent decides autonomously when to create goals.
 */

import { z } from "zod";
import { createToolRegistry } from "../tools/registry.js";
import type { ToolSnapshotItem, ToolContent } from "../tools/types.js";
import { getHeartbeatStore } from "../ports/heartbeat-store.js";
import { LIMITS, INITIAL_BACKOFF_MS } from "./types.js";

function textResult(text: string): ToolContent[] {
  return [{ type: "text", text }];
}

// ── Heartbeat context detection ────────────────────────────────────

let _heartbeatContext = false;

export function setHeartbeatContext(active: boolean): void {
  _heartbeatContext = active;
}

export function isHeartbeatContext(): boolean {
  return _heartbeatContext;
}

// ── Context injection (same pattern as scheduler) ──────────────────

interface HeartbeatToolContext {
  accountId: string;
  conversationId: string;
}

let _currentContext: HeartbeatToolContext | null = null;

export function setHeartbeatToolContext(ctx: HeartbeatToolContext | null): void {
  _currentContext = ctx;
}

function getCurrentContext(): HeartbeatToolContext | null {
  return _currentContext;
}

// ── Tool definitions ───────────────────────────────────────────────

const createPendingGoalTool: ToolSnapshotItem = {
  name: "create_pending_goal",
  description:
    "当你发现当前对话中有需要后续跟进的事项时调用。" +
    "比如：工具暂时不可用需要稍后重试、用户说'我一会儿确认'、某个操作需要等待异步结果。" +
    "不要用于用户明确要求的定时任务（那是 scheduler 的职责）。",
  parameters: z.object({
    description: z.string().describe("目标描述（一句话说明要跟进什么）"),
    context: z.string().describe("相关上下文（创建时的背景信息）"),
    delay_minutes: z.number().min(1).max(1440).describe("首次检查延迟分钟数，默认 5").optional(),
    max_checks: z.number().min(1).max(20).describe("最大检查次数，默认 10").optional(),
  }),
  async execute(args) {
    const {
      description,
      context,
      delay_minutes: delayMinutes,
      max_checks: maxChecks,
    } = args as {
      description: string;
      context: string;
      delay_minutes?: number;
      max_checks?: number;
    };

    // Block recursive creation from heartbeat Phase 2
    if (isHeartbeatContext()) {
      return textResult(
        "拒绝：heartbeat 执行中不能创建新的 pending goal。请在结论中说明需要后续跟进的事项。",
      );
    }

    const ctx = getCurrentContext();
    if (!ctx) return textResult("❌ 内部错误：缺少上下文信息");

    const store = getHeartbeatStore();

    // Per-account quota
    const activeCount = await store.countActiveGoals(ctx.accountId);
    if (activeCount >= LIMITS.maxActiveGoalsPerAccount) {
      return textResult(
        `拒绝：当前已有 ${activeCount} 个活跃目标（上限 ${LIMITS.maxActiveGoalsPerAccount}）。请先完成现有目标。`,
      );
    }

    // Dedup: similar description in same conversation
    const existing = await store.findSimilarGoal(ctx.accountId, ctx.conversationId, description);
    if (existing) {
      return textResult(
        `已存在相似目标: ${existing.goalId}（${existing.description}）。不重复创建。`,
      );
    }

    const delayMs = (delayMinutes ?? 5) * 60_000;
    const goal = await store.createGoal({
      accountId: ctx.accountId,
      sourceConversationId: ctx.conversationId,
      description,
      context,
      originType: "conversation",
      delayMs,
      maxChecks: maxChecks ?? LIMITS.defaultMaxChecks,
    });

    return textResult(
      `✅ 已创建待跟进目标\n` +
        `🎯 ${goal.description}\n` +
        `⏰ 首次检查: ${Math.round(delayMs / 60_000)} 分钟后\n` +
        `🔢 ID: ${goal.goalId}`,
    );
  },
};

const resolvePendingGoalTool: ToolSnapshotItem = {
  name: "resolve_pending_goal",
  description: "当你在对话中得知某个待跟进目标已经完成时调用。",
  parameters: z.object({
    goal_id: z.string().describe("目标 ID (UUID)"),
    resolution: z.string().describe("完成说明"),
  }),
  async execute(args) {
    const { goal_id: goalId, resolution } = args as { goal_id: string; resolution: string };

    const store = getHeartbeatStore();
    const goal = await store.getByGoalId(goalId);

    if (!goal) return textResult(`❌ 未找到目标 ${goalId}`);
    if (goal.status === "resolved" || goal.status === "abandoned") {
      return textResult(`目标 ${goalId} 已处于终态: ${goal.status}`);
    }

    await store.updateGoal(goalId, {
      status: "resolved",
      resolution,
      lastCheckAt: new Date(),
      lastCheckResult: `manually resolved: ${resolution}`,
    });

    return textResult(`✅ 目标已标记完成: ${goal.description}`);
  },
};

const listPendingGoalsTool: ToolSnapshotItem = {
  name: "list_pending_goals",
  description: "列出当前账号的所有活跃待跟进目标。",
  parameters: z.object({}),
  async execute() {
    const ctx = getCurrentContext();
    if (!ctx) return textResult("❌ 内部错误：缺少上下文信息");

    const store = getHeartbeatStore();
    const goals = await store.listGoals(ctx.accountId, false);

    if (goals.length === 0) return textResult("当前没有活跃的待跟进目标。");

    const lines = goals.map((g) => {
      const statusEmoji: Record<string, string> = {
        pending: "⏳",
        checking: "🔄",
        waiting_user: "💬",
      };
      return (
        `${statusEmoji[g.status] ?? "❓"} [${g.status}] ${g.description}\n` +
        `   ID: ${g.goalId} | 已检查 ${g.checkCount}/${g.maxChecks} 次` +
        (g.lastCheckResult ? ` | 上次: ${g.lastCheckResult.slice(0, 60)}` : "")
      );
    });

    return textResult(`📋 活跃目标 (${goals.length}):\n\n${lines.join("\n\n")}`);
  },
};

// ── Registry ───────────────────────────────────────────────────────

export const heartbeatToolRegistry = createToolRegistry();

const tools: ToolSnapshotItem[] = [
  createPendingGoalTool,
  resolvePendingGoalTool,
  listPendingGoalsTool,
];

heartbeatToolRegistry.swap({ tools });
