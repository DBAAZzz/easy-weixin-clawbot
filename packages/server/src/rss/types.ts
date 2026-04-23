export type RssSourceType = "rsshub_route" | "rss_url";
export type RssSourceStatus = "normal" | "backoff" | "error" | "disabled";
export type RssTaskKind = "rss_digest" | "rss_brief";

export interface SilentWindowConfig {
  start: string;
  end: string;
}

export interface RssTaskConfig {
  sourceIds: string[];
  maxItems: number;
  silentWindow: SilentWindowConfig | null;
  createdAfter: string;
}

export interface ParsedTaskPayload {
  accountId?: string;
  name?: string;
  taskKind?: RssTaskKind;
  cron?: string;
  timezone?: string;
  sourceIds?: string[];
  maxItems?: number;
  type?: "once" | "recurring";
  enabled?: boolean;
  silentWindow?: SilentWindowConfig | null;
}

export interface ParsedFeedItem {
  fingerprint: string;
  guid: string | null;
  rawLink: string | null;
  normalizedLink: string | null;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  summaryText: string | null;
  contentText: string | null;
  mediaJson: Array<Record<string, string | null>>;
  metaJson: Record<string, unknown>;
}

export interface RssEntryMeta {
  contentHtml?: string | null;
}

export interface SourceRecord {
  id: bigint;
  name: string;
  sourceType: RssSourceType;
  routePath: string | null;
  feedUrl: string | null;
  description: string | null;
  enabled: boolean;
  status: RssSourceStatus;
  lastFetchedAt: Date | null;
  lastSuccessAt: Date | null;
  lastError: string | null;
  failureStreak: number;
  backoffUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface EntryRecord {
  id: bigint;
  sourceId: bigint;
  fingerprint: string;
  guid: string | null;
  rawLink: string | null;
  normalizedLink: string | null;
  title: string;
  author: string | null;
  publishedAt: Date | null;
  summaryText: string | null;
  contentText: string | null;
  mediaJson: unknown;
  metaJson: unknown;
  collectedAt: Date;
  expiresAt: Date | null;
}

export interface TaskSourceSummary {
  id: string;
  name: string;
  status: RssSourceStatus;
}

export interface RssSourceDto {
  id: string;
  name: string;
  source_type: RssSourceType;
  route_path: string | null;
  feed_url: string | null;
  description: string | null;
  enabled: boolean;
  status: RssSourceStatus;
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

export interface RssSourcePreviewSummaryDto {
  id: string;
  name: string;
}

export interface RssSourcePreviewDto {
  source: RssSourcePreviewSummaryDto;
  items: RssPreviewItemDto[];
}

export interface RssTaskDto {
  id: string;
  seq: number;
  account_id: string;
  conversation_id: string;
  name: string;
  task_kind: RssTaskKind;
  type: "once" | "recurring";
  cron: string;
  timezone: string;
  enabled: boolean;
  status: string;
  last_run_at: string | null;
  next_run_at: string | null;
  last_error: string | null;
  run_count: number;
  fail_streak: number;
  source_count: number;
  sources: TaskSourceSummary[];
  max_items: number;
  silent_window: SilentWindowConfig | null;
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
