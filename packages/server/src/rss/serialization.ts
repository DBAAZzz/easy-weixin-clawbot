import type { ScheduledTaskRow } from "@clawbot/agent";
import type {
  EntryRecord,
  RssPreviewItemDto,
  RssEntryMeta,
  RssSourceDto,
  RssTaskDto,
  RssTaskKind,
  SourceRecord,
  TaskSourceSummary,
} from "./types.js";
import { parseStoredTaskConfig } from "./payload.js";
import { isRecord, sanitizeStructuredText, sanitizeText } from "./utils.js";

function extractContentHtml(metaJson: unknown): string | null {
  if (!isRecord(metaJson)) {
    return null;
  }

  const value = (metaJson as RssEntryMeta).contentHtml;
  return typeof value === "string" && value.trim() ? value : null;
}

export function serializePreviewItem(entry: EntryRecord): RssPreviewItemDto {
  return {
    id: entry.id.toString(),
    fingerprint: entry.fingerprint,
    title: entry.title,
    summary_text: sanitizeText(entry.summaryText),
    content_text: sanitizeStructuredText(entry.contentText),
    content_html: extractContentHtml(entry.metaJson),
    link: entry.normalizedLink ?? entry.rawLink,
    published_at: entry.publishedAt?.toISOString() ?? null,
    author: entry.author,
    media: Array.isArray(entry.mediaJson)
      ? (entry.mediaJson as Array<Record<string, string | null>>)
      : [],
  };
}

export function serializeSource(
  source: SourceRecord,
  referencedTaskCount: number,
  recentItemCount: number,
): RssSourceDto {
  return {
    id: source.id.toString(),
    name: source.name,
    source_type: source.sourceType,
    route_path: source.routePath,
    feed_url: source.feedUrl,
    description: source.description,
    enabled: source.enabled,
    status: source.status,
    last_fetched_at: source.lastFetchedAt?.toISOString() ?? null,
    last_success_at: source.lastSuccessAt?.toISOString() ?? null,
    last_error: source.lastError,
    failure_streak: source.failureStreak,
    backoff_until: source.backoffUntil?.toISOString() ?? null,
    referenced_task_count: referencedTaskCount,
    recent_item_count: recentItemCount,
    created_at: source.createdAt.toISOString(),
    updated_at: source.updatedAt.toISOString(),
  };
}

export function serializeTask(
  task: ScheduledTaskRow,
  sources: TaskSourceSummary[],
): RssTaskDto {
  const config = parseStoredTaskConfig(task.configJson, task.taskKind as RssTaskKind, task.createdAt);

  return {
    id: task.id.toString(),
    seq: task.seq,
    account_id: task.accountId,
    conversation_id: task.conversationId,
    name: task.name,
    task_kind: task.taskKind as RssTaskKind,
    type: task.type as "once" | "recurring",
    cron: task.cron,
    timezone: task.timezone,
    enabled: task.enabled,
    status: task.status,
    last_run_at: task.lastRunAt?.toISOString() ?? null,
    next_run_at: task.nextRunAt?.toISOString() ?? null,
    last_error: task.lastError,
    run_count: task.runCount,
    fail_streak: task.failStreak,
    source_count: sources.length,
    sources,
    max_items: config.maxItems,
    silent_window: config.silentWindow,
    created_after: config.createdAfter,
    created_at: task.createdAt.toISOString(),
    updated_at: task.updatedAt.toISOString(),
  };
}
