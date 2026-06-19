import { Badge } from "@clawbot/ui";
import { AlertCircleIcon, ActivityIcon, CheckCircleIcon, ClockIcon } from "@clawbot/ui";
import type { ScheduledTaskDto, ScheduledTaskRunDto } from "@/api/scheduled-tasks.js";

export function cronToHuman(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) return cron;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const pad = (v: string) => v.padStart(2, "0");

  let timeStr = "";
  if (hour !== "*" && minute !== "*") {
    if (
      !hour.includes(",") &&
      !hour.includes("-") &&
      !hour.includes("/") &&
      !minute.includes(",") &&
      !minute.includes("-") &&
      !minute.includes("/")
    ) {
      timeStr = `${pad(hour)}:${pad(minute)}`;
    }
  }
  if (hour !== "*" && minute === "*") {
    timeStr = `${pad(hour)}:xx`;
  }

  if (hour === "*" && minute.startsWith("*/")) {
    const n = minute.slice(2);
    return `每 ${n} 分钟`;
  }
  if (minute === "0" && hour.startsWith("*/")) {
    const n = hour.slice(2);
    return `每 ${n} 小时`;
  }

  const weekMap: Record<string, string> = {
    "0": "周日",
    "7": "周日",
    "1": "周一",
    "2": "周二",
    "3": "周三",
    "4": "周四",
    "5": "周五",
    "6": "周六",
  };

  if (dayOfMonth !== "*" && month === "*" && dayOfWeek === "*") {
    if (!dayOfMonth.includes(",") && !dayOfMonth.includes("-") && !dayOfMonth.includes("/")) {
      return `每月${dayOfMonth}日 ${timeStr}`.trim();
    }
  }

  if (dayOfMonth === "*" && month === "*" && dayOfWeek !== "*") {
    if (dayOfWeek === "1-5") return `工作日 ${timeStr}`.trim();
    if (dayOfWeek === "0,6" || dayOfWeek === "6,0") return `周末 ${timeStr}`.trim();
    if (weekMap[dayOfWeek]) return `每${weekMap[dayOfWeek]} ${timeStr}`.trim();
    if (dayOfWeek.includes(",")) {
      const days = dayOfWeek
        .split(",")
        .map((d) => weekMap[d] ?? d)
        .join("、");
      return `每${days} ${timeStr}`.trim();
    }
  }

  if (dayOfMonth === "*" && month === "*" && dayOfWeek === "*" && timeStr) {
    return `每天 ${timeStr}`;
  }

  return cron;
}

export function getTaskStatusTone(
  status: ScheduledTaskDto["status"],
): "online" | "offline" | "muted" | "error" | "warning" {
  return status === "running"
    ? "online"
    : status === "error"
      ? "error"
      : status === "paused"
        ? "offline"
        : "muted";
}

export function getTaskStatusLabel(status: ScheduledTaskDto["status"]): string {
  return status === "idle"
    ? "空闲"
    : status === "running"
      ? "运行中"
      : status === "error"
        ? "错误"
        : status === "paused"
          ? "已暂停"
          : status;
}

export function getTaskStatusIcon(status: ScheduledTaskDto["status"]) {
  return status === "running" ? (
    <ActivityIcon className="size-3" />
  ) : status === "error" ? (
    <AlertCircleIcon className="size-3" />
  ) : status === "paused" ? (
    <ClockIcon className="size-3" />
  ) : (
    <CheckCircleIcon className="size-3" />
  );
}

export function TaskStatusBadge({ status }: { status: ScheduledTaskDto["status"] }) {
  const tone = getTaskStatusTone(status);
  const label = getTaskStatusLabel(status);
  return <Badge tone={tone}>{label}</Badge>;
}

export function RunStatusBadge({ status }: { status: ScheduledTaskRunDto["status"] }) {
  const icon =
    status === "success" ? (
      <CheckCircleIcon className="size-3" />
    ) : status === "error" ? (
      <AlertCircleIcon className="size-3" />
    ) : status === "timeout" ? (
      <ClockIcon className="size-3" />
    ) : (
      <ActivityIcon className="size-3" />
    );
  const tone =
    status === "success"
      ? "online"
      : status === "error"
        ? "error"
        : status === "timeout"
          ? "warning"
          : "muted";
  return (
    <Badge tone={tone} className="gap-1">
      {icon}
      {status === "success"
        ? "成功"
        : status === "error"
          ? "失败"
          : status === "timeout"
            ? "超时"
            : status === "skipped"
              ? "跳过"
              : status}
    </Badge>
  );
}
