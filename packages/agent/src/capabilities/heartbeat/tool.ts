/**
 * Heartbeat Agent Tools — schedule / list / cancel proactive reminders.
 *
 * Registered into the ToolRegistry and called by the Agent during normal
 * conversations. The Agent decides on its own when something is worth
 * bringing up later.
 */

import { z } from "zod";
import { createToolRegistry } from "../tools/registry.js";
import type { ToolSnapshotItem } from "../tools/types.js";
import { defineTool, textResult } from "../tools/define-tool.js";
import { requireAgentToolContext } from "../tools/context.js";
import { getHeartbeatStore } from "../../ports/heartbeat-store.js";
import { MAX_PENDING_PER_ACCOUNT, MAX_FIRE_AHEAD_MS } from "./types.js";

function formatFireAt(date: Date): string {
  return date.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false });
}

const createReminderTool = defineTool({
  name: "create_reminder",
  description:
    "当你想在之后某个时间主动跟用户说点什么时调用。" +
    "比如：用户提到明天有面试，你想第二天问问结果；用户说晚点回复你，你想过一会儿再提一嘴。" +
    "到时间后你会在这个对话里被唤醒，按 prompt 生成一句话主动发给用户。" +
    "用户明确要求的定时任务（每天推送新闻之类）请用 create_scheduled_task。",
  parameters: z.object({
    fire_at: z
      .string()
      .describe('触发时间，ISO8601 带时区，如 "2026-07-28T09:00:00+08:00"'),
    prompt: z
      .string()
      .describe("到时间后给你自己的指令，说明要跟用户聊什么，如「问问他昨天的面试结果」"),
  }),
  async execute(args, toolCtx) {
    const { fire_at: fireAtRaw, prompt } = args;

    // Background runs have no live user to deliver a new reminder to; keep the
    // follow-up in the current reply instead.
    if (toolCtx.runKind === "heartbeat" || toolCtx.runKind === "scheduler") {
      return textResult(
        "拒绝：当前后台执行中不能创建新的提醒。请直接在本次结果里说明需要后续跟进的事项。",
      );
    }

    const ctx = requireAgentToolContext(toolCtx);

    const fireAt = new Date(fireAtRaw);
    if (Number.isNaN(fireAt.getTime())) {
      return textResult(`❌ 无法解析时间 "${fireAtRaw}"，请用 ISO8601 格式，如 2026-07-28T09:00:00+08:00`);
    }

    const now = Date.now();
    if (fireAt.getTime() <= now) {
      return textResult(`❌ 触发时间 ${formatFireAt(fireAt)} 已过去，请给一个将来的时间。`);
    }
    if (fireAt.getTime() - now > MAX_FIRE_AHEAD_MS) {
      return textResult(`❌ 最远只能安排 ${MAX_FIRE_AHEAD_MS / 86_400_000} 天以内的提醒。`);
    }

    const store = getHeartbeatStore();

    const pending = await store.listByAccount(ctx.accountId);
    if (pending.length >= MAX_PENDING_PER_ACCOUNT) {
      return textResult(
        `拒绝：已有 ${pending.length} 条待触发提醒（上限 ${MAX_PENDING_PER_ACCOUNT}）。请先取消一些。`,
      );
    }

    const reminder = await store.createReminder({
      accountId: ctx.accountId,
      conversationId: ctx.conversationId,
      prompt,
      fireAt,
    });

    return textResult(
      `✅ 已安排提醒\n⏰ ${formatFireAt(reminder.fireAt)}\n📝 ${reminder.prompt}\n🔢 ID: ${reminder.reminderId}`,
    );
  },
});

const listRemindersTool = defineTool({
  name: "list_reminders",
  description: "列出当前账号所有待触发的提醒。",
  parameters: z.object({}),
  async execute(_args, toolCtx) {
    const ctx = requireAgentToolContext(toolCtx);

    const reminders = await getHeartbeatStore().listByAccount(ctx.accountId);
    if (reminders.length === 0) return textResult("当前没有待触发的提醒。");

    const lines = reminders.map(
      (r) => `⏰ ${formatFireAt(r.fireAt)}\n   ${r.prompt}\n   ID: ${r.reminderId}`,
    );

    return textResult(`📋 待触发提醒 (${reminders.length}):\n\n${lines.join("\n\n")}`);
  },
});

const cancelReminderTool = defineTool({
  name: "cancel_reminder",
  description: "取消一条尚未触发的提醒。用户说「不用提醒我了」时调用。",
  parameters: z.object({
    reminder_id: z.string().describe("提醒 ID (UUID)，可从 list_reminders 获取"),
  }),
  async execute(args) {
    const { reminder_id: reminderId } = args;

    const removed = await getHeartbeatStore().claimById(reminderId);
    if (!removed) return textResult(`未找到待触发的提醒 ${reminderId}，可能已经触发或已被取消。`);

    return textResult(`✅ 已取消提醒：${removed.prompt}`);
  },
});

// ── Registry ───────────────────────────────────────────────────────

export const heartbeatToolRegistry = createToolRegistry();

const tools: ToolSnapshotItem[] = [
  createReminderTool,
  listRemindersTool,
  cancelReminderTool,
];

heartbeatToolRegistry.swap({ tools });
