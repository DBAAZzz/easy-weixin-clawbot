import { createHash, randomUUID } from "node:crypto";
import { PrismaModelConfigStore } from "../db/model-config-store.impl.js";
import { getPrisma } from "../db/prisma.js";
import { createModuleLogger } from "../logger.js";
import { DEMO_MODEL_ID } from "../api/routes/demo-llm.js";
import {
  DEMO_ACCOUNT_PREFIX,
  DEMO_PERSONAS,
  type DemoMessage,
  type DemoPersona,
} from "./demo-data.js";

const demoLogger = createModuleLogger("demo-seed");

const DEMO_TEMPLATE_NAME = "演示模型（本地模拟）";
const DEMO_WEBHOOK_SOURCE = "demo-cms";
/** Plain token for docs/demo scripts; only its SHA-256 is stored. */
export const DEMO_WEBHOOK_TOKEN = "demo-webhook-token";
const DEMO_MCP_SLUG = "demo-filesystem";
const DEMO_RSS_SOURCE_NAMES = ["阮一峰 · 科技爱好者周刊", "Hacker News 热门"];
const GLOBAL_BRANCH = "__global__";

function daysAgoAt(daysAgo: number, hour: number, minute = 0): Date {
  const date = new Date(Date.now() - daysAgo * 86_400_000);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 3_600_000);
}

function messagePayload(message: DemoMessage, at: Date): object {
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: [{ type: "text", text: message.text }],
      timestamp: at.getTime(),
      model: DEMO_MODEL_ID,
      provider: "openai",
      stopReason: "end_turn",
    };
  }
  return { role: "user", content: message.text, timestamp: at.getTime() };
}

async function seedPersonaConversations(prisma: ReturnType<typeof getPrisma>, persona: DemoPersona) {
  await prisma.account.create({
    data: {
      id: persona.accountId,
      displayName: persona.displayName,
      alias: persona.alias,
      createdAt: daysAgoAt(45, 10),
    },
  });

  for (const conversation of persona.conversations) {
    let cursor = daysAgoAt(conversation.startedDaysAgo, 9, 30);
    const rows = conversation.messages.map((message, index) => {
      cursor = new Date(cursor.getTime() + message.gapMin * 60_000);
      return {
        accountId: persona.accountId,
        conversationId: conversation.conversationId,
        seq: index + 1,
        role: message.role,
        contentText: message.text,
        payload: messagePayload(message, cursor),
        createdAt: cursor,
      };
    });

    await prisma.message.createMany({ data: rows });
    await prisma.conversation.create({
      data: {
        accountId: persona.accountId,
        conversationId: conversation.conversationId,
        title: conversation.title,
        messageCount: rows.length,
        contextToken: `demo-ctx-${randomUUID().slice(0, 8)}`,
        createdAt: rows[0].createdAt,
        lastMessageAt: rows[rows.length - 1].createdAt,
      },
    });
  }
}

async function seedPersonaMemory(prisma: ReturnType<typeof getPrisma>, persona: DemoPersona) {
  const factEids: string[] = [];
  const snapshotFacts: Record<string, object> = {};
  const snapshotPreferences: Record<string, object> = {};

  async function recordEntries(
    category: "fact" | "preference",
    items: { key: string; value: string }[],
    store: Record<string, object>,
  ) {
    for (const item of items) {
      const eid = randomUUID();
      const updatedAt = daysAgoAt(7, 12);
      await prisma.tapeEntry.create({
        data: {
          eid,
          accountId: persona.accountId,
          branch: GLOBAL_BRANCH,
          type: "record",
          category,
          payload: {
            fragments: [{ kind: "text", data: { key: item.key, value: item.value, confidence: 0.95 } }],
          },
          actor: `user:${persona.accountId}`,
          source: "chat",
          createdAt: updatedAt,
        },
      });
      factEids.push(eid);
      store[item.key] = {
        key: item.key,
        value: item.value,
        confidence: 0.95,
        sourceEid: eid,
        updatedAt: updatedAt.toISOString(),
      };
    }
  }

  await recordEntries("fact", persona.facts, snapshotFacts);
  await recordEntries("preference", persona.preferences, snapshotPreferences);

  const decisionEids: string[] = [];
  const snapshotDecisions: object[] = [];
  for (const decision of persona.decisions) {
    const eid = randomUUID();
    const createdAt = daysAgoAt(10, 18);
    await prisma.tapeEntry.create({
      data: {
        eid,
        accountId: persona.accountId,
        branch: GLOBAL_BRANCH,
        type: "record",
        category: "decision",
        payload: {
          fragments: [{ kind: "text", data: { description: decision.description, context: decision.context } }],
        },
        actor: `agent:${DEMO_MODEL_ID}`,
        source: "chat",
        createdAt,
      },
    });
    factEids.push(eid);
    decisionEids.push(eid);
    snapshotDecisions.push({
      description: decision.description,
      context: decision.context,
      sourceEid: eid,
      createdAt: createdAt.toISOString(),
    });
  }

  await prisma.tapeAnchor.create({
    data: {
      aid: randomUUID(),
      accountId: persona.accountId,
      branch: GLOBAL_BRANCH,
      anchorType: "checkpoint",
      snapshot: {
        facts: snapshotFacts,
        preferences: snapshotPreferences,
        decisions: snapshotDecisions,
        version: 1,
      },
      manifest: factEids,
      predecessors: [],
      lastEntryEid: factEids[factEids.length - 1] ?? null,
      createdAt: daysAgoAt(6, 9),
    },
  });
}

interface DemoTaskDef {
  personaIndex: number;
  seq: number;
  name: string;
  cron: string;
  prompt: string;
  runCount: number;
  recentRuns: { status: string; result: string; daysAgo: number; pushed: boolean }[];
}

const DEMO_TASKS: DemoTaskDef[] = [
  {
    personaIndex: 0,
    seq: 1,
    name: "早安天气提醒",
    cron: "0 8 * * 1-5",
    prompt: "查询杭州今天的天气，给林夕一条简短的天气和穿衣建议，50 字以内。",
    runCount: 23,
    recentRuns: [
      { status: "success", result: "杭州今天多云 22-28℃，早晚偏凉，建议薄外套；午后紫外线中等，注意防晒。", daysAgo: 1, pushed: true },
      { status: "success", result: "杭州今天小雨，降水概率 70%，出门带伞；气温 20-25℃，体感偏闷。", daysAgo: 2, pushed: true },
      { status: "success", result: "杭州今天晴，21-29℃，适合洗晒；午间较热，注意补水。", daysAgo: 3, pushed: false },
    ],
  },
  {
    personaIndex: 1,
    seq: 1,
    name: "周五内测反馈周报",
    cron: "0 18 * * 5",
    prompt: "汇总 ClawBot 内测群本周的讨论与反馈，按「问题 / 建议 / 表扬」分要点输出周报。",
    runCount: 4,
    recentRuns: [
      {
        status: "success",
        result: "【问题】会话列表加载慢（12 条反馈）；【建议】模型配置支持批量导入、记忆图谱增加说明；【表扬】定时任务提醒准确。",
        daysAgo: 3,
        pushed: true,
      },
      {
        status: "error",
        result: "",
        daysAgo: 10,
        pushed: false,
      },
    ],
  },
  {
    personaIndex: 1,
    seq: 2,
    name: "内测群反馈速览",
    cron: "*/10 * * * *",
    prompt:
      "浏览 ClawBot 内测群最近 10 分钟的新消息。如果有值得记录的反馈，用一句话总结；没有就回复「暂无新反馈」。",
    runCount: 6,
    recentRuns: [
      {
        status: "success",
        result: "暂无新反馈。群内最近 10 分钟没有新消息。",
        daysAgo: 1,
        pushed: false,
      },
    ],
  },
  {
    personaIndex: 2,
    seq: 1,
    name: "晨跑出门提醒",
    cron: "0 6 * * 2,4,6",
    prompt: "提醒晚晚出门晨跑：6 点半滨江跑道南口，和老周约定的时间，注意补水。",
    runCount: 9,
    recentRuns: [
      { status: "success", result: "晚晚早上好，今天跑步日！6 点半滨江跑道南口见，记得带水。", daysAgo: 1, pushed: true },
      { status: "success", result: "晚晚早上好，今天跑步日！6 点半滨江跑道南口见，记得带水。", daysAgo: 3, pushed: true },
    ],
  },
];

async function seedScheduledTasks(prisma: ReturnType<typeof getPrisma>) {
  for (const task of DEMO_TASKS) {
    const accountId = DEMO_PERSONAS[task.personaIndex].accountId;
    const created = await prisma.scheduledTask.create({
      data: {
        accountId,
        conversationId: DEMO_PERSONAS[task.personaIndex].conversations[0].conversationId,
        seq: task.seq,
        name: task.name,
        prompt: task.prompt,
        taskKind: "prompt",
        type: "recurring",
        cron: task.cron,
        timezone: "Asia/Shanghai",
        enabled: false,
        // Not "paused": enabling a task via the API only flips `enabled`, and
        // the scheduler skips firing while status stays "paused".
        status: "idle",
        runCount: task.runCount,
        lastRunAt: daysAgoAt(task.recentRuns[0].daysAgo, 8, 5),
      },
    });

    await prisma.scheduledTaskRun.createMany({
      data: task.recentRuns.map((run) => ({
        taskId: created.id,
        status: run.status,
        prompt: task.prompt,
        result: run.result || null,
        error: run.status === "error" ? "演示数据：模拟一次历史执行失败" : null,
        durationMs: 1_800 + ((run.daysAgo * 370) % 2_400),
        pushed: run.pushed,
        createdAt: daysAgoAt(run.daysAgo, 8, 6),
      })),
    });
  }
}

async function seedRss(prisma: ReturnType<typeof getPrisma>) {
  const weekly = await prisma.rssSource.create({
    data: {
      name: DEMO_RSS_SOURCE_NAMES[0],
      sourceType: "rss_url",
      feedUrl: "https://www.ruanyifeng.com/blog/atom.xml",
      description: "每周五更新：科技动态、工具与读物推荐",
      enabled: false,
      status: "disabled",
      lastFetchedAt: hoursAgo(30),
      lastSuccessAt: hoursAgo(30),
    },
  });
  await prisma.rssSource.create({
    data: {
      name: DEMO_RSS_SOURCE_NAMES[1],
      sourceType: "rsshub_route",
      routePath: "/hackernews/best",
      description: "Hacker News 热门（经 RSSHub 转换）",
      enabled: false,
      status: "disabled",
    },
  });

  await prisma.rssEntry.createMany({
    data: [
      {
        sourceId: weekly.id,
        fingerprint: "demo-fp-weekly-241",
        guid: "demo-weekly-241",
        rawLink: "https://www.ruanyifeng.com/blog/2026/08/weekly-issue-241.html",
        normalizedLink: "https://www.ruanyifeng.com/blog/2026/08/weekly-issue-241.html",
        title: "科技爱好者周刊（第 241 期）：工具的复利效应",
        author: "阮一峰",
        publishedAt: daysAgoAt(8, 12),
        summaryText: "本期话题：为什么坚持使用同一个工具会产生复利；另推荐 6 个新工具和 4 条资源。",
        collectedAt: daysAgoAt(8, 13),
      },
      {
        sourceId: weekly.id,
        fingerprint: "demo-fp-weekly-240",
        guid: "demo-weekly-240",
        rawLink: "https://www.ruanyifeng.com/blog/2026/08/weekly-issue-240.html",
        normalizedLink: "https://www.ruanyifeng.com/blog/2026/08/weekly-issue-240.html",
        title: "科技爱好者周刊（第 240 期）：个人网站的复兴",
        author: "阮一峰",
        publishedAt: daysAgoAt(15, 12),
        summaryText: "越来越多开发者重新回到个人网站，本期讨论其原因与建站工具。",
        collectedAt: daysAgoAt(15, 13),
      },
    ],
  });
}

async function seedWebhook(prisma: ReturnType<typeof getPrisma>) {
  const accountId = DEMO_PERSONAS[0].accountId;
  const token = await prisma.webhookToken.create({
    data: {
      source: DEMO_WEBHOOK_SOURCE,
      tokenHash: createHash("sha256").update(DEMO_WEBHOOK_TOKEN).digest("hex"),
      tokenPrefix: DEMO_WEBHOOK_TOKEN.slice(0, 10),
      description: "演示：CMS 文章发布通知（配套令牌见演示文档）",
      enabled: true,
      lastUsedAt: hoursAgo(26),
    },
  });
  await prisma.webhookAccountPermission.create({ data: { tokenId: token.id, accountId } });
  await prisma.webhookLog.createMany({
    data: [
      {
        tokenId: token.id,
        accountId,
        conversationId: DEMO_PERSONAS[0].conversations[0].conversationId,
        content: "【CMS】新文章已发布：《用 ClawBot 管理你的微信机器人》",
        status: "success",
        createdAt: hoursAgo(26),
      },
      {
        tokenId: token.id,
        accountId,
        conversationId: "demo-wxid-unknown",
        content: "【CMS】新文章已发布：《本周更新日志》",
        status: "rejected",
        error: "conversation_not_found",
        createdAt: hoursAgo(50),
      },
    ],
  });
}

async function seedMcpServer(prisma: ReturnType<typeof getPrisma>) {
  const server = await prisma.mcpServer.create({
    data: {
      name: "演示 · 文件系统",
      slug: DEMO_MCP_SLUG,
      transport: "stdio",
      command: "npx",
      argsJson: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/clawbot-demo"],
      envJson: {},
      enabled: false,
      status: "disconnected",
    },
  });
  await prisma.mcpTool.createMany({
    data: [
      {
        serverId: server.id,
        remoteName: "list_directory",
        localName: "demo_list_directory",
        summary: "列出指定目录下的文件与子目录",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "目录路径" } },
          required: ["path"],
        },
        enabled: false,
      },
      {
        serverId: server.id,
        remoteName: "read_file",
        localName: "demo_read_file",
        summary: "读取单个文本文件的内容",
        inputSchema: {
          type: "object",
          properties: { path: { type: "string", description: "文件路径" } },
          required: ["path"],
        },
        enabled: false,
      },
    ],
  });
}

async function seedUsageEvents(prisma: ReturnType<typeof getPrisma>) {
  const rows: {
    accountId: string;
    conversationId: string;
    requestId: string;
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    createdAt: Date;
  }[] = [];

  for (let i = 0; i < 96; i++) {
    const persona = DEMO_PERSONAS[i % DEMO_PERSONAS.length];
    rows.push({
      accountId: persona.accountId,
      conversationId: persona.conversations[0].conversationId,
      requestId: `demo-usage-${1000 + i}`,
      model: DEMO_MODEL_ID,
      provider: "openai",
      inputTokens: 320 + ((i * 37) % 900),
      outputTokens: 160 + ((i * 53) % 760),
      createdAt: daysAgoAt((i % 30) + 1, 8 + ((i * 3) % 12), (i * 17) % 60),
    });
  }
  await prisma.usageEvent.createMany({ data: rows });
}

async function seedTraces(prisma: ReturnType<typeof getPrisma>) {
  const defs = [
    { personaIndex: 1, llmRounds: 2, toolCalls: 1, hours: 2 },
    { personaIndex: 0, llmRounds: 1, toolCalls: 0, hours: 11 },
    { personaIndex: 2, llmRounds: 1, toolCalls: 0, hours: 20 },
    { personaIndex: 1, llmRounds: 3, toolCalls: 2, hours: 29 },
    { personaIndex: 0, llmRounds: 1, toolCalls: 0, hours: 38 },
    { personaIndex: 2, llmRounds: 2, toolCalls: 1, hours: 47 },
  ];

  for (const [index, def] of defs.entries()) {
    const persona = DEMO_PERSONAS[def.personaIndex];
    const traceId = `demo-trace-${index + 1}`;
    const startedAt = hoursAgo(def.hours);
    const totalMs = 1_600 + def.llmRounds * 1_400 + def.toolCalls * 900;
    const inputTokens = 700 + def.llmRounds * 520;
    const outputTokens = 240 + def.llmRounds * 130;

    await prisma.trace.create({
      data: {
        traceId,
        accountId: persona.accountId,
        conversationId: persona.conversations[0].conversationId,
        totalMs,
        llmRounds: def.llmRounds,
        toolCalls: def.toolCalls,
        inputTokens,
        outputTokens,
        stopReason: "end_turn",
        sampled: true,
        createdAt: startedAt,
      },
    });

    const spans: {
      traceId: string;
      spanId: string;
      parentSpanId: string | null;
      name: string;
      startTime: Date;
      durationMs: number;
      status: string;
      toolName: string | null;
      model: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
      stopReason: string | null;
    }[] = [];

    spans.push({
      traceId,
      spanId: `${traceId}-root`,
      parentSpanId: null,
      name: "agent.run",
      startTime: startedAt,
      durationMs: totalMs,
      status: "success",
      toolName: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      stopReason: null,
    });

    let cursor = startedAt.getTime();
    for (let round = 1; round <= def.llmRounds; round++) {
      if (round > 1 && def.toolCalls >= round - 1) {
        const toolStart = new Date(cursor);
        spans.push({
          traceId,
          spanId: `${traceId}-tool-${round - 1}`,
          parentSpanId: `${traceId}-root`,
          name: "tool.call",
          startTime: toolStart,
          durationMs: 820,
          status: "success",
          toolName: "web_search",
          model: null,
          inputTokens: null,
          outputTokens: null,
          stopReason: null,
        });
        cursor += 820;
      }
      const roundStart = new Date(cursor);
      const roundMs = 1_150 + round * 260;
      spans.push({
        traceId,
        spanId: `${traceId}-llm-${round}`,
        parentSpanId: `${traceId}-root`,
        name: "llm.round",
        startTime: roundStart,
        durationMs: roundMs,
        status: "success",
        toolName: null,
        model: DEMO_MODEL_ID,
        inputTokens: 620 + round * 510,
        outputTokens: 120 + round * 140,
        stopReason: round === def.llmRounds ? "end_turn" : "tool_calls",
      });
      cursor += roundMs;
    }

    await prisma.traceSpan.createMany({ data: spans });
  }
}

async function seedDemoModelConfig(prisma: ReturnType<typeof getPrisma>, port: number) {
  const store = new PrismaModelConfigStore();
  const template = await store.createTemplate({
    name: DEMO_TEMPLATE_NAME,
    provider: "openai",
    modelIds: [DEMO_MODEL_ID],
    apiKey: "demo-api-key",
    baseUrl: `http://127.0.0.1:${port}/demo-llm/v1`,
    enabled: true,
  });
  await store.upsertConfig({
    scope: "global",
    scopeKey: "*",
    purpose: "chat",
    templateId: template.id,
    modelId: DEMO_MODEL_ID,
    enabled: true,
    priority: 0,
  });
}

async function clearDemoData(prisma: ReturnType<typeof getPrisma>) {
  await prisma.webhookToken.deleteMany({ where: { source: DEMO_WEBHOOK_SOURCE } });
  await prisma.rssSource.deleteMany({ where: { name: { in: DEMO_RSS_SOURCE_NAMES } } });
  await prisma.mcpServer.deleteMany({ where: { slug: DEMO_MCP_SLUG } });
  await prisma.scheduledTask.deleteMany({ where: { accountId: { startsWith: DEMO_ACCOUNT_PREFIX } } });
  await prisma.usageEvent.deleteMany({ where: { accountId: { startsWith: DEMO_ACCOUNT_PREFIX } } });
  await prisma.trace.deleteMany({ where: { accountId: { startsWith: DEMO_ACCOUNT_PREFIX } } });
  // Accounts cascade to conversations, messages, tape entries/anchors, and
  // webhook permissions.
  await prisma.account.deleteMany({ where: { id: { startsWith: DEMO_ACCOUNT_PREFIX } } });
  await prisma.modelConfig.deleteMany({ where: { template: { name: DEMO_TEMPLATE_NAME } } });
  await prisma.modelProviderTemplate.deleteMany({ where: { name: DEMO_TEMPLATE_NAME } });
}

export interface DemoSeedSummary {
  accounts: number;
  conversations: number;
  messages: number;
  scheduledTasks: number;
}

/**
 * Rebuild all demo rows. Only ever touches demo-namespaced data, so it is safe
 * to re-run on every boot of a demo deployment and cannot damage real data.
 */
export async function seedDemoData(): Promise<DemoSeedSummary> {
  const prisma = getPrisma();

  await clearDemoData(prisma);

  let conversationCount = 0;
  let messageCount = 0;
  for (const persona of DEMO_PERSONAS) {
    await seedPersonaConversations(prisma, persona);
    await seedPersonaMemory(prisma, persona);
    conversationCount += persona.conversations.length;
    messageCount += persona.conversations.reduce((sum, c) => sum + c.messages.length, 0);
  }

  await seedScheduledTasks(prisma);
  await seedRss(prisma);
  await seedWebhook(prisma);
  await seedMcpServer(prisma);
  await seedUsageEvents(prisma);
  await seedTraces(prisma);

  const port = Number.parseInt(process.env.API_PORT ?? "8028", 10);
  await seedDemoModelConfig(prisma, port);

  const summary: DemoSeedSummary = {
    accounts: DEMO_PERSONAS.length,
    conversations: conversationCount,
    messages: messageCount,
    scheduledTasks: DEMO_TASKS.length,
  };
  demoLogger.info(summary, "演示数据已就绪（DEMO_MODE）");
  return summary;
}
