import { request } from "./core/client.js";

export interface RssSourceDto {
  id: string;
  name: string;
  source_type: "rsshub_route" | "rss_url";
  route_path: string | null;
  feed_url: string | null;
  description: string | null;
  enabled: boolean;
  status: "normal" | "backoff" | "error" | "disabled";
  last_fetched_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  failure_streak: number;
  backoff_until: string | null;
  referenced_task_count: number;
  recent_item_count: number;
  created_at: string;
  updated_at: string;
}

export interface RssPreviewItemDto {
  id: string;
  fingerprint: string;
  title: string;
  summary_text: string | null;
  content_text: string | null;
  content_html: string | null;
  link: string | null;
  published_at: string | null;
  author: string | null;
  media: Array<Record<string, string | null>>;
}

export interface RssSourcePreviewDto {
  source: RssSourceDto;
  items: RssPreviewItemDto[];
}

export interface RssTaskDto {
  id: string;
  seq: number;
  account_id: string;
  conversation_id: string;
  name: string;
  task_kind: "rss_digest" | "rss_brief";
  type: "once" | "recurring";
  cron: string;
  timezone: string;
  enabled: boolean;
  status: "idle" | "running" | "error" | "paused";
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  run_count: number;
  fail_streak: number;
  source_count: number;
  sources: Array<{
    id: string;
    name: string;
    status: "normal" | "backoff" | "error" | "disabled";
  }>;
  max_items: number;
  silent_window: { start: string; end: string } | null;
  created_after: string;
  created_at: string;
  updated_at: string;
}

export interface RssTaskPreviewDto {
  task: RssTaskDto;
  would_send: boolean;
  suppressed: boolean;
  reason: string | null;
  item_count: number;
  dropped_count: number;
  content: string | null;
  items: RssPreviewItemDto[];
}

export interface RssConnectionTestDto {
  reachable: boolean;
  status_code: number | null;
  latency_ms: number | null;
  base_url: string | null;
  message: string;
}

export interface RssTaskRunNowResult {
  success: boolean;
  run: {
    id: string;
    status: string;
    prompt: string;
    result: string | null;
    duration_ms: number | null;
    error: string | null;
    pushed: boolean;
    created_at: string;
  } | null;
}

export function fetchRssSources(): Promise<RssSourceDto[]> {
  return request<RssSourceDto[]>("/api/rss/sources");
}

export function createRssSource(
  payload: Partial<{
    name: string;
    source_type: "rsshub_route" | "rss_url";
    route_path: string | null;
    feed_url: string | null;
    description: string | null;
    enabled: boolean;
  }>,
): Promise<RssSourceDto> {
  return request<RssSourceDto>("/api/rss/sources", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRssSource(
  id: string,
  payload: Partial<{
    name: string;
    source_type: "rsshub_route" | "rss_url";
    route_path: string | null;
    feed_url: string | null;
    description: string | null;
    enabled: boolean;
  }>,
): Promise<RssSourceDto> {
  return request<RssSourceDto>(`/api/rss/sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteRssSource(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/rss/sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function previewRssSource(id: string): Promise<RssSourcePreviewDto> {
  return request<RssSourcePreviewDto>(`/api/rss/sources/${encodeURIComponent(id)}/preview`);
}

export function testRssSource(id: string): Promise<RssSourcePreviewDto> {
  return request<RssSourcePreviewDto>(`/api/rss/sources/${encodeURIComponent(id)}/test`, {
    method: "POST",
  });
}

export function testRssSettingsConnection(): Promise<RssConnectionTestDto> {
  return request<RssConnectionTestDto>("/api/rss/settings/test", {
    method: "POST",
  });
}

export function fetchRssTasks(accountId?: string): Promise<RssTaskDto[]> {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return request<RssTaskDto[]>(`/api/rss/tasks${query}`);
}

export function createRssTask(payload: {
  account_id: string;
  name: string;
  task_kind: "rss_digest" | "rss_brief";
  cron: string;
  timezone?: string;
  source_ids: string[];
  max_items?: number;
  enabled?: boolean;
  type?: "once" | "recurring";
  silent_window?: { start: string; end: string } | null;
}): Promise<RssTaskDto> {
  return request<RssTaskDto>("/api/rss/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRssTask(
  accountId: string,
  seq: number,
  payload: Partial<{
    name: string;
    task_kind: "rss_digest" | "rss_brief";
    cron: string;
    timezone: string;
    source_ids: string[];
    max_items: number;
    enabled: boolean;
    type: "once" | "recurring";
    silent_window: { start: string; end: string } | null;
  }>,
): Promise<RssTaskDto> {
  return request<RssTaskDto>(`/api/rss/tasks/${encodeURIComponent(accountId)}/${seq}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteRssTask(accountId: string, seq: number): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/rss/tasks/${encodeURIComponent(accountId)}/${seq}`, {
    method: "DELETE",
  });
}

export function previewRssTask(accountId: string, seq: number): Promise<RssTaskPreviewDto> {
  return request<RssTaskPreviewDto>(
    `/api/rss/tasks/${encodeURIComponent(accountId)}/${seq}/preview`,
  );
}

export function runRssTaskNow(accountId: string, seq: number): Promise<RssTaskRunNowResult> {
  return request<RssTaskRunNowResult>(
    `/api/rss/tasks/${encodeURIComponent(accountId)}/${seq}/run`,
    {
      method: "POST",
    },
  );
}
