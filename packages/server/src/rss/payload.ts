import { validate as validateCron } from "node-cron";
import { MAX_TITLE_LENGTH } from "./constants.js";
import { RssValidationError } from "./errors.js";
import type {
  ParsedTaskPayload,
  RssTaskConfig,
  RssTaskKind,
  SilentWindowConfig,
} from "./types.js";
import {
  defaultMaxItems,
  isRecord,
  parseSilentWindow,
  truncateText,
  MAX_TASK_ITEMS,
} from "./utils.js";

export function parseSourcePayload(payload: unknown, mode: "create" | "update") {
  if (!isRecord(payload)) {
    throw new RssValidationError("request body must be a JSON object");
  }

  const sourceType = payload.source_type;
  const name = payload.name;
  const routePath = payload.route_path;
  const feedUrl = payload.feed_url;
  const description = payload.description;
  const enabled = payload.enabled;

  if (mode === "create") {
    if (typeof name !== "string" || !name.trim()) {
      throw new RssValidationError("name is required");
    }
    if (sourceType !== "rsshub_route" && sourceType !== "rss_url") {
      throw new RssValidationError("source_type must be rsshub_route or rss_url");
    }
  }

  if (sourceType !== undefined && sourceType !== "rsshub_route" && sourceType !== "rss_url") {
    throw new RssValidationError("source_type must be rsshub_route or rss_url");
  }

  if (routePath !== undefined && routePath !== null && typeof routePath !== "string") {
    throw new RssValidationError("route_path must be a string or null");
  }

  if (feedUrl !== undefined && feedUrl !== null && typeof feedUrl !== "string") {
    throw new RssValidationError("feed_url must be a string or null");
  }

  if (description !== undefined && description !== null && typeof description !== "string") {
    throw new RssValidationError("description must be a string or null");
  }

  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new RssValidationError("enabled must be a boolean");
  }

  return {
    ...(typeof name === "string"
      ? { name: truncateText(name.trim(), MAX_TITLE_LENGTH) }
      : {}),
    ...(sourceType !== undefined ? { sourceType } : {}),
    ...(typeof routePath === "string" || routePath === null
      ? { routePath: routePath?.trim() ? routePath.trim() : null }
      : {}),
    ...(typeof feedUrl === "string" || feedUrl === null
      ? { feedUrl: feedUrl?.trim() ? feedUrl.trim() : null }
      : {}),
    ...(typeof description === "string" || description === null
      ? { description: description?.trim() ? truncateText(description.trim(), 240) : null }
      : {}),
    ...(enabled !== undefined ? { enabled } : {}),
  };
}

export function parseTaskPayload(
  payload: unknown,
  mode: "create" | "update",
): ParsedTaskPayload {
  if (!isRecord(payload)) {
    throw new RssValidationError("request body must be a JSON object");
  }

  const accountId = payload.account_id;
  const name = payload.name;
  const taskKind = payload.task_kind;
  const cron = payload.cron;
  const timezone = payload.timezone;
  const sourceIds = payload.source_ids;
  const maxItems = payload.max_items;
  const type = payload.type;
  const enabled = payload.enabled;
  const silentWindow = payload.silent_window;

  if (mode === "create") {
    if (typeof accountId !== "string" || !accountId.trim()) {
      throw new RssValidationError("account_id is required");
    }
    if (typeof name !== "string" || !name.trim()) {
      throw new RssValidationError("name is required");
    }
    if (taskKind !== "rss_digest" && taskKind !== "rss_brief") {
      throw new RssValidationError("task_kind must be rss_digest or rss_brief");
    }
    if (typeof cron !== "string" || !validateCron(cron)) {
      throw new RssValidationError("cron must be a valid cron expression");
    }
    if (!Array.isArray(sourceIds) || sourceIds.length === 0) {
      throw new RssValidationError("source_ids must be a non-empty array");
    }
  }

  if (cron !== undefined && (typeof cron !== "string" || !validateCron(cron))) {
    throw new RssValidationError("cron must be a valid cron expression");
  }

  if (taskKind !== undefined && taskKind !== "rss_digest" && taskKind !== "rss_brief") {
    throw new RssValidationError("task_kind must be rss_digest or rss_brief");
  }

  if (type !== undefined && type !== "once" && type !== "recurring") {
    throw new RssValidationError("type must be once or recurring");
  }

  if (timezone !== undefined && typeof timezone !== "string") {
    throw new RssValidationError("timezone must be a string");
  }

  if (enabled !== undefined && typeof enabled !== "boolean") {
    throw new RssValidationError("enabled must be a boolean");
  }

  const normalizedSourceIds =
    sourceIds === undefined
      ? undefined
      : Array.isArray(sourceIds)
        ? [...new Set(sourceIds.map((item) => String(item)).filter(Boolean))]
        : null;

  if (sourceIds !== undefined && (!normalizedSourceIds || normalizedSourceIds.length === 0)) {
    throw new RssValidationError("source_ids must be a non-empty array");
  }

  if (
    maxItems !== undefined &&
    (typeof maxItems !== "number" ||
      !Number.isInteger(maxItems) ||
      maxItems < 1 ||
      maxItems > MAX_TASK_ITEMS)
  ) {
    throw new RssValidationError(`max_items must be an integer between 1 and ${MAX_TASK_ITEMS}`);
  }

  return {
    ...(accountId !== undefined ? { accountId: String(accountId).trim() } : {}),
    ...(name !== undefined ? { name: truncateText(String(name).trim(), MAX_TITLE_LENGTH) } : {}),
    ...(taskKind !== undefined ? { taskKind: taskKind as RssTaskKind } : {}),
    ...(cron !== undefined ? { cron } : {}),
    ...(timezone !== undefined ? { timezone: String(timezone).trim() || "Asia/Shanghai" } : {}),
    ...(Array.isArray(normalizedSourceIds) ? { sourceIds: normalizedSourceIds } : {}),
    ...(typeof maxItems === "number" ? { maxItems } : {}),
    ...(type !== undefined ? { type: type as "once" | "recurring" } : {}),
    ...(enabled !== undefined ? { enabled } : {}),
    ...(silentWindow !== undefined ? { silentWindow: parseSilentWindow(silentWindow) } : {}),
  };
}

export function parseStoredTaskConfig(
  configJson: Record<string, unknown>,
  taskKind: RssTaskKind,
  createdAt: Date,
): RssTaskConfig {
  const sourceIds = Array.isArray(configJson.sourceIds)
    ? [...new Set(configJson.sourceIds.map((item) => String(item)).filter(Boolean))]
    : [];

  if (sourceIds.length === 0) {
    throw new RssValidationError("rss task is missing source ids");
  }

  const maxItems =
    typeof configJson.maxItems === "number" && Number.isInteger(configJson.maxItems)
      ? Math.min(MAX_TASK_ITEMS, Math.max(1, configJson.maxItems))
      : defaultMaxItems(taskKind);

  return {
    sourceIds,
    maxItems,
    silentWindow: parseSilentWindow(configJson.silentWindow ?? null),
    createdAfter:
      typeof configJson.createdAfter === "string" && configJson.createdAfter
        ? configJson.createdAfter
        : createdAt.toISOString(),
  };
}

export function buildTaskConfig(
  taskKind: RssTaskKind,
  sourceIds: string[],
  maxItems: number | undefined,
  silentWindow: SilentWindowConfig | null | undefined,
  createdAfter: string,
): RssTaskConfig {
  return {
    sourceIds,
    maxItems: maxItems ?? defaultMaxItems(taskKind),
    silentWindow: silentWindow ?? null,
    createdAfter,
  };
}
