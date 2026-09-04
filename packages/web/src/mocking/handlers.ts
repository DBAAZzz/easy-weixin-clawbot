import { http, HttpResponse } from "msw";
import { createDemoState, type DemoState } from "./store.js";

/**
 * MSW request handlers that replay the snapshot fixtures and apply write
 * operations to an in-memory store. State lives for the browser session and
 * resets on refresh — good enough for a preview, by design not persistent.
 */

const state: DemoState = createDemoState();
let idCounter = 5000;

/** MSW's `HttpResponse.json` only accepts JSON values; mock payloads are JSON by construction. */
const json = (body: unknown) => HttpResponse.json(body as never);
const ok = (data: unknown) => json({ data });
const rawOk = (body: unknown) => json(body);
const notFound = (message = "not found") => HttpResponse.json({ error: message }, { status: 404 });
const notSimulated = HttpResponse.json({ error: "演示环境未模拟该操作" }, { status: 501 });

/** MSW path params are `string | readonly string[] | undefined`; paths here only use single segments. */
function seg(value: string | readonly string[] | undefined): string {
  return typeof value === "string" ? value : Array.isArray(value) ? value.join("/") : "";
}

function params(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  return (await request.json().catch(() => ({}))) as Record<string, unknown>;
}

function nextId(): string {
  idCounter += 1;
  return String(idCounter);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Create a new row by cloning an existing one (keeps DTO shapes honest). */
function cloneRow(
  rows: Record<string, unknown>[],
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const base = structuredClone(rows[0] ?? {});
  return { ...base, ...overrides, id: nextId() };
}

function findAccount(accountId: string): Record<string, unknown> | undefined {
  return state.accounts.find((account) => account.id === accountId);
}

export const handlers = [
  // ── health / auth ─────────────────────────────────────────────────────
  http.get("/api/health", () => ok({ ...state.health, uptime_ms: 1, started_at: nowIso() })),

  http.post("/api/auth/login", async ({ request }) => {
    const body = await readBody(request);
    if (!String(body.username ?? "").trim() || !String(body.password ?? "").trim()) {
      return HttpResponse.json({ error: "请输入用户名和密码" }, { status: 401 });
    }
    return ok({ token: `demo-token-${Date.now().toString(36)}`, expiresIn: "24h" });
  }),

  // ── accounts ──────────────────────────────────────────────────────────
  http.get("/api/accounts", ({ request }) => {
    const status = params(request).get("status") ?? "all";
    const rows = state.accounts.filter((account) => {
      if (status === "active") return !account.deprecated;
      if (status === "deprecated") return account.deprecated === true;
      return true;
    });
    return ok(rows);
  }),
  http.patch("/api/accounts/:accountId", async ({ request, params }) => {
    const account = findAccount(seg(params.accountId));
    if (!account) return notFound();
    const body = await readBody(request);
    if (typeof body.alias === "string" || body.alias === null) {
      account.alias = body.alias;
    }
    return ok({ success: true });
  }),

  // ── conversations & messages ──────────────────────────────────────────
  http.get("/api/accounts/:accountId/conversations", ({ params }) =>
    ok(state.conversations[seg(params.accountId)] ?? []),
  ),
  http.get("/api/accounts/:accountId/conversations/:conversationId/messages", ({ params }) => {
    const page = state.messages[seg(params.accountId)]?.[seg(params.conversationId)] ?? [];
    return HttpResponse.json({ data: page, has_more: false, next_cursor: null });
  }),

  // ── tape memory graph ─────────────────────────────────────────────────
  http.get("/api/tape/graph", ({ request }) => {
    const accountId = params(request).get("accountId") ?? "";
    const graph = state.tapeGraph[accountId] ?? { nodes: [], edges: [], groups: {} };
    return ok(graph);
  }),

  // ── scheduled (prompt) tasks ──────────────────────────────────────────
  http.get("/api/scheduled-tasks", ({ request }) => {
    const taskKind = params(request).get("taskKind");
    const rows = taskKind ? state.tasks.filter((task) => task.taskKind === taskKind) : state.tasks;
    return ok(rows);
  }),
  http.patch("/api/scheduled-tasks/:accountId/:seq", async ({ request, params }) => {
    const task = state.tasks.find(
      (row) => row.accountId === seg(params.accountId) && String(row.seq) === seg(params.seq),
    );
    if (!task) return notFound();
    const body = await readBody(request);
    if (typeof body.enabled === "boolean") {
      task.enabled = body.enabled;
      task.status = body.enabled ? "idle" : "paused";
    }
    return ok(task);
  }),
  http.get("/api/scheduled-tasks/:accountId/:seq/runs", ({ params }) =>
    ok(state.taskRuns[`${seg(params.accountId)}/${seg(params.seq)}`] ?? []),
  ),

  // ── RSS sources ───────────────────────────────────────────────────────
  http.get("/api/rss/sources", () => ok(state.rssSources)),
  http.post("/api/rss/sources", async ({ request }) => {
    const body = await readBody(request);
    const row = cloneRow(state.rssSources, {
      name: String(body.name ?? "未命名订阅"),
      source_type: body.source_type ?? "rss_url",
      route_path: body.route_path ?? null,
      feed_url: body.feed_url ?? null,
      description: body.description ?? null,
      enabled: body.enabled ?? true,
      status: (body.enabled ?? true) ? "normal" : "disabled",
      last_fetched_at: null,
      last_success_at: null,
      last_error: null,
      failure_streak: 0,
      backoff_until: null,
      referenced_task_count: 0,
      recent_item_count: 0,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    state.rssSources.unshift(row);
    return ok(row);
  }),
  http.patch("/api/rss/sources/:id", async ({ request, params }) => {
    const row = state.rssSources.find((item) => item.id === seg(params.id));
    if (!row) return notFound();
    Object.assign(row, await readBody(request), { updated_at: nowIso() });
    return ok(row);
  }),
  http.delete("/api/rss/sources/:id", ({ params }) => {
    state.rssSources = state.rssSources.filter((item) => item.id !== seg(params.id));
    return ok({ success: true });
  }),

  // ── RSS tasks ─────────────────────────────────────────────────────────
  http.get("/api/rss/tasks", ({ request }) => {
    const accountId = params(request).get("accountId");
    const rows = accountId
      ? state.rssTasks.filter((task) => task.account_id === accountId)
      : state.rssTasks;
    return ok(rows);
  }),

  // ── web search providers ──────────────────────────────────────────────
  http.get("/api/web-search/providers", () => ok([])),

  // ── model provider templates ──────────────────────────────────────────
  http.get("/api/model-provider-templates", () => ok(state.templates)),
  http.post("/api/model-provider-templates", async ({ request }) => {
    const body = await readBody(request);
    const row = cloneRow(state.templates, {
      name: String(body.name ?? "未命名 Provider"),
      provider: String(body.provider ?? "openai"),
      model_ids: Array.isArray(body.model_ids) ? body.model_ids : [],
      base_url: body.base_url ?? null,
      enabled: body.enabled ?? true,
      api_key_set: Boolean(body.api_key),
      usage_count: 0,
    });
    state.templates.push(row);
    return ok(row);
  }),
  http.patch("/api/model-provider-templates/:id", async ({ request, params }) => {
    const row = state.templates.find((item) => item.id === seg(params.id));
    if (!row) return notFound();
    Object.assign(row, await readBody(request));
    return ok(row);
  }),
  http.delete("/api/model-provider-templates/:id", ({ params }) => {
    state.templates = state.templates.filter((item) => item.id !== seg(params.id));
    return ok({ success: true });
  }),
  http.post("/api/model-provider-templates/:id/ping", ({ params }) => {
    const row = state.templates.find((item) => item.id === seg(params.id));
    return ok({
      template_id: seg(params.id),
      provider: row?.provider ?? "openai",
      reachable: true,
      status_code: 200,
      latency_ms: 42,
      endpoint: (row?.base_url as string | null) ?? null,
      model_count: Array.isArray(row?.model_ids) ? (row.model_ids as unknown[]).length : null,
      checked_at: nowIso(),
    });
  }),

  // ── model configs ─────────────────────────────────────────────────────
  http.get("/api/model-configs", () => ok(state.modelConfigs)),
  http.post("/api/model-configs", async ({ request }) => {
    const body = await readBody(request);
    const row = cloneRow(state.modelConfigs, {
      scope: body.scope ?? "global",
      scope_key: body.scope_key ?? "*",
      purpose: body.purpose ?? "chat",
      template_id: body.template_id ?? null,
      template_name: body.template_name ?? null,
      provider: body.provider ?? null,
      model_id: body.model_id ?? null,
      model_ids: Array.isArray(body.model_ids) ? body.model_ids : [],
      supports_image_input_override: body.supports_image_input_override ?? "default",
      enabled: body.enabled ?? true,
      priority: body.priority ?? 0,
    });
    state.modelConfigs.push(row);
    return ok(row);
  }),
  http.patch("/api/model-configs/:id", async ({ request, params }) => {
    const row = state.modelConfigs.find((item) => item.id === seg(params.id));
    if (!row) return notFound();
    Object.assign(row, await readBody(request));
    return ok(row);
  }),
  http.delete("/api/model-configs/:id", ({ params }) => {
    state.modelConfigs = state.modelConfigs.filter((item) => item.id !== seg(params.id));
    return ok({ success: true });
  }),

  // ── settings ──────────────────────────────────────────────────────────
  http.get("/api/settings", () => ok(state.settings)),
  http.patch("/api/settings", async ({ request }) => {
    Object.assign(state.settings, await readBody(request));
    return ok(state.settings);
  }),

  // ── usage & observability ─────────────────────────────────────────────
  http.get("/api/usage/overview", ({ request }) => {
    const accountId = params(request).get("accountId") ?? "";
    return ok(state.usageOverview[accountId] ?? state.usageOverview[""]);
  }),
  http.get("/api/observability/overview", ({ request }) => {
    const window = params(request).get("window") ?? "24h";
    return ok(state.observabilityOverview[window] ?? state.observabilityOverview["24h"]);
  }),
  http.get("/api/observability/traces", ({ request }) => {
    const window = params(request).get("window") ?? "24h";
    const rows = state.observabilityTraces[window] ?? [];
    return HttpResponse.json({ data: rows, has_more: false, next_cursor: null });
  }),
  http.get("/api/observability/traces/:traceId", ({ params }) => {
    const detail = state.traceDetails[seg(params.traceId)];
    if (!detail) return notFound();
    return ok(detail);
  }),

  // ── tools & skills ────────────────────────────────────────────────────
  http.get("/api/tools", () => ok(state.tools)),
  http.get("/api/skills", () => ok(state.skills)),
  http.get("/api/skills/:name/source", ({ params }) => {
    const source = state.skillSources[seg(params.name)];
    if (!source) return notFound();
    return ok(source);
  }),
  http.put("/api/skills/:name", async ({ request, params }) => {
    const skill = state.skills.find((item) => item.name === seg(params.name));
    if (!skill) return notFound();
    await readBody(request);
    return ok(skill);
  }),
  http.delete("/api/skills/:name", ({ params }) => {
    state.skills = state.skills.filter((item) => item.name !== seg(params.name));
    return ok({ name: seg(params.name) });
  }),
  http.post("/api/skills/:name/enable", ({ params }) => {
    const skill = state.skills.find((item) => item.name === seg(params.name));
    if (!skill) return notFound();
    skill.enabled = true;
    return ok(skill);
  }),
  http.post("/api/skills/:name/disable", ({ params }) => {
    const skill = state.skills.find((item) => item.name === seg(params.name));
    if (!skill) return notFound();
    skill.enabled = false;
    return ok(skill);
  }),
  http.post("/api/skills/:name/preflight", ({ params }) =>
    ok({
      runtime: "node",
      installer: "manual",
      createEnv: false,
      commandPreview: ["# 演示环境跳过真实安装"],
      dependencies: [],
      runtimeCheck: {
        runtime: "node",
        binary: "node",
        status: "ok",
        version: process.version,
        envReady: true,
      },
      name: seg(params.name),
    }),
  ),
  http.post("/api/skills/:name/provision", () =>
    ok({ status: "skipped", logs: [{ level: "info", message: "演示环境跳过安装" }] }),
  ),

  // ── MCP ───────────────────────────────────────────────────────────────
  http.get("/api/mcp/servers", () => ok(state.mcpServers)),
  http.get("/api/mcp/tools", () => ok(state.mcpTools)),
  http.post("/api/mcp/servers/:id/refresh", ({ params }) => {
    const row = state.mcpServers.find((item) => item.id === seg(params.id));
    if (!row) return notFound();
    return ok(row);
  }),
  http.post("/api/mcp/servers/:id/enable", ({ params }) => {
    const row = state.mcpServers.find((item) => item.id === seg(params.id));
    if (!row) return notFound();
    row.enabled = true;
    return ok(row);
  }),
  http.post("/api/mcp/servers/:id/disable", ({ params }) => {
    const row = state.mcpServers.find((item) => item.id === seg(params.id));
    if (!row) return notFound();
    row.enabled = false;
    row.status = "disconnected";
    return ok(row);
  }),
  http.post("/api/mcp/tools/:id/enable", ({ params }) => {
    const row = state.mcpTools.find((item) => item.id === seg(params.id));
    if (!row) return notFound();
    row.enabled = true;
    return ok(row);
  }),
  http.post("/api/mcp/tools/:id/disable", ({ params }) => {
    const row = state.mcpTools.find((item) => item.id === seg(params.id));
    if (!row) return notFound();
    row.enabled = false;
    return ok(row);
  }),
  http.delete("/api/mcp/servers/:id", ({ params }) => {
    state.mcpServers = state.mcpServers.filter((item) => item.id !== seg(params.id));
    return ok({ id: seg(params.id) });
  }),

  // ── wechat QR login (not available in the demo) ───────────────────────
  http.post("/api/login/start", () =>
    ok({ status: "error", message: "演示环境不支持扫码绑定微信，请浏览其它页面" }),
  ),
  http.get("/api/login/status", () => ok({ status: "idle" })),
  http.post("/api/login/cancel", () => ok({ status: "idle" })),
];

// RSS task write operations must register after the GET so the stricter
// static paths stay unambiguous; they live in a second list that is spread
// into the exported handlers.
const rssTaskWriteHandlers = [
  http.post("/api/rss/tasks", async ({ request }) => {
    const body = await readBody(request);
    const row = cloneRow(state.rssTasks, {
      account_id: String(body.account_id ?? ""),
      name: String(body.name ?? "未命名任务"),
      task_kind: body.task_kind ?? "rss_digest",
      cron: String(body.cron ?? "0 9 * * *"),
      enabled: body.enabled ?? true,
      status: (body.enabled ?? true) ? "idle" : "paused",
      source_count: Array.isArray(body.source_ids) ? body.source_ids.length : 0,
      run_count: 0,
      fail_streak: 0,
      last_run_at: null,
      next_run_at: null,
      last_error: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    });
    state.rssTasks.unshift(row);
    return ok(row);
  }),
  http.patch("/api/rss/tasks/:accountId/:seq", async ({ request, params }) => {
    const row = state.rssTasks.find(
      (item) => item.account_id === seg(params.accountId) && String(item.seq) === seg(params.seq),
    );
    if (!row) return notFound();
    Object.assign(row, await readBody(request), { updated_at: nowIso() });
    return ok(row);
  }),
  http.delete("/api/rss/tasks/:accountId/:seq", ({ params }) => {
    state.rssTasks = state.rssTasks.filter(
      (item) =>
        !(item.account_id === seg(params.accountId) && String(item.seq) === seg(params.seq)),
    );
    return ok({ success: true });
  }),
  http.post("/api/rss/tasks/:accountId/:seq/run-now", ({ params }) => {
    const row = state.rssTasks.find(
      (item) => item.account_id === seg(params.accountId) && String(item.seq) === seg(params.seq),
    );
    if (!row) return notFound();
    row.run_count = Number(row.run_count ?? 0) + 1;
    row.last_run_at = nowIso();
    return rawOk({
      data: {
        success: true,
        run: {
          id: nextId(),
          status: "success",
          prompt: `演示执行 RSS 任务「${String(row.name)}」`,
          result: "（演示）已聚合订阅条目并生成一条摘要推送。",
          duration_ms: 864,
          error: null,
          pushed: false,
          created_at: nowIso(),
        },
      },
    });
  }),
  http.post("/api/rss/tasks/:accountId/:seq/preview", ({ params }) => {
    const row = state.rssTasks.find(
      (item) => item.account_id === seg(params.accountId) && String(item.seq) === seg(params.seq),
    );
    if (!row) return notFound();
    return rawOk({
      data: {
        task: row,
        would_send: true,
        suppressed: false,
        reason: null,
        item_count: 2,
        dropped_count: 0,
        content: "（演示）这是该任务下次执行时会推送的摘要内容预览。",
        items: demoRssPreviewItems(row),
      },
    });
  }),
];

function demoRssPreviewItems(source: Record<string, unknown>) {
  const name = String(source.name ?? "演示订阅");
  return [1, 2].map((index) => ({
    id: `${index}`,
    fingerprint: `demo-preview-${index}`,
    title: `${name} · 示例条目 ${index}`,
    summary_text: "这是一条用于演示的摘要内容，实际环境会抓取订阅源的最新文章。",
    content_text: null,
    content_html: null,
    link: "https://example.com/demo",
    published_at: nowIso(),
    author: "演示作者",
    media: [],
  }));
}

// Webhook endpoints use `rawRequest` (no {data} envelope on writes), so they
// are declared with their exact raw response shapes.
const webhookHandlers = [
  http.get("/api/webhooks/tokens", () => rawOk({ data: state.webhookTokens })),
  http.get("/api/webhooks/tokens/:source/logs", ({ params }) =>
    rawOk({ data: state.webhookLogs[seg(params.source)] ?? [] }),
  ),
  http.post("/api/webhooks/tokens", async ({ request }) => {
    const body = await readBody(request);
    const source = String(body.source ?? `demo-${Date.now().toString(36)}`);
    const row = {
      source,
      tokenPrefix: "demo_tok",
      description: (body.description as string | null) ?? null,
      accountIds: Array.isArray(body.accountIds) ? body.accountIds : [],
      enabled: true,
      createdAt: nowIso(),
      lastUsedAt: null,
    };
    state.webhookTokens.unshift(row);
    return rawOk({
      token: `${row.tokenPrefix}_${Math.random().toString(36).slice(2)}`,
      source: row.source,
      accountIds: row.accountIds,
      enabled: true,
      createdAt: row.createdAt,
    });
  }),
  http.patch("/api/webhooks/tokens/:source", async ({ request, params }) => {
    const row = state.webhookTokens.find((item) => item.source === seg(params.source));
    if (!row) return notFound();
    const body = await readBody(request);
    if (typeof body.enabled === "boolean") row.enabled = body.enabled;
    return rawOk({ success: true });
  }),
  http.post("/api/webhooks/tokens/:source/rotate", ({ params }) =>
    rawOk({
      token: `demo_tok_${Math.random().toString(36).slice(2)}`,
      source: seg(params.source),
      rotatedAt: nowIso(),
    }),
  ),
  http.delete("/api/webhooks/tokens/:source", ({ params }) => {
    state.webhookTokens = state.webhookTokens.filter((item) => item.source !== seg(params.source));
    return rawOk({ success: true });
  }),
  http.post("/api/webhooks/tokens/:source/test", async ({ request, params }) => {
    const body = await readBody(request);
    const logs = (state.webhookLogs[seg(params.source)] ??= []);
    logs.unshift({
      accountId: body.accountId ?? "",
      conversationId: body.conversationId ?? "",
      status: "success",
      error: null,
      createdAt: nowIso(),
    });
    return rawOk({ success: true, messageId: nextId(), type: body.type ?? "text" });
  }),
];

// MCP server create/update need the body first; keep them here with the
// remaining generic writes so every /api route is handled and nothing leaks
// to the static server.
const genericWriteHandlers = [
  http.post("/api/mcp/servers", async ({ request }) => {
    const body = await readBody(request);
    const row = cloneRow(state.mcpServers, {
      name: String(body.name ?? "未命名 MCP Server"),
      slug: String(body.slug ?? `demo-${Date.now().toString(36)}`),
      transport: String(body.transport ?? "stdio"),
      command: String(body.command ?? "npx"),
      enabled: body.enabled ?? false,
      status: "disconnected",
      last_seen_at: null,
      last_error: null,
    });
    state.mcpServers.push(row);
    return ok(row);
  }),
  http.patch("/api/mcp/servers/:id", async ({ request, params }) => {
    const row = state.mcpServers.find((item) => item.id === seg(params.id));
    if (!row) return notFound();
    Object.assign(row, await readBody(request));
    return ok(row);
  }),
];

// Anything else under /api/*: fail loudly in the UI instead of letting the
// request hit the static server and return HTML.
const fallback = [http.all("/api/*", () => notSimulated)];

export const demoHandlers = [
  ...handlers,
  ...rssTaskWriteHandlers,
  ...webhookHandlers,
  ...genericWriteHandlers,
  ...fallback,
];
