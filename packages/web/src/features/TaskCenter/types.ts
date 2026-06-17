import type { AccountSummary } from "@clawbot/shared";
import type { RssTaskDto } from "@/api/rss.js";

export type TaskDraft = {
  accountId: string;
  name: string;
  taskKind: "rss_digest" | "rss_brief";
  cronPreset: string;
  cron: string;
  timezone: string;
  maxItems: string;
  enabled: boolean;
  type: "once" | "recurring";
  silentWindowEnabled: boolean;
  silentStart: string;
  silentEnd: string;
  sourceIds: string[];
};

export const CRON_PRESETS = [
  { value: "*/5 * * * *", label: "每 5 分钟" },
  { value: "*/15 * * * *", label: "每 15 分钟" },
  { value: "*/30 * * * *", label: "每 30 分钟" },
  { value: "0 * * * *", label: "每 1 小时" },
  { value: "0 9 * * *", label: "每天 09:00" },
  { value: "custom", label: "自定义 Cron" },
] as const;

export const EMPTY_TASK_DRAFT: TaskDraft = {
  accountId: "",
  name: "",
  taskKind: "rss_brief",
  cronPreset: "*/15 * * * *",
  cron: "*/15 * * * *",
  timezone: "Asia/Shanghai",
  maxItems: "4",
  enabled: true,
  type: "recurring",
  silentWindowEnabled: false,
  silentStart: "23:00",
  silentEnd: "08:00",
  sourceIds: [],
};

export function taskKindLabel(taskKind: RssTaskDto["task_kind"]): string {
  return taskKind === "rss_digest" ? "摘要任务" : "快讯任务";
}

export function taskStatusTone(
  status: RssTaskDto["status"],
): "online" | "offline" | "warning" | "error" | "muted" {
  if (status === "running") return "warning";
  if (status === "error") return "error";
  if (status === "paused") return "offline";
  if (status === "idle") return "online";
  return "muted";
}

export function taskStatusLabel(status: RssTaskDto["status"]): string {
  if (status === "running") return "执行中";
  if (status === "error") return "异常";
  if (status === "paused") return "已暂停";
  if (status === "idle") return "待执行";
  return status;
}

export function taskExecutionLabel(type: RssTaskDto["type"]): string {
  return type === "once" ? "仅执行一次" : "循环执行";
}

export function scheduleLabel(cron: string): string {
  return CRON_PRESETS.find((preset) => preset.value === cron)?.label ?? "自定义 Cron";
}

export function accountLabel(account: AccountSummary | undefined, accountId: string): string {
  return account?.alias?.trim() || account?.display_name?.trim() || accountId;
}

export function createTaskDraft(task?: RssTaskDto | null): TaskDraft {
  if (!task) {
    return EMPTY_TASK_DRAFT;
  }

  const cronPreset = CRON_PRESETS.find((item) => item.value === task.cron)?.value ?? "custom";

  return {
    accountId: task.account_id,
    name: task.name,
    taskKind: task.task_kind,
    cronPreset,
    cron: task.cron,
    timezone: task.timezone,
    maxItems: String(task.max_items),
    enabled: task.enabled,
    type: task.type,
    silentWindowEnabled: Boolean(task.silent_window),
    silentStart: task.silent_window?.start ?? "23:00",
    silentEnd: task.silent_window?.end ?? "08:00",
    sourceIds: task.sources.map((source) => source.id),
  };
}
