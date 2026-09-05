import "./config/load-env.js";
import { mkdir, writeFile } from "node:fs/promises";
import { getDemoApp } from "./api/vercel-demo.js";
import { REPO_ROOT } from "./paths.js";
import { seedDemoData } from "./seed/demo-seed.js";

/**
 * Snapshot the DEMO_MODE API responses into static fixtures consumed by the
 * web package's MSW mock layer (packages/web/src/mocking/fixtures.json).
 *
 * Run against any reachable Postgres:
 *   DATABASE_URL=... DIRECT_URL=... AUTH_PASSWORD=... \
 *     pnpm -F @clawbot/server demo:snapshot-fixtures
 *
 * Re-run whenever the API response shapes change so the web demo stays in
 * sync with the real contract.
 */

if (!process.env.DEMO_MODE) {
  process.env.DEMO_MODE = "true";
}
if (!process.env.API_PORT) {
  process.env.API_PORT = "8028";
}

const OUTPUT_PATH = process.env.FIXTURES_OUTPUT ?? `${REPO_ROOT}/packages/web/src/mocking/fixtures.json`;
const MESSAGE_LIMIT = 50;

async function main(): Promise<void> {
  const username = process.env.AUTH_USERNAME ?? "admin";
  const password = process.env.AUTH_PASSWORD;
  if (!password) {
    throw new Error("AUTH_PASSWORD is required to log in for the snapshot");
  }

  await seedDemoData();
  const app = await getDemoApp();

  const loginRes = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!loginRes.ok) {
    throw new Error(`login failed with ${loginRes.status}`);
  }
  const { data: loginData } = (await loginRes.json()) as { data: { token: string } };
  const auth = { authorization: `Bearer ${loginData.token}` };

  const fixtures: Record<string, unknown> = {};
  async function snap(key: string, path: string): Promise<unknown> {
    const res = await app.request(path, { headers: auth });
    if (!res.ok) {
      throw new Error(`GET ${path} failed with ${res.status}`);
    }
    const body: unknown = await res.json();
    fixtures[key] = body;
    return body;
  }

  // ── Global singletons ────────────────────────────────────────────────
  await snap("health", "/api/health");
  fixtures.accounts = {
    all: (await snap("accounts.all", "/api/accounts")) ?? null,
    active: await snap("accounts.active", "/api/accounts?status=active"),
    deprecated: await snap("accounts.deprecated", "/api/accounts?status=deprecated"),
  };
  await snap("settings", "/api/settings");
  await snap("tools", "/api/tools");
  await snap("skills", "/api/skills");
  await snap("modelProviderTemplates", "/api/model-provider-templates");
  await snap("modelConfigs", "/api/model-configs");
  await snap("scheduledTasks", "/api/scheduled-tasks?taskKind=prompt");
  await snap("rssSources", "/api/rss/sources");
  await snap("mcpServers", "/api/mcp/servers");
  await snap("mcpTools", "/api/mcp/tools");
  await snap("webhookTokens", "/api/webhooks/tokens");

  // ── Per-account resources ────────────────────────────────────────────
  const accounts = (fixtures.accounts as { all: { data: { id: string }[] } }).all.data;
  const conversations: Record<string, unknown> = {};
  const messages: Record<string, Record<string, unknown>> = {};
  const tapeGraph: Record<string, unknown> = {};
  const usageOverview: Record<string, unknown> = {};
  const rssTasks: Record<string, unknown> = {};

  for (const account of accounts) {
    conversations[account.id] = await snap(
      `conversations.${account.id}`,
      `/api/accounts/${encodeURIComponent(account.id)}/conversations`,
    );
    usageOverview[account.id] = await snap(
      `usageOverview.${account.id}`,
      `/api/usage/overview?window=30d&accountId=${encodeURIComponent(account.id)}`,
    );
    tapeGraph[account.id] = await snap(
      `tapeGraph.${account.id}`,
      `/api/tape/graph?accountId=${encodeURIComponent(account.id)}&branch=__global__`,
    );
    rssTasks[account.id] = await snap(
      `rssTasks.${account.id}`,
      `/api/rss/tasks?accountId=${encodeURIComponent(account.id)}`,
    );

    const conversationRows = (
      conversations[account.id] as { data: { conversation_id: string }[] }
    ).data;
    messages[account.id] = {};
    for (const conversation of conversationRows) {
      const conversationId = conversation.conversation_id;
      messages[account.id][conversationId] = await snap(
        `messages.${account.id}.${conversationId}`,
        `/api/accounts/${encodeURIComponent(account.id)}/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MESSAGE_LIMIT}`,
      );
    }
  }
  usageOverview[""] = await snap("usageOverview.global", "/api/usage/overview?window=30d");

  fixtures.conversations = conversations;
  fixtures.messages = messages;
  fixtures.tapeGraph = tapeGraph;
  fixtures.usageOverview = usageOverview;
  fixtures.rssTasks = rssTasks;

  // ── Task runs / webhook logs ─────────────────────────────────────────
  const scheduledTaskRuns: Record<string, unknown> = {};
  const tasks = (fixtures.scheduledTasks as { data: { accountId: string; seq: number }[] }).data;
  for (const task of tasks) {
    scheduledTaskRuns[`${task.accountId}/${task.seq}`] = await snap(
      `scheduledTaskRuns.${task.accountId}.${task.seq}`,
      `/api/scheduled-tasks/${encodeURIComponent(task.accountId)}/${task.seq}/runs?limit=20`,
    );
  }
  fixtures.scheduledTaskRuns = scheduledTaskRuns;

  const webhookLogs: Record<string, unknown> = {};
  const tokens = (fixtures.webhookTokens as { data: { source: string }[] }).data;
  for (const tokenRow of tokens) {
    webhookLogs[tokenRow.source] = await snap(
      `webhookLogs.${tokenRow.source}`,
      `/api/webhooks/tokens/${encodeURIComponent(tokenRow.source)}/logs?limit=20`,
    );
  }
  fixtures.webhookLogs = webhookLogs;

  // ── Observability ────────────────────────────────────────────────────
  const observabilityOverview: Record<string, unknown> = {};
  const observabilityTraces: Record<string, unknown> = {};
  const traceIds = new Set<string>();
  for (const window of ["24h", "7d", "30d"] as const) {
    observabilityOverview[window] = await snap(
      `observabilityOverview.${window}`,
      `/api/observability/overview?window=${window}`,
    );
    observabilityTraces[window] = await snap(
      `observabilityTraces.${window}`,
      `/api/observability/traces?window=${window}&limit=20`,
    );
    const rows = (observabilityTraces[window] as { data: { trace_id: string }[] }).data;
    for (const row of rows) traceIds.add(row.trace_id);
  }
  fixtures.observabilityOverview = observabilityOverview;
  fixtures.observabilityTraces = observabilityTraces;

  const traceDetails: Record<string, unknown> = {};
  for (const traceId of traceIds) {
    traceDetails[traceId] = await snap(
      `traceDetails.${traceId}`,
      `/api/observability/traces/${encodeURIComponent(traceId)}`,
    );
  }
  fixtures.traceDetails = traceDetails;

  // ── Skill sources ────────────────────────────────────────────────────
  const skillRows = (fixtures.skills as { data: { name: string }[] }).data;
  const skillSources: Record<string, unknown> = {};
  for (const skill of skillRows) {
    try {
      skillSources[skill.name] = await snap(
        `skillSources.${skill.name}`,
        `/api/skills/${encodeURIComponent(skill.name)}/source`,
      );
    } catch {
      // Provisioning-external skills may not expose source; skip quietly.
    }
  }
  fixtures.skillSources = skillSources;

  const output = `${JSON.stringify(fixtures, null, 2)}\n`;
  await mkdir(OUTPUT_PATH.replace(/\/[^/]+$/, ""), { recursive: true });
  await writeFile(OUTPUT_PATH, output, "utf8");
  console.log(`[snapshot] ${Object.keys(fixtures).length} fixture groups -> ${OUTPUT_PATH}`);
}

try {
  await main();
} catch (error) {
  console.error("[snapshot] failed", error);
  process.exitCode = 1;
}
