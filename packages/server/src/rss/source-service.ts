import { appSettingsStore } from "../db/app-settings-store.js";
import { getPrisma } from "../db/prisma.js";
import { createModuleLogger, getErrorFields } from "../logger.js";
import { SOURCE_PREVIEW_LIMIT, ENTRY_RETENTION_DAYS } from "./constants.js";
import { RssNotFoundError, RssValidationError } from "./errors.js";
import { fetchFeedBody, parseFeedItems, resolveRssSourceUrl } from "./feed.js";
import { parseSourcePayload } from "./payload.js";
import {
  serializePreviewItem,
  serializePreviewSource,
  serializeSource,
} from "./serialization.js";
import type {
  EntryRecord,
  ParsedFeedItem,
  RssConnectionTestDto,
  RssSourceDto,
  RssSourcePreviewDto,
  RssSourceStatus,
  SourceRecord,
} from "./types.js";
import {
  backoffDelayMs,
  buildSourceErrorMessage,
  shouldCollectSource,
  sourceToRecord,
  toInputJsonValue,
} from "./utils.js";

const rssLogger = createModuleLogger("rss");

type PreviewSourceRecord = Pick<SourceRecord, "id" | "name">;

async function getSourceRecordOrThrow(id: bigint): Promise<SourceRecord> {
  const source = await getPrisma().rssSource.findUnique({ where: { id } });
  if (!source) {
    throw new RssNotFoundError("RSS source not found");
  }

  return sourceToRecord(source as SourceRecord);
}

async function getPreviewSourceRecordOrThrow(id: bigint): Promise<PreviewSourceRecord> {
  const source = await getPrisma().rssSource.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
    },
  });
  if (!source) {
    throw new RssNotFoundError("RSS source not found");
  }

  return source;
}

async function sourceCounts(
  sourceId: bigint,
): Promise<{ referencedTaskCount: number; recentItemCount: number }> {
  const [referencedTaskCount, recentItemCount] = await Promise.all([
    getPrisma().rssTaskSource.count({ where: { sourceId } }),
    getPrisma().rssEntry.count({
      where: {
        sourceId,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    }),
  ]);

  return { referencedTaskCount, recentItemCount };
}

async function serializeSourceById(id: bigint): Promise<RssSourceDto> {
  const source = await getSourceRecordOrThrow(id);
  const counts = await sourceCounts(id);
  return serializeSource(source, counts.referencedTaskCount, counts.recentItemCount);
}

async function persistCollectedItems(sourceId: bigint, items: ParsedFeedItem[]): Promise<void> {
  const expiresAt = new Date(Date.now() + ENTRY_RETENTION_DAYS * 24 * 60 * 60 * 1000);

  for (const item of items) {
    await getPrisma().rssEntry.upsert({
      where: {
        sourceId_fingerprint: {
          sourceId,
          fingerprint: item.fingerprint,
        },
      },
      create: {
        sourceId,
        fingerprint: item.fingerprint,
        guid: item.guid,
        rawLink: item.rawLink,
        normalizedLink: item.normalizedLink,
        title: item.title,
        author: item.author,
        publishedAt: item.publishedAt,
        summaryText: item.summaryText,
        contentText: item.contentText,
        mediaJson: toInputJsonValue(item.mediaJson),
        metaJson: toInputJsonValue(item.metaJson),
        expiresAt,
      },
      update: {
        guid: item.guid,
        rawLink: item.rawLink,
        normalizedLink: item.normalizedLink,
        title: item.title,
        author: item.author,
        publishedAt: item.publishedAt,
        summaryText: item.summaryText,
        contentText: item.contentText,
        mediaJson: toInputJsonValue(item.mediaJson),
        metaJson: toInputJsonValue(item.metaJson),
        expiresAt,
      },
    });
  }
}

export async function collectSource(
  source: SourceRecord,
  force = false,
): Promise<{ url: string; items: ParsedFeedItem[] }> {
  const now = new Date();
  const settings = await appSettingsStore.get();

  if (!force && !shouldCollectSource(source, now)) {
    return { url: resolveRssSourceUrl(source, settings), items: [] };
  }

  try {
    // 核心流程：按源配置拉取 feed、解析条目并写入采集池。
    const { body, url } = await fetchFeedBody(source, settings);
    const items = parseFeedItems(body);
    await persistCollectedItems(source.id, items);

    await getPrisma().rssSource.update({
      where: { id: source.id },
      data: {
        status: source.enabled ? "normal" : "disabled",
        lastFetchedAt: now,
        lastSuccessAt: now,
        lastError: null,
        failureStreak: 0,
        backoffUntil: null,
      },
    });

    return { url, items };
  } catch (error) {
    const nextFailureStreak = source.failureStreak + 1;
    const status: RssSourceStatus = !source.enabled
      ? "disabled"
      : nextFailureStreak >= 10
        ? "error"
        : nextFailureStreak >= 3
          ? "backoff"
          : "normal";

    await getPrisma().rssSource.update({
      where: { id: source.id },
      data: {
        status,
        lastFetchedAt: now,
        lastError: buildSourceErrorMessage(error),
        failureStreak: nextFailureStreak,
        backoffUntil:
          status === "backoff" ? new Date(now.getTime() + backoffDelayMs(nextFailureStreak)) : null,
      },
    });

    rssLogger.warn(
      {
        ...getErrorFields(error),
        sourceId: source.id.toString(),
        sourceName: source.name,
      },
      "RSS source collect failed",
    );
    throw error;
  }
}

async function latestSourceEntries(
  sourceId: bigint,
  limit = SOURCE_PREVIEW_LIMIT,
): Promise<EntryRecord[]> {
  const rows = await getPrisma().rssEntry.findMany({
    where: {
      sourceId,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ collectedAt: "desc" }, { id: "desc" }],
    take: limit,
  });

  return rows as EntryRecord[];
}

async function buildSourcePreview(
  source: PreviewSourceRecord,
): Promise<RssSourcePreviewDto> {
  const items = await latestSourceEntries(source.id);

  return {
    source: serializePreviewSource(source),
    items: items.map(serializePreviewItem),
  };
}

export async function listSources(): Promise<RssSourceDto[]> {
  const sources = (await getPrisma().rssSource.findMany({
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  })) as SourceRecord[];

  return Promise.all(
    sources.map(async (source) => {
      const counts = await sourceCounts(source.id);
      return serializeSource(source, counts.referencedTaskCount, counts.recentItemCount);
    }),
  );
}

export async function createSource(payload: unknown): Promise<RssSourceDto> {
  const input = parseSourcePayload(payload, "create");
  if (!input.name || !input.sourceType) {
    throw new RssValidationError("name and source_type are required");
  }

  if (input.sourceType === "rsshub_route" && !input.routePath) {
    throw new RssValidationError("route_path is required for rsshub_route sources");
  }

  if (input.sourceType === "rss_url" && !input.feedUrl) {
    throw new RssValidationError("feed_url is required for rss_url sources");
  }

  const source = await getPrisma().rssSource.create({
    data: {
      name: input.name,
      sourceType: input.sourceType,
      routePath: input.routePath ?? null,
      feedUrl: input.feedUrl ?? null,
      description: input.description ?? null,
      enabled: input.enabled ?? true,
      status: input.enabled === false ? "disabled" : "normal",
    },
  });

  return serializeSourceById(source.id);
}

export async function updateSource(id: string, payload: unknown): Promise<RssSourceDto> {
  const sourceId = BigInt(id);
  const current = await getSourceRecordOrThrow(sourceId);
  const input = parseSourcePayload(payload, "update");

  await getPrisma().rssSource.update({
    where: { id: sourceId },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.sourceType !== undefined ? { sourceType: input.sourceType } : {}),
      ...(input.routePath !== undefined ? { routePath: input.routePath } : {}),
      ...(input.feedUrl !== undefined ? { feedUrl: input.feedUrl } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.enabled !== undefined
        ? {
            enabled: input.enabled,
            status: input.enabled
              ? current.status === "disabled"
                ? "normal"
                : current.status
              : "disabled",
          }
        : {}),
    },
  });

  return serializeSourceById(sourceId);
}

export async function deleteSource(id: string): Promise<void> {
  const sourceId = BigInt(id);
  const referencedTaskCount = await getPrisma().rssTaskSource.count({ where: { sourceId } });
  if (referencedTaskCount > 0) {
    throw new RssValidationError("source is still referenced by RSS tasks");
  }

  await getPrisma().rssSource.delete({ where: { id: sourceId } });
}

export async function previewSource(id: string): Promise<RssSourcePreviewDto> {
  const source = await getPreviewSourceRecordOrThrow(BigInt(id));
  // 预览只读取采集池中的现有内容，不触发新的抓取，避免混淆“看库里已有结果”和“测试拉取”的语义。
  return buildSourcePreview(source);
}

export async function testSource(id: string): Promise<RssSourcePreviewDto> {
  const source = await getSourceRecordOrThrow(BigInt(id));

  // 测试抓取会强制刷新一次源，然后再把最新入库结果返回给前端。
  await collectSource(source, true);
  return buildSourcePreview(source);
}

export async function testSettingsConnection(): Promise<RssConnectionTestDto> {
  const settings = await appSettingsStore.get();
  if (!settings.rsshubBaseUrl) {
    return {
      reachable: false,
      status_code: null,
      latency_ms: null,
      base_url: null,
      message: "rsshub_base_url is not configured",
    };
  }

  const startedAt = Date.now();

  try {
    const response = await fetch(settings.rsshubBaseUrl, {
      headers: {
        accept: "text/html,application/json,*/*",
        "user-agent": "ClawbotRSS/1.0 (+https://clawbot.local)",
      },
      signal: AbortSignal.timeout(settings.rssRequestTimeoutMs),
    });

    return {
      reachable: response.ok,
      status_code: response.status,
      latency_ms: Date.now() - startedAt,
      base_url: settings.rsshubBaseUrl,
      message: response.ok
        ? "RSSHub connection succeeded"
        : `RSSHub returned ${response.status}`,
    };
  } catch (error) {
    return {
      reachable: false,
      status_code: null,
      latency_ms: Date.now() - startedAt,
      base_url: settings.rsshubBaseUrl,
      message: buildSourceErrorMessage(error),
    };
  }
}

export async function collectDueSources(): Promise<void> {
  const sources = (await getPrisma().rssSource.findMany({
    where: { enabled: true },
    orderBy: [{ updatedAt: "asc" }],
  })) as SourceRecord[];
  const now = new Date();

  for (const source of sources) {
    if (!shouldCollectSource(source, now)) {
      continue;
    }

    try {
      await collectSource(source, false);
    } catch {
      // failure handled in collectSource
    }
  }
}

export async function cleanupExpiredEntries(): Promise<number> {
  const result = await getPrisma().rssEntry.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  return result.count;
}
