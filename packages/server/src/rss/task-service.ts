import { chat, type ScheduledTaskHandlerPort, type ScheduledTaskHandlerResult, type ScheduledTaskRow } from "@clawbot/agent";
import { getPrisma } from "../db/prisma.js";
import { sendProactiveMessage } from "../proactive-push.js";
import { TASK_ENTRY_QUERY_LIMIT } from "./constants.js";
import { RssNotFoundError, RssValidationError } from "./errors.js";
import { buildTaskConfig, parseStoredTaskConfig, parseTaskPayload } from "./payload.js";
import { serializePreviewItem, serializeTask } from "./serialization.js";
import type {
  EntryRecord,
  RssTaskDto,
  RssTaskKind,
  RssTaskPreviewDto,
  RssSourceStatus,
  SourceRecord,
  TaskSourceSummary,
} from "./types.js";
import { collectSource } from "./source-service.js";
import { isInSilentWindow, sanitizeStructuredText, sanitizeText, toInputJsonValue } from "./utils.js";

async function resolvePushConversationId(accountId: string): Promise<string> {
  const candidate = await getPrisma().conversation.findFirst({
    where: {
      accountId,
      contextToken: { not: null },
    },
    orderBy: [{ lastMessageAt: "desc" }, { createdAt: "desc" }],
    select: { conversationId: true },
  });
  if (!candidate) {
    throw new RssValidationError("account has no active conversation for proactive push");
  }

  return candidate.conversationId;
}

async function assertSourceIdsExist(sourceIds: string[]): Promise<bigint[]> {
  const ids = sourceIds.map((value) => BigInt(value));
  const found = await getPrisma().rssSource.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });

  if (found.length !== ids.length) {
    throw new RssValidationError("one or more source_ids do not exist");
  }

  return ids;
}

async function collectSourcesForTask(sourceIds: string[]): Promise<void> {
  const sources = (await getPrisma().rssSource.findMany({
    where: { id: { in: sourceIds.map((id) => BigInt(id)) } },
  })) as SourceRecord[];

  for (const source of sources) {
    try {
      await collectSource(source, false);
    } catch {
      // Use existing pool data when a source temporarily fails.
    }
  }
}

async function unreadEntriesForTask(task: ScheduledTaskRow): Promise<EntryRecord[]> {
  const taskKind = task.taskKind as RssTaskKind;
  const config = parseStoredTaskConfig(task.configJson, taskKind, task.createdAt);

  // 核心流程：先补采任务相关的源，再从采集池中过滤“该账号尚未投递”的候选内容。
  await collectSourcesForTask(config.sourceIds);

  const rows = (await getPrisma().rssEntry.findMany({
    where: {
      sourceId: { in: config.sourceIds.map((value) => BigInt(value)) },
      collectedAt: { gt: new Date(config.createdAfter) },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ publishedAt: "desc" }, { collectedAt: "desc" }, { id: "desc" }],
    take: TASK_ENTRY_QUERY_LIMIT,
  })) as EntryRecord[];

  const byFingerprint = new Map<string, EntryRecord>();
  for (const row of rows) {
    if (!byFingerprint.has(row.fingerprint)) {
      byFingerprint.set(row.fingerprint, row);
    }
  }

  const candidates = [...byFingerprint.values()];
  if (candidates.length === 0) {
    return [];
  }

  const delivered = await getPrisma().rssDelivery.findMany({
    where: {
      accountId: task.accountId,
      fingerprint: { in: candidates.map((item) => item.fingerprint) },
    },
    select: { fingerprint: true },
  });
  const deliveredSet = new Set(delivered.map((item) => item.fingerprint));

  return candidates.filter((item) => !deliveredSet.has(item.fingerprint));
}

function formatBriefMessage(task: ScheduledTaskRow, entries: EntryRecord[]): string {
  const lines = [`【${task.name}】`];

  for (const [index, entry] of entries.entries()) {
    const contentText = sanitizeStructuredText(entry.contentText);

    lines.push(`${index + 1}. ${entry.title}`);
    if (contentText) {
      lines.push(contentText);
    }
    if (entry.normalizedLink ?? entry.rawLink) {
      lines.push(`链接：${entry.normalizedLink ?? entry.rawLink}`);
    }
    if (index < entries.length - 1) {
      lines.push("");
    }
  }

  return lines.join("\n");
}

async function formatDigestMessage(task: ScheduledTaskRow, entries: EntryRecord[]): Promise<string> {
  const promptParts = entries.map((entry, index) => {
    const summaryText = sanitizeText(entry.summaryText);
    const contentText = sanitizeStructuredText(entry.contentText);

    return [
      `[${index + 1}] ${entry.title}`,
      summaryText ? `摘要：${summaryText}` : null,
      contentText ? `正文摘录：${contentText}` : null,
      entry.normalizedLink ?? entry.rawLink ? `原文：${entry.normalizedLink ?? entry.rawLink}` : null,
    ]
      .filter(Boolean)
      .join("\n");
  });

  const response = await chat(
    task.accountId,
    `rss-digest:${task.id.toString()}:${Date.now()}`,
    [
      "你是一个运营消息摘要助手。",
      "请根据下面给出的 RSS 条目，生成一条适合直接发送到微信会话的中文摘要消息。",
      "要求：",
      "1. 先给出一句总览标题。",
      "2. 用 3 到 6 条要点总结最重要的新信息。",
      "3. 不要编造信息，只能基于提供的条目内容。",
      "4. 每条要点尽量简洁，整体控制在 700 汉字以内。",
      "5. 末尾附上“延伸阅读”列表，每行一个“标题：链接”。",
      "",
      "条目如下：",
      promptParts.join("\n\n"),
    ].join("\n"),
  );

  const text = response.text?.trim();
  if (!text) {
    throw new Error("digest model returned empty text");
  }

  return text;
}

async function markEntriesDelivered(task: ScheduledTaskRow, entries: EntryRecord[]): Promise<void> {
  if (entries.length === 0) {
    return;
  }

  await getPrisma().rssDelivery.createMany({
    data: entries.map((entry) => ({
      accountId: task.accountId,
      fingerprint: entry.fingerprint,
      taskId: task.id,
      entryId: entry.id,
    })),
    skipDuplicates: true,
  });
}

async function getRssTaskRow(
  accountId: string,
  seq: number,
): Promise<{ task: ScheduledTaskRow; sources: TaskSourceSummary[] }> {
  const row = await getPrisma().scheduledTask.findFirst({
    where: {
      accountId,
      seq,
      taskKind: { in: ["rss_digest", "rss_brief"] },
    },
    include: {
      rssSources: {
        include: {
          source: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!row) {
    throw new RssNotFoundError("RSS task not found");
  }

  return {
    task: row as unknown as ScheduledTaskRow,
    sources: row.rssSources.map((item) => ({
      id: item.source.id.toString(),
      name: item.source.name,
      status: item.source.status as RssSourceStatus,
    })),
  };
}

export async function executeRssTask(
  task: ScheduledTaskRow,
): Promise<ScheduledTaskHandlerResult> {
  const entries = await unreadEntriesForTask(task);
  const config = parseStoredTaskConfig(task.configJson, task.taskKind as RssTaskKind, task.createdAt);

  if (entries.length === 0) {
    return {
      status: "skipped",
      prompt: task.prompt,
      result: "本次无新内容",
      pushed: false,
    };
  }

  if (isInSilentWindow(config.silentWindow, task.timezone)) {
    return {
      status: "skipped",
      prompt: task.prompt,
      result: `当前处于静默时段，累计 ${entries.length} 条新内容，等待下一个非静默周期补发。`,
      pushed: false,
    };
  }

  const selected = entries.slice(0, config.maxItems);
  const dropped = entries.slice(config.maxItems);
  const content =
    task.taskKind === "rss_digest"
      ? await formatDigestMessage(task, selected)
      : formatBriefMessage(task, selected);

  // 核心流程：先选出本次要发的内容，再发送，并把已发送和超限丢弃的内容统一记为已处理。
  const conversationId = await resolvePushConversationId(task.accountId);
  if (conversationId !== task.conversationId) {
    await getPrisma().scheduledTask.update({
      where: { id: task.id },
      data: { conversationId },
    });
  }

  await sendProactiveMessage(task.accountId, conversationId, content);
  await markEntriesDelivered(task, [...selected, ...dropped]);

  return {
    status: "success",
    prompt: task.prompt,
    result: content,
    pushed: true,
  };
}

export function createRssScheduledTaskHandler(): ScheduledTaskHandlerPort {
  return {
    async execute(task) {
      if (task.taskKind !== "rss_digest" && task.taskKind !== "rss_brief") {
        return null;
      }

      return executeRssTask(task);
    },
  };
}

export async function listTasks(accountId?: string): Promise<RssTaskDto[]> {
  const rows = await getPrisma().scheduledTask.findMany({
    where: {
      taskKind: { in: ["rss_digest", "rss_brief"] },
      ...(accountId ? { accountId } : {}),
    },
    include: {
      rssSources: {
        include: {
          source: {
            select: {
              id: true,
              name: true,
              status: true,
            },
          },
        },
      },
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
  });

  return rows.map((row) =>
      serializeTask(
        row as unknown as ScheduledTaskRow,
        row.rssSources.map((item) => ({
          id: item.source.id.toString(),
          name: item.source.name,
          status: item.source.status as RssSourceStatus,
        })),
      ),
    );
}

export async function createTask(payload: unknown): Promise<RssTaskDto> {
  const input = parseTaskPayload(payload, "create");
  const { accountId, name, taskKind, cron, sourceIds } = input;
  if (!accountId || !name || !taskKind || !cron || !sourceIds) {
    throw new RssValidationError("account_id, name, task_kind, cron, and source_ids are required");
  }

  const sourceIdRows = await assertSourceIdsExist(sourceIds);
  const conversationId = await resolvePushConversationId(accountId);
  const createdAfter = new Date().toISOString();
  const config = buildTaskConfig(
    taskKind,
    sourceIds,
    input.maxItems,
    input.silentWindow,
    createdAfter,
  );

  const taskId = await getPrisma().$transaction(async (tx) => {
    const last = await tx.scheduledTask.findFirst({
      where: { accountId },
      orderBy: { seq: "desc" },
      select: { seq: true },
    });
    const seq = (last?.seq ?? 0) + 1;
    const task = await tx.scheduledTask.create({
      data: {
        accountId,
        conversationId,
        seq,
        name,
        prompt: taskKind === "rss_digest" ? "RSS 摘要任务" : "RSS 快讯任务",
        taskKind,
        configJson: toInputJsonValue(config),
        type: input.type ?? "recurring",
        cron,
        timezone: input.timezone ?? "Asia/Shanghai",
        enabled: input.enabled ?? true,
      },
    });

    await tx.rssTaskSource.createMany({
      data: sourceIdRows.map((sourceId) => ({ taskId: task.id, sourceId })),
      skipDuplicates: true,
    });

    return task.id;
  });

  const row = await getPrisma().scheduledTask.findUnique({
    where: { id: taskId },
    include: {
      rssSources: {
        include: {
          source: { select: { id: true, name: true, status: true } },
        },
      },
    },
  });

  if (!row) {
    throw new RssNotFoundError("RSS task not found after creation");
  }

  return serializeTask(
    row as unknown as ScheduledTaskRow,
    row.rssSources.map((item) => ({
      id: item.source.id.toString(),
      name: item.source.name,
      status: item.source.status as RssSourceStatus,
    })),
  );
}

export async function updateTask(
  accountId: string,
  seq: number,
  payload: unknown,
): Promise<RssTaskDto> {
  const current = await getRssTaskRow(accountId, seq);
  const input = parseTaskPayload(payload, "update");
  const nextTaskKind: RssTaskKind = input.taskKind ?? (current.task.taskKind as RssTaskKind);
  const nextSourceIds = input.sourceIds ?? current.sources.map((source) => source.id);
  const sourceIds = await assertSourceIdsExist(nextSourceIds);
  const currentConfig = parseStoredTaskConfig(
    current.task.configJson,
    current.task.taskKind as RssTaskKind,
    current.task.createdAt,
  );
  const nextConfig = buildTaskConfig(
    nextTaskKind,
    nextSourceIds,
    input.maxItems ?? currentConfig.maxItems,
    input.silentWindow ?? currentConfig.silentWindow,
    currentConfig.createdAfter,
  );

  await getPrisma().$transaction(async (tx) => {
    await tx.scheduledTask.update({
      where: { id: current.task.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.taskKind !== undefined ? { taskKind: input.taskKind } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.cron !== undefined ? { cron: input.cron } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
        configJson: toInputJsonValue(nextConfig),
      },
    });

    if (input.sourceIds !== undefined) {
      await tx.rssTaskSource.deleteMany({ where: { taskId: current.task.id } });
      await tx.rssTaskSource.createMany({
        data: sourceIds.map((sourceId) => ({ taskId: current.task.id, sourceId })),
        skipDuplicates: true,
      });
    }
  });

  const next = await getRssTaskRow(accountId, seq);
  return serializeTask(next.task, next.sources);
}

export async function deleteTask(accountId: string, seq: number): Promise<void> {
  const current = await getRssTaskRow(accountId, seq);
  await getPrisma().scheduledTask.delete({ where: { id: current.task.id } });
}

export async function previewTask(accountId: string, seq: number): Promise<RssTaskPreviewDto> {
  const { task, sources } = await getRssTaskRow(accountId, seq);
  const entries = await unreadEntriesForTask(task);
  const config = parseStoredTaskConfig(task.configJson, task.taskKind as RssTaskKind, task.createdAt);
  const selected = entries.slice(0, config.maxItems);
  const dropped = Math.max(0, entries.length - selected.length);
  const suppressed = isInSilentWindow(config.silentWindow, task.timezone);

  let content: string | null = null;
  let reason: string | null = null;

  if (entries.length === 0) {
    reason = "本次无新内容";
  } else if (suppressed) {
    reason = `当前处于静默时段，已有 ${entries.length} 条内容等待补发。`;
  } else {
    content =
      task.taskKind === "rss_digest"
        ? await formatDigestMessage(task, selected)
        : formatBriefMessage(task, selected);
  }

  return {
    task: serializeTask(task, sources),
    would_send: Boolean(content),
    suppressed,
    reason,
    item_count: entries.length,
    dropped_count: dropped,
    content,
    items: selected.map(serializePreviewItem),
  };
}

export async function getTaskRuntime(
  accountId: string,
  seq: number,
): Promise<ScheduledTaskRow> {
  const { task } = await getRssTaskRow(accountId, seq);
  return task;
}
