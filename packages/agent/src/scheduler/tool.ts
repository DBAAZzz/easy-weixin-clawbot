import { z } from "zod";
import { createToolRegistry } from "../tools/registry.js";
import type { ToolSnapshotItem } from "../tools/types.js";
import { defineTool, textResult } from "../tools/define-tool.js";
import { requireAgentToolContext } from "../runtime/agent-tool-context.js";
import { validate } from "node-cron";
import { getSchedulerStore } from "../ports/scheduler-store.js";
import { activate, deactivate } from "./manager.js";
import { executeTask } from "./executor.js";
import { createLogger } from "@clawbot/observability";

const logger = createLogger({ component: "scheduler.tool" });

// Conservative minimum-interval guard for AI-generated cron expressions.
//
// The model may produce cron patterns that fire more frequently than the
// 30-minute minimum.  This is *not* a full cron parser — it rejects these
// common high-frequency patterns:
//
//  • Bare wildcard ("*") in the minute field (fires every minute)
//  • Step < 30 patterns like "*/5" in the minute field
//  • Range  ("0-5")  — can fire every minute
//  • Range + step syntax like "0-59/1" — can fire every minute
//  • Comma-separated minutes with inter-minute gap < 30
//
// Legitimate patterns like "*/30" or "*/45" are allowed.
// Expressions that fall through to `true` are already validated by
// `node-cron`'s `validate()` call, so blatantly malformed strings are
// caught upstream.
function validateMinInterval(cronExpr: string): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  if (parts.length > 5) return false;

  const minutePart = parts[0];

  // Bare wildcard → fires every minute
  if (minutePart === "*") return false;

  // Step syntax: "*/N" or "A-B/N"
  const stepMatch = minutePart.match(/^(?:\*|\d+-\d+)\/(\d+)$/);
  if (stepMatch) {
    if (Number.parseInt(stepMatch[1], 10) < 30) return false;
    return true; // step >= 30 → safe
  }

  // Range syntax: "A-B" or "A-B/N" (the latter caught above)
  if (/^\d+-\d+$/.test(minutePart) || /^\d+-\d+\/\d+$/.test(minutePart)) return false;

  // Comma-separated discrete minutes: reject if any相邻gap < 30
  if (minutePart.includes(",")) {
    const minutes = minutePart.split(",").map(Number).sort((a, b) => a - b);
    for (let i = 1; i < minutes.length; i++) {
      if (minutes[i] - minutes[i - 1] < 30) return false;
    }
  }

  return true;
}

// ── Tool definitions ───────────────────────────────────────────────

const createScheduledTaskTool = defineTool({
  name: "create_scheduled_task",
  description:
    "创建一个定时任务。到时间后自动执行 AI Prompt 并将结果推送到当前会话。" +
    "需要将用户的自然语言需求转换为 cron 表达式和明确的 prompt。" +
    "支持两种类型：once（单次执行后自动停止）和 recurring（按 cron 重复执行）。" +
    "最小执行间隔为 30 分钟。",
  parameters: z.object({
    name: z.string().describe("任务名称（简短描述，如「科技新闻摘要」）"),
    type: z.enum(["once", "recurring"]).describe("任务类型：once（单次执行）或 recurring（重复执行），默认 recurring").optional(),
    cron: z.string().describe('标准 5 位 cron 表达式，如 "0 9 * * *"（每天9点）'),
    prompt: z.string().describe("每次执行时发送给 AI 的 prompt"),
    timezone: z.string().describe("时区，默认 Asia/Shanghai").optional(),
  }),
  async execute(args, toolCtx) {
    const { name, type, cron: cronExpr, prompt, timezone } = args;

    if (!validate(cronExpr)) {
      return textResult(`❌ 无效的 cron 表达式: "${cronExpr}"`);
    }
    if (!validateMinInterval(cronExpr)) {
      return textResult("❌ 执行频率过高，最小间隔为 30 分钟。");
    }

    const ctx = requireAgentToolContext(toolCtx);

    const store = getSchedulerStore();
    const taskType = type ?? "recurring";
    const task = await store.createTask({
      accountId: ctx.accountId,
      conversationId: ctx.targetConversationId ?? ctx.conversationId,
      name,
      prompt,
      type: taskType,
      cron: cronExpr,
      timezone,
    });

    activate(task);

    const typeLabel = taskType === "once" ? "单次" : "重复";
    return textResult(
      `✅ 定时任务已创建\n` +
      `📌 名称：${task.name}\n` +
      `📋 类型：${typeLabel}\n` +
      `⏰ 时间：${task.cron}（${task.timezone}）\n` +
      `📝 Prompt：${task.prompt}\n` +
      `🔢 编号：#${task.seq}`,
    );
  },
});

const updateScheduledTaskTool = defineTool({
  name: "update_scheduled_task",
  description: "修改已有的定时任务。可修改名称、cron 表达式、prompt、时区或启用/禁用状态。",
  parameters: z.object({
    seq: z.number().int().describe("任务编号（如 3 表示 #3）"),
    name: z.string().describe("新的任务名称").optional(),
    cron: z.string().describe("新的 cron 表达式").optional(),
    prompt: z.string().describe("新的 prompt").optional(),
    timezone: z.string().describe("新的时区").optional(),
    enabled: z.boolean().describe("是否启用").optional(),
  }),
  async execute(args, toolCtx) {
    const { seq, name, cron: cronExpr, prompt, timezone, enabled } = args;
    const ctx = requireAgentToolContext(toolCtx);

    if (cronExpr) {
      if (!validate(cronExpr)) {
        return textResult(`❌ 无效的 cron 表达式: "${cronExpr}"`);
      }
      if (!validateMinInterval(cronExpr)) {
        return textResult("❌ 执行频率过高，最小间隔为 30 分钟。");
      }
    }

    const store = getSchedulerStore();
    const updated = await store.updateTask(ctx.accountId, seq, {
      name, cron: cronExpr, prompt, timezone, enabled,
    });

    if (!updated) return textResult(`❌ 未找到任务 #${seq}`);

    // Re-activate with new settings if enabled, deactivate if disabled
    if (updated.enabled) {
      activate(updated);
    } else {
      deactivate(updated.id);
    }

    return textResult(`✅ 任务 #${seq} 已更新`);
  },
});

const deleteScheduledTaskTool = defineTool({
  name: "delete_scheduled_task",
  description: "删除一个定时任务。",
  parameters: z.object({
    seq: z.number().int().describe("任务编号"),
  }),
  async execute(args, toolCtx) {
    const { seq } = args;
    const ctx = requireAgentToolContext(toolCtx);

    const store = getSchedulerStore();
    const task = await store.getTaskBySeq(ctx.accountId, seq);
    if (!task) return textResult(`❌ 未找到任务 #${seq}`);

    deactivate(task.id);
    await store.deleteTask(ctx.accountId, seq);
    return textResult(`✅ 任务 #${seq}「${task.name}」已删除`);
  },
});

const listScheduledTasksTool = defineTool({
  name: "list_scheduled_tasks",
  description: "列出当前账号的所有定时任务。",
  parameters: z.object({}),
  async execute(_args, toolCtx) {
    const ctx = requireAgentToolContext(toolCtx);

    const store = getSchedulerStore();
    const tasks = await store.listTasks(ctx.accountId);
    if (tasks.length === 0) return textResult("📋 暂无定时任务。");

    const lines = tasks.map((t) => {
      const statusIcon = t.enabled
        ? t.status === "paused" ? "⏸️" : "▶️"
        : "⏹️";
      const typeLabel = t.type === "once" ? "[单次]" : "[重复]";
      return `${statusIcon} #${t.seq} ${typeLabel} ${t.name} — ${t.cron}（${t.timezone}）`;
    });
    return textResult("📋 定时任务列表：\n" + lines.join("\n"));
  },
});

const runScheduledTaskTool = defineTool({
  name: "run_scheduled_task",
  description: "手动触发一次定时任务执行（不影响定时计划）。",
  parameters: z.object({
    seq: z.number().int().describe("任务编号"),
  }),
  async execute(args, toolCtx) {
    const { seq } = args;
    const ctx = requireAgentToolContext(toolCtx);

    const store = getSchedulerStore();
    const task = await store.getTaskBySeq(ctx.accountId, seq);
    if (!task) return textResult(`❌ 未找到任务 #${seq}`);

    // Fire-and-forget execution
    void executeTask(task).catch((err) =>
      logger.error("manual run failed", { seq, error: err }),
    );

    return textResult(`⏳ 任务 #${seq}「${task.name}」已触发执行，结果将稍后推送。`);
  },
});

// ── Registry ───────────────────────────────────────────────────────

export const schedulerToolRegistry = createToolRegistry();

const tools: ToolSnapshotItem[] = [
  createScheduledTaskTool,
  updateScheduledTaskTool,
  deleteScheduledTaskTool,
  listScheduledTasksTool,
  runScheduledTaskTool,
];

schedulerToolRegistry.swap({ tools });
