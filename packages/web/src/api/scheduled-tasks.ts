import { request } from "./core/client";

export interface ScheduledTaskDto {
  id: string;
  seq: number;
  accountId: string;
  conversationId: string;
  name: string;
  prompt: string;
  type: "once" | "recurring";
  cron: string;
  timezone: string;
  enabled: boolean;
  status: "idle" | "running" | "error" | "paused";
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  runCount: number;
  failStreak: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRunDto {
  id: string;
  status: "success" | "error" | "timeout" | "skipped";
  prompt: string;
  result: string | null;
  durationMs: number | null;
  error: string | null;
  pushed: boolean;
  createdAt: string;
}

export function fetchScheduledTasks(accountId?: string): Promise<ScheduledTaskDto[]> {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return request<ScheduledTaskDto[]>(`/api/scheduled-tasks${query}`);
}

export function fetchScheduledTask(
  accountId: string,
  seq: number,
): Promise<{ data: ScheduledTaskDto }> {
  return request<{ data: ScheduledTaskDto }>(
    `/api/scheduled-tasks/${encodeURIComponent(accountId)}/${seq}`,
  );
}

export function toggleScheduledTask(
  accountId: string,
  seq: number,
  enabled: boolean,
): Promise<ScheduledTaskDto> {
  return request<ScheduledTaskDto>(`/api/scheduled-tasks/${encodeURIComponent(accountId)}/${seq}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export function fetchScheduledTaskRuns(
  accountId: string,
  seq: number,
  limit?: number,
): Promise<ScheduledTaskRunDto[]> {
  const query = limit ? `?limit=${limit}` : "";
  return request<ScheduledTaskRunDto[]>(
    `/api/scheduled-tasks/${encodeURIComponent(accountId)}/${seq}/runs${query}`,
  );
}
