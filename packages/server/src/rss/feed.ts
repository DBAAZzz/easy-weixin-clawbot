import type { AppSettingsRow } from "../db/app-settings-store.js";
import {
  MAX_CONTENT_LENGTH,
  MAX_SUMMARY_LENGTH,
  MAX_TITLE_LENGTH,
  RSS_USER_AGENT,
  xmlParser,
} from "./constants.js";
import { RssValidationError } from "./errors.js";
import type { ParsedFeedItem, SourceRecord } from "./types.js";
import {
  asArray,
  coerceText,
  createFingerprint,
  getRecord,
  normalizeLink,
  parseIsoDate,
  sanitizeStructuredText,
  sanitizeText,
  truncateText,
  isRecord,
} from "./utils.js";

export function resolveRssSourceUrl(source: SourceRecord, settings: AppSettingsRow): string {
  if (source.sourceType === "rss_url") {
    if (!source.feedUrl) {
      throw new RssValidationError("RSS URL source is missing feed_url");
    }
    return source.feedUrl;
  }

  if (!source.routePath) {
    throw new RssValidationError("RSSHub route source is missing route_path");
  }
  if (!settings.rsshubBaseUrl) {
    throw new RssValidationError("rsshub_base_url is not configured");
  }

  return new URL(
    source.routePath.startsWith("/") ? source.routePath.slice(1) : source.routePath,
    `${settings.rsshubBaseUrl.replace(/\/$/, "")}/`,
  ).toString();
}

export function createSourceHeaders(
  source: SourceRecord,
  settings: AppSettingsRow,
): HeadersInit {
  const headers: Record<string, string> = {
    accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.8",
    "user-agent": RSS_USER_AGENT,
  };

  if (source.sourceType === "rsshub_route") {
    if (settings.rsshubAuthType === "basic" && settings.rsshubUsername && settings.rsshubPassword) {
      headers.authorization = `Basic ${Buffer.from(`${settings.rsshubUsername}:${settings.rsshubPassword}`).toString("base64")}`;
    }

    if (settings.rsshubAuthType === "bearer" && settings.rsshubBearerToken) {
      headers.authorization = `Bearer ${settings.rsshubBearerToken}`;
    }
  }

  return headers;
}

export async function fetchFeedBody(
  source: SourceRecord,
  settings: AppSettingsRow,
): Promise<{ body: string; url: string }> {
  const url = resolveRssSourceUrl(source, settings);
  const response = await fetch(url, {
    headers: createSourceHeaders(source, settings),
    signal: AbortSignal.timeout(settings.rssRequestTimeoutMs),
  });

  if (!response.ok) {
    throw new Error(`feed request failed with status ${response.status}`);
  }

  return {
    body: await response.text(),
    url,
  };
}

function extractLinkValue(value: unknown): string | null {
  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const candidate = extractLinkValue(item);
      if (candidate) return candidate;
    }
    return null;
  }

  if (isRecord(value)) {
    if (typeof value.href === "string") {
      return value.href;
    }

    if (typeof value.url === "string") {
      return value.url;
    }

    return coerceText(value);
  }

  return null;
}

function extractMedia(value: unknown): Array<Record<string, string | null>> {
  const records: Array<Record<string, string | null>> = [];

  for (const item of asArray(value)) {
    const record = getRecord(item);
    if (!record) continue;
    const url =
      typeof record.url === "string"
        ? record.url
        : typeof record.href === "string"
          ? record.href
          : null;
    if (!url) continue;

    records.push({
      url,
      type: typeof record.type === "string" ? record.type : null,
      title: typeof record.title === "string" ? record.title : null,
      description: typeof record.description === "string" ? record.description : null,
    });
  }

  return records;
}

function normalizeParsedItem(item: Record<string, unknown>): ParsedFeedItem | null {
  const rawTitle = coerceText(item.title) ?? coerceText(item["media:title"]);
  const rawLink = extractLinkValue(item.link) ?? extractLinkValue(item.guid) ?? extractLinkValue(item.id);
  const normalizedTitle = sanitizeText(rawTitle);

  if (!normalizedTitle && !rawLink) {
    return null;
  }

  const publishedAt =
    parseIsoDate(coerceText(item.pubDate)) ??
    parseIsoDate(coerceText(item.published)) ??
    parseIsoDate(coerceText(item.updated)) ??
    parseIsoDate(coerceText(item["dc:date"]));

  const rawGuid = coerceText(item.guid) ?? coerceText(item.id);
  const normalizedLink = normalizeLink(rawLink);
  // 采集池同时保留两层内容：contentHtml 给预览富文本使用，contentText 给推送和模型消费。
  const summaryHtml =
    coerceText(item.description) ?? coerceText(item.summary) ?? coerceText(item.subtitle);
  const contentHtml = coerceText(item["content:encoded"]) ?? coerceText(item.content) ?? summaryHtml;
  const summaryText = sanitizeText(summaryHtml);
  const contentText = sanitizeStructuredText(contentHtml ?? summaryText);
  const title = truncateText(normalizedTitle ?? normalizedLink ?? "未命名条目", MAX_TITLE_LENGTH);
  const mediaJson = [
    ...extractMedia(item.enclosure),
    ...extractMedia(item["media:content"]),
    ...extractMedia(item["media:thumbnail"]),
    ...extractMedia(item["itunes:image"]),
  ];

  return {
    fingerprint: createFingerprint(rawGuid, normalizedLink, title, publishedAt),
    guid: rawGuid,
    rawLink,
    normalizedLink,
    title,
    author: sanitizeText(coerceText(item.author) ?? coerceText(item["dc:creator"])),
    publishedAt,
    summaryText: summaryText ? truncateText(summaryText, MAX_SUMMARY_LENGTH) : null,
    contentText: contentText ? truncateText(contentText, MAX_CONTENT_LENGTH) : null,
    mediaJson,
    metaJson: contentHtml ? { contentHtml } : {},
  };
}

export function parseFeedItems(xml: string): ParsedFeedItem[] {
  const parsed = xmlParser.parse(xml) as Record<string, unknown>;
  const rssChannel = getRecord(getRecord(parsed.rss)?.channel);
  const atomFeed = getRecord(parsed.feed);
  const sourceItems = rssChannel ? asArray(rssChannel.item) : atomFeed ? asArray(atomFeed.entry) : [];

  const items = sourceItems
    .map((item) => normalizeParsedItem(getRecord(item) ?? {}))
    .filter((item): item is ParsedFeedItem => item !== null);

  const deduped = new Map<string, ParsedFeedItem>();
  for (const item of items) {
    if (!deduped.has(item.fingerprint)) {
      deduped.set(item.fingerprint, item);
    }
  }

  return [...deduped.values()];
}
