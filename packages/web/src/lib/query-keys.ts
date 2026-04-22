import type { AccountStatusFilter, ObservabilityWindow } from "@clawbot/shared";

export const queryKeys = {
  accounts: (status: AccountStatusFilter = "all") => ["accounts", status] as const,

  conversations: (accountId: string) => ["conversations", accountId] as const,

  messages: (accountId: string, conversationId: string) =>
    ["messages", accountId, conversationId] as const,

  tapeGraph: (accountId: string, branch: string) => ["tapeGraph", accountId, branch] as const,

  health: ["health"] as const,

  mcpServers: ["mcpServers"] as const,
  mcpTools: ["mcpTools"] as const,

  skills: ["skills"] as const,
  skillSource: (name: string) => ["skillSource", name] as const,

  tools: ["tools"] as const,
  toolSource: (name: string) => ["toolSource", name] as const,

  webhookTokens: ["webhookTokens"] as const,
  webhookLogs: (source: string, limit: number) => ["webhookLogs", source, limit] as const,

  scheduledTasks: (accountId?: string) => ["scheduledTasks", accountId] as const,
  scheduledTaskRuns: (accountId: string, seq: number) =>
    ["scheduledTaskRuns", accountId, seq] as const,

  modelProviderTemplates: ["modelProviderTemplates"] as const,
  modelConfigs: ["modelConfigs"] as const,
  webSearchProviders: ["webSearchProviders"] as const,

  observabilityOverview: (window: ObservabilityWindow) =>
    ["observabilityOverview", window] as const,
  observabilityTraces: (filters: {
    window: ObservabilityWindow;
    flag?: string;
    status?: "ok" | "error";
    query?: string;
  }) => ["observabilityTraces", filters] as const,
  observabilityTrace: (traceId: string) => ["observabilityTrace", traceId] as const,
} as const;
