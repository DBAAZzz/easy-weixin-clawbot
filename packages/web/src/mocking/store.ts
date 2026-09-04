import fixturesJson from "./fixtures.json";

/**
 * In-memory demo database for the MSW mock layer, initialised from the
 * snapshot fixtures. Every page load gets a fresh copy, so demo interactions
 * (create/update/delete) work within a session and reset on refresh.
 *
 * Fixtures are generated from the real DEMO_MODE API by
 * `pnpm -F @clawbot/server demo:snapshot-fixtures` — the shapes here are the
 * API contract, not hand-maintained guesses.
 */

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

function group<T>(value: unknown): T {
  return (value as { data: T }).data;
}

const fixtures = fixturesJson as unknown as {
  health: { data: Record<string, unknown> };
  accounts: { all: { data: Record<string, unknown>[] } };
  settings: { data: Record<string, unknown> };
  tools: { data: Record<string, unknown>[] };
  skills: { data: Record<string, unknown>[] };
  skillSources: Record<string, { data: unknown }>;
  modelProviderTemplates: { data: Record<string, unknown>[] };
  modelConfigs: { data: Record<string, unknown>[] };
  scheduledTasks: { data: Record<string, unknown>[] };
  scheduledTaskRuns: Record<string, { data: Record<string, unknown>[] }>;
  rssSources: { data: Record<string, unknown>[] };
  rssTasks: Record<string, unknown>;
  mcpServers: { data: Record<string, unknown>[] };
  mcpTools: { data: Record<string, unknown>[] };
  webhookTokens: { data: Record<string, unknown>[] };
  webhookLogs: Record<string, { data: Record<string, unknown>[] }>;
  conversations: Record<string, { data: Record<string, unknown>[] }>;
  messages: Record<string, Record<string, { data: Record<string, unknown>[] }>>;
  tapeGraph: Record<string, { data: unknown }>;
  usageOverview: Record<string, { data: unknown }>;
  observabilityOverview: Record<string, { data: unknown }>;
  observabilityTraces: Record<string, { data: Record<string, unknown>[] }>;
  traceDetails: Record<string, { data: unknown }>;
};

export interface DemoState {
  health: Record<string, unknown>;
  settings: Record<string, unknown>;
  accounts: Record<string, unknown>[];
  tools: Record<string, unknown>[];
  skills: Record<string, unknown>[];
  skillSources: Record<string, unknown>;
  templates: Record<string, unknown>[];
  modelConfigs: Record<string, unknown>[];
  tasks: Record<string, unknown>[];
  taskRuns: Record<string, Record<string, unknown>[]>;
  rssSources: Record<string, unknown>[];
  rssTasks: Record<string, unknown>[];
  mcpServers: Record<string, unknown>[];
  mcpTools: Record<string, unknown>[];
  webhookTokens: Record<string, unknown>[];
  webhookLogs: Record<string, Record<string, unknown>[]>;
  conversations: Record<string, Record<string, unknown>[]>;
  messages: Record<string, Record<string, Record<string, unknown>[]>>;
  tapeGraph: Record<string, unknown>;
  usageOverview: Record<string, unknown>;
  observabilityOverview: Record<string, unknown>;
  observabilityTraces: Record<string, Record<string, unknown>[]>;
  traceDetails: Record<string, unknown>;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function createDemoState(): DemoState {
  const rssTasksByAccount: Record<string, Record<string, unknown>[]> = {};
  for (const [accountId, body] of Object.entries(fixtures.rssTasks)) {
    rssTasksByAccount[accountId] = clone(group<Record<string, unknown>[]>(body));
  }

  const messages: Record<string, Record<string, Record<string, unknown>[]>> = {};
  for (const [accountId, perConversation] of Object.entries(fixtures.messages)) {
    messages[accountId] = {};
    for (const [conversationId, page] of Object.entries(perConversation)) {
      messages[accountId][conversationId] = clone(group<Record<string, unknown>[]>(page));
    }
  }

  // Singleton-shaped fixtures keep their {data} envelope in the snapshot;
  // handlers re-wrap with ok(), so unwrap once here.
  const unwrapAll = (input: Record<string, { data: unknown }>) =>
    Object.fromEntries(Object.entries(input).map(([key, body]) => [key, clone(body.data)]));

  return {
    health: clone(fixtures.health.data),
    settings: clone(fixtures.settings.data),
    accounts: clone(fixtures.accounts.all.data),
    tools: clone(fixtures.tools.data),
    skills: clone(fixtures.skills.data),
    skillSources: unwrapAll(fixtures.skillSources),
    templates: clone(fixtures.modelProviderTemplates.data),
    modelConfigs: clone(fixtures.modelConfigs.data),
    tasks: clone(fixtures.scheduledTasks.data),
    taskRuns: Object.fromEntries(
      Object.entries(fixtures.scheduledTaskRuns).map(([key, body]) => [
        key,
        clone(group<Record<string, unknown>[]>(body)),
      ]),
    ),
    rssSources: clone(fixtures.rssSources.data),
    rssTasks: Object.values(rssTasksByAccount).flat(),
    mcpServers: clone(fixtures.mcpServers.data),
    mcpTools: clone(fixtures.mcpTools.data),
    webhookTokens: clone(fixtures.webhookTokens.data),
    webhookLogs: Object.fromEntries(
      Object.entries(fixtures.webhookLogs).map(([key, body]) => [
        key,
        clone(group<Record<string, unknown>[]>(body)),
      ]),
    ),
    conversations: Object.fromEntries(
      Object.entries(fixtures.conversations).map(([key, body]) => [
        key,
        clone(group<Record<string, unknown>[]>(body)),
      ]),
    ),
    messages,
    tapeGraph: unwrapAll(fixtures.tapeGraph),
    usageOverview: unwrapAll(fixtures.usageOverview),
    observabilityOverview: unwrapAll(fixtures.observabilityOverview),
    observabilityTraces: Object.fromEntries(
      Object.entries(fixtures.observabilityTraces).map(([key, body]) => [
        key,
        clone(group<Record<string, unknown>[]>(body)),
      ]),
    ),
    traceDetails: unwrapAll(fixtures.traceDetails),
  };
}

export type { Json };
