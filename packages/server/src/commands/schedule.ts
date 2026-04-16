import { schedulerManager, runScheduledTaskNow } from "@clawbot/agent";
import { getSchedulerStore } from "@clawbot/agent/ports";
import type { Command } from "./types.js";

function formatDate(d: Date | null): string {
  if (!d) return "-";
  return d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" });
}

export const scheduleCommand: Command = {
  name: "schedule",
  description: "管理定时任务（list / info / pause / resume / delete / run / history）",

  async execute(ctx) {
    const parts = ctx.args.trim().split(/\s+/);
    const sub = parts[0] ?? "list";
    const seqStr = parts[1];
    const seq = seqStr ? Number.parseInt(seqStr, 10) : Number.NaN;
    const store = getSchedulerStore();

    switch (sub) {
      case "list": {
        const tasks = await store.listTasks(ctx.accountId);
        if (tasks.length === 0) return { text: "📋 暂无定时任务。" };

        const lines = tasks.map((task) => {
          const icon = task.enabled ? (task.status === "paused" ? "⏸️" : "▶️") : "⏹️";
          const typeLabel = task.type === "once" ? "[单次]" : "[重复]";
          return `${icon} #${task.seq} ${typeLabel} ${task.name} — ${task.cron}`;
        });
        return { text: `📋 定时任务：\n${lines.join("\n")}` };
      }

      case "info": {
        if (Number.isNaN(seq)) return { text: "用法：/schedule info <编号>" };
        const task = await store.getTaskBySeq(ctx.accountId, seq);
        if (!task) return { text: `❌ 未找到任务 #${seq}` };

        const typeLabel = task.type === "once" ? "单次" : "重复";
        return {
          text: [
            `📌 #${task.seq} ${task.name}`,
            `📋 类型：${typeLabel}`,
            `⏰ ${task.cron}（${task.timezone}）`,
            `📝 ${task.prompt}`,
            `状态：${task.status} | 启用：${task.enabled ? "是" : "否"}`,
            `执行次数：${task.runCount} | 连续失败：${task.failStreak}`,
            `上次执行：${formatDate(task.lastRunAt)}`,
            task.lastError ? `最近错误：${task.lastError}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        };
      }

      case "pause": {
        if (Number.isNaN(seq)) return { text: "用法：/schedule pause <编号>" };
        const task = await store.getTaskBySeq(ctx.accountId, seq);
        if (!task) return { text: `❌ 未找到任务 #${seq}` };

        await store.updateTask(ctx.accountId, seq, { enabled: false });
        schedulerManager.deactivate(task.id);
        return { text: `⏸️ 任务 #${seq}「${task.name}」已暂停` };
      }

      case "resume": {
        if (Number.isNaN(seq)) return { text: "用法：/schedule resume <编号>" };
        const updated = await store.updateTask(ctx.accountId, seq, { enabled: true });
        if (!updated) return { text: `❌ 未找到任务 #${seq}` };

        // Re-read and activate
        const task = await store.getTaskBySeq(ctx.accountId, seq);
        if (task) schedulerManager.activate(task);
        return { text: `▶️ 任务 #${seq}「${updated.name}」已恢复` };
      }

      case "delete": {
        if (Number.isNaN(seq)) return { text: "用法：/schedule delete <编号>" };
        const task = await store.getTaskBySeq(ctx.accountId, seq);
        if (!task) return { text: `❌ 未找到任务 #${seq}` };

        schedulerManager.deactivate(task.id);
        await store.deleteTask(ctx.accountId, seq);
        return { text: `🗑️ 任务 #${seq}「${task.name}」已删除` };
      }

      case "run": {
        if (Number.isNaN(seq)) return { text: "用法：/schedule run <编号>" };
        const task = await store.getTaskBySeq(ctx.accountId, seq);
        if (!task) return { text: `❌ 未找到任务 #${seq}` };

        void runScheduledTaskNow(task).catch((err) =>
          console.error(`[scheduler] manual run failed for task #${seq}:`, err),
        );
        return { text: `⏳ 任务 #${seq} 已触发执行，结果将稍后推送。` };
      }

      case "history": {
        if (Number.isNaN(seq)) return { text: "用法：/schedule history <编号>" };
        const task = await store.getTaskBySeq(ctx.accountId, seq);
        if (!task) return { text: `❌ 未找到任务 #${seq}` };

        const runs = await store.listRuns(task.id, 5);
        if (runs.length === 0) return { text: `📜 任务 #${seq} 暂无执行记录。` };

        const lines = runs.map((run) => {
          const icon = run.status === "success" ? "✅" : run.status === "timeout" ? "⏰" : "❌";
          const pushed = run.pushed ? "已推送" : "未推送";
          const duration = run.durationMs ? `${run.durationMs}ms` : "-";
          return `${icon} ${formatDate(run.createdAt)} | ${run.status} | ${duration} | ${pushed}`;
        });
        return { text: `📜 任务 #${seq} 最近执行记录：\n${lines.join("\n")}` };
      }

      default:
        return {
          text: [
            "用法：/schedule <子命令> [编号]",
            "",
            "  list              列出所有任务",
            "  info <编号>       查看任务详情",
            "  pause <编号>      暂停任务",
            "  resume <编号>     恢复任务",
            "  delete <编号>     删除任务",
            "  run <编号>        手动触发一次",
            "  history <编号>    查看执行记录",
          ].join("\n"),
        };
    }
  },
};
