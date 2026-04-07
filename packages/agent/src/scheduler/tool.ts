import { Type } from "@mariozechner/pi-ai";
import { createToolRegistry } from "../tools/registry.js";
import type { ToolSnapshotItem, ToolContent } from "../tools/types.js";
import { validate } from "node-cron";
import { getSchedulerStore } from "../ports/scheduler-store.js";
import { activate, deactivate } from "./manager.js";
import { executeTask } from "./executor.js";

/** Minimum interval: 30 minutes. Rejects cron expressions with intervals < 30min. */
function validateMinInterval(cronExpr: string): boolean {
  const parts = cronExpr.trim().split(/\s+/);
  // Reject 6-part (seconds) cron
  if (parts.length > 5) return false;

  const minutePart = parts[0];

  // */N where N < 30
  const stepMatch = minutePart.match(/^\*\/(\d+)$/);
  if (stepMatch && Number.parseInt(stepMatch[1], 10) < 30) return false;

  // Comma-separated minutes with gap < 30
  if (minutePart.includes(",")) {
    const minutes = minutePart.split(",").map(Number).sort((a, b) => a - b);
    for (let i = 1; i < minutes.length; i++) {
      if (minutes[i] - minutes[i - 1] < 30) return false;
    }
  }

  return true;
}

function textResult(text: string): ToolContent[] {
  return [{ type: "text", text }];
}

// ── Context injection ──────────────────────────────────────────────

interface SchedulerContext {
  accountId: string;
  conversationId: string;
}

let _currentContext: SchedulerContext | null = null;

function getCurrentSchedulerContext(): SchedulerContext | null {
  return _currentContext;
}

/**
 * Set the scheduler context before tool execution.
 * Called by the agent layer to inject accountId/conversationId.
 */
export function setSchedulerContext(ctx: SchedulerContext | null): void {
  _currentContext = ctx;
}

// ── Tool definitions ───────────────────────────────────────────────

const createScheduledTaskTool: ToolSnapshotItem = {
  name: "create_scheduled_task",
  description:
    "创建一个定时任务。到时间后自动执行 AI Prompt 并将结果推送到当前会话。" +
    "需要将用户的自然语言需求转换为 cron 表达式和明确的 prompt。" +
    "支持两种类型：once（单次执行后自动停止）和 recurring（按 cron 重复执行）。" +
    "最小执行间隔为 30 分钟。",
  parameters: Type.Object({
    name: Type.String({ description: "任务名称（简短描述，如「科技新闻摘要」）" }),
    type: Type.Optional(Type.Union([Type.Literal("once"), Type.Literal("recurring")], {
      description: '任务类型：once（单次执行）或 recurring（重复执行），默认 recurring',
    })),
    cron: Type.String({ description: '标准 5 位 cron 表达式，如 "0 9 * * *"（每天9点）' }),
    prompt: Type.String({ description: "每次执行时发送给 AI 的 prompt" }),
    timezone: Type.Optional(Type.String({ description: "时区，默认 Asia/Shanghai" })),
  }),
  async execute(args) {
    const { name, type, cron: cronExpr, prompt, timezone } = args as {
      name: string; type?: "once" | "recurring"; cron: string; prompt: string; timezone?: string;
    };

    if (!validate(cronExpr)) {
      return textResult(`❌ 无效的 cron 表达式: "${cronExpr}"`);
    }
    if (!validateMinInterval(cronExpr)) {
      return textResult("❌ 执行频率过高，最小间隔为 30 分钟。");
    }

    const ctx = getCurrentSchedulerContext();
    if (!ctx) return textResult("❌ 内部错误：缺少上下文信息");

    const store = getSchedulerStore();
    const taskType = type ?? "recurring";
    const task = await store.createTask({
      accountId: ctx.accountId,
      conversationId: ctx.conversationId,
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
};

const updateScheduledTaskTool: ToolSnapshotItem = {
  name: "update_scheduled_task",
  description: "修改已有的定时任务。可修改名称、cron 表达式、prompt、时区或启用/禁用状态。",
  parameters: Type.Object({
    seq: Type.Integer({ description: "任务编号（如 3 表示 #3）" }),
    name: Type.Optional(Type.String({ description: "新的任务名称" })),
    cron: Type.Optional(Type.String({ description: "新的 cron 表达式" })),
    prompt: Type.Optional(Type.String({ description: "新的 prompt" })),
    timezone: Type.Optional(Type.String({ description: "新的时区" })),
    enabled: Type.Optional(Type.Boolean({ description: "是否启用" })),
  }),
  async execute(args) {
    const { seq, name, cron: cronExpr, prompt, timezone, enabled } = args as {
      seq: number; name?: string; cron?: string; prompt?: string; timezone?: string; enabled?: boolean;
    };

    const ctx = getCurrentSchedulerContext();
    if (!ctx) return textResult("❌ 内部错误：缺少上下文信息");

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
};

const deleteScheduledTaskTool: ToolSnapshotItem = {
  name: "delete_scheduled_task",
  description: "删除一个定时任务。",
  parameters: Type.Object({
    seq: Type.Integer({ description: "任务编号" }),
  }),
  async execute(args) {
    const { seq } = args as { seq: number };
    const ctx = getCurrentSchedulerContext();
    if (!ctx) return textResult("❌ 内部错误：缺少上下文信息");

    const store = getSchedulerStore();
    const task = await store.getTaskBySeq(ctx.accountId, seq);
    if (!task) return textResult(`❌ 未找到任务 #${seq}`);

    deactivate(task.id);
    await store.deleteTask(ctx.accountId, seq);
    return textResult(`✅ 任务 #${seq}「${task.name}」已删除`);
  },
};

const listScheduledTasksTool: ToolSnapshotItem = {
  name: "list_scheduled_tasks",
  description: "列出当前账号的所有定时任务。",
  parameters: Type.Object({}),
  async execute() {
    const ctx = getCurrentSchedulerContext();
    if (!ctx) return textResult("❌ 内部错误：缺少上下文信息");

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
};

const runScheduledTaskTool: ToolSnapshotItem = {
  name: "run_scheduled_task",
  description: "手动触发一次定时任务执行（不影响定时计划）。",
  parameters: Type.Object({
    seq: Type.Integer({ description: "任务编号" }),
  }),
  async execute(args) {
    const { seq } = args as { seq: number };
    const ctx = getCurrentSchedulerContext();
    if (!ctx) return textResult("❌ 内部错误：缺少上下文信息");

    const store = getSchedulerStore();
    const task = await store.getTaskBySeq(ctx.accountId, seq);
    if (!task) return textResult(`❌ 未找到任务 #${seq}`);

    // Fire-and-forget execution
    void executeTask(task).catch((err) =>
      console.error(`[scheduler] manual run failed for task #${seq}:`, err),
    );

    return textResult(`⏳ 任务 #${seq}「${task.name}」已触发执行，结果将稍后推送。`);
  },
};

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
