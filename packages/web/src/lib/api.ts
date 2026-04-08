import type {
  AccountStatusFilter,
  AccountSummary,
  ApiResponse,
  CapabilityCollection,
  ConversationRow,
  HealthStatus,
  LegacySkillInfo,
  LoginState,
  MarkdownSource,
  McpServerInfo,
  McpToolInfo,
  MessageRow,
  ModelConfigDto,
  ModelProviderTemplateDto,
  ObservabilityOverview,
  ObservabilityTraceDetail,
  ObservabilityTraceSummary,
  ObservabilityWindow,
  PaginatedResponse,
  SkillInfo,
  TapeGraphResponse,
  ToolInfo,
} from "@clawbot/shared";
import type { McpServerRequestPayload } from "./mcp-form.js";

function getAuthToken(): string | null {
  return localStorage.getItem("auth_token");
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (!headers.has("Content-Type") && init?.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }

  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    localStorage.removeItem("auth_token");
    window.location.href = "/auth/login";
    throw new Error("Unauthorized");
  }

  const payload = (await response.json().catch(() => ({ error: "invalid response" }))) as ApiResponse<T>;

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `request failed with status ${response.status}`);
  }

  return payload.data as T;
}

async function requestPaginated<T>(path: string, init?: RequestInit): Promise<PaginatedResponse<T>> {
  const headers = new Headers(init?.headers);

  if (!headers.has("Content-Type") && init?.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }

  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    localStorage.removeItem("auth_token");
    window.location.href = "/auth/login";
    throw new Error("Unauthorized");
  }

  const payload = (await response.json().catch(() => ({ error: "invalid response" }))) as
    | PaginatedResponse<T>
    | { error?: string };

  if (!response.ok || ("error" in payload && payload.error)) {
    throw new Error(
      ("error" in payload && typeof payload.error === "string"
        ? payload.error
        : `request failed with status ${response.status}`)
    );
  }

  return payload as PaginatedResponse<T>;
}

function toQueryString(
  entries: Record<string, string | number | undefined | null>
): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(entries)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `?${query}` : "";
}

export function fetchHealth(): Promise<HealthStatus> {
  return request<HealthStatus>("/api/health");
}

export function fetchAccounts(options?: { status?: AccountStatusFilter }): Promise<AccountSummary[]> {
  const suffix = toQueryString({
    status: options?.status && options.status !== "all" ? options.status : undefined,
  });
  return request<AccountSummary[]>(`/api/accounts${suffix}`);
}

export function updateAccountAlias(accountId: string, alias: string | null): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/accounts/${encodeURIComponent(accountId)}`, {
    method: "PATCH",
    body: JSON.stringify({ alias }),
  });
}

export function fetchCapabilities(): Promise<CapabilityCollection> {
  return request<CapabilityCollection>("/api/capabilities");
}

export function fetchLegacySkills(): Promise<LegacySkillInfo[]> {
  return request<LegacySkillInfo[]>("/api/legacy/skills");
}

export function fetchTools(): Promise<ToolInfo[]> {
  return request<ToolInfo[]>("/api/tools");
}

export function fetchToolSource(name: string): Promise<MarkdownSource> {
  return request<MarkdownSource>(`/api/tools/${encodeURIComponent(name)}/source`);
}

export function installTool(markdown: string): Promise<ToolInfo> {
  return request<ToolInfo>("/api/tools", {
    method: "POST",
    body: JSON.stringify({ markdown }),
  });
}

export function updateTool(name: string, markdown: string): Promise<ToolInfo> {
  return request<ToolInfo>(`/api/tools/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ markdown }),
  });
}

export function enableTool(name: string): Promise<ToolInfo> {
  return request<ToolInfo>(`/api/tools/${encodeURIComponent(name)}/enable`, {
    method: "POST",
    body: "{}",
  });
}

export function disableTool(name: string): Promise<ToolInfo> {
  return request<ToolInfo>(`/api/tools/${encodeURIComponent(name)}/disable`, {
    method: "POST",
    body: "{}",
  });
}

export function removeTool(name: string): Promise<{ name: string }> {
  return request<{ name: string }>(`/api/tools/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export function fetchSkills(): Promise<SkillInfo[]> {
  return request<SkillInfo[]>("/api/skills");
}

export function fetchMcpServers(): Promise<McpServerInfo[]> {
  return request<McpServerInfo[]>("/api/mcp/servers");
}

export function createMcpServer(payload: McpServerRequestPayload): Promise<McpServerInfo> {
  return request<McpServerInfo>("/api/mcp/servers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMcpServer(
  id: string,
  payload: McpServerRequestPayload
): Promise<McpServerInfo> {
  return request<McpServerInfo>(`/api/mcp/servers/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function refreshMcpServer(id: string): Promise<McpServerInfo> {
  return request<McpServerInfo>(`/api/mcp/servers/${encodeURIComponent(id)}/refresh`, {
    method: "POST",
    body: "{}",
  });
}

export function enableMcpServer(id: string): Promise<McpServerInfo> {
  return request<McpServerInfo>(`/api/mcp/servers/${encodeURIComponent(id)}/enable`, {
    method: "POST",
    body: "{}",
  });
}

export function disableMcpServer(id: string): Promise<McpServerInfo> {
  return request<McpServerInfo>(`/api/mcp/servers/${encodeURIComponent(id)}/disable`, {
    method: "POST",
    body: "{}",
  });
}

export function deleteMcpServer(id: string): Promise<{ id: string }> {
  return request<{ id: string }>(`/api/mcp/servers/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function fetchMcpTools(): Promise<McpToolInfo[]> {
  return request<McpToolInfo[]>("/api/mcp/tools");
}

export function enableMcpTool(id: string): Promise<McpToolInfo> {
  return request<McpToolInfo>(`/api/mcp/tools/${encodeURIComponent(id)}/enable`, {
    method: "POST",
    body: "{}",
  });
}

export function disableMcpTool(id: string): Promise<McpToolInfo> {
  return request<McpToolInfo>(`/api/mcp/tools/${encodeURIComponent(id)}/disable`, {
    method: "POST",
    body: "{}",
  });
}

export function fetchSkillSource(name: string): Promise<MarkdownSource> {
  return request<MarkdownSource>(`/api/skills/${encodeURIComponent(name)}/source`);
}

export function installSkill(markdown: string): Promise<SkillInfo> {
  return request<SkillInfo>("/api/skills", {
    method: "POST",
    body: JSON.stringify({ markdown }),
  });
}

export function updateSkill(name: string, markdown: string): Promise<SkillInfo> {
  return request<SkillInfo>(`/api/skills/${encodeURIComponent(name)}`, {
    method: "PUT",
    body: JSON.stringify({ markdown }),
  });
}

export function enableSkill(name: string): Promise<SkillInfo> {
  return request<SkillInfo>(`/api/skills/${encodeURIComponent(name)}/enable`, {
    method: "POST",
    body: "{}",
  });
}

export function disableSkill(name: string): Promise<SkillInfo> {
  return request<SkillInfo>(`/api/skills/${encodeURIComponent(name)}/disable`, {
    method: "POST",
    body: "{}",
  });
}

export function removeSkill(name: string): Promise<{ name: string }> {
  return request<{ name: string }>(`/api/skills/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
}

export function fetchConversations(accountId: string): Promise<ConversationRow[]> {
  return request<ConversationRow[]>(`/api/accounts/${encodeURIComponent(accountId)}/conversations`);
}

export function fetchTapeGraph(
  accountId: string,
  branch = "__global__",
): Promise<TapeGraphResponse> {
  return request<TapeGraphResponse>(
    `/api/tape/graph${toQueryString({ accountId, branch })}`
  );
}

export function fetchMessages(
  accountId: string,
  conversationId: string,
  options?: { before?: number; limit?: number }
): Promise<PaginatedResponse<MessageRow>> {
  const suffix = toQueryString({
    limit: options?.limit,
    before: options?.before,
  });

  return requestPaginated<MessageRow>(
    `/api/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`
  );
}

export function fetchObservabilityOverview(
  window: ObservabilityWindow
): Promise<ObservabilityOverview> {
  return request<ObservabilityOverview>(
    `/api/observability/overview${toQueryString({ window })}`
  );
}

export function fetchObservabilityTraces(options: {
  window: ObservabilityWindow;
  limit?: number;
  cursor?: number;
  flag?: string;
  status?: "ok" | "error";
  query?: string;
}): Promise<PaginatedResponse<ObservabilityTraceSummary>> {
  return requestPaginated<ObservabilityTraceSummary>(
    `/api/observability/traces${toQueryString({
      window: options.window,
      limit: options.limit,
      cursor: options.cursor,
      flag: options.flag,
      status: options.status,
      query: options.query,
    })}`
  );
}

export function fetchObservabilityTrace(
  traceId: string
): Promise<ObservabilityTraceDetail> {
  return request<ObservabilityTraceDetail>(
    `/api/observability/traces/${encodeURIComponent(traceId)}`
  );
}

export function startLogin(): Promise<LoginState> {
  return request<LoginState>("/api/login/start", { method: "POST", body: "{}" });
}

export function fetchLoginStatus(): Promise<LoginState> {
  return request<LoginState>("/api/login/status");
}

export function cancelLogin(): Promise<LoginState> {
  return request<LoginState>("/api/login/cancel", { method: "POST", body: "{}" });
}

export function login(username: string, password: string): Promise<{ token: string; expiresIn: string }> {
  return request<{ token: string; expiresIn: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

// ── Webhooks ──

export interface WebhookTokenInfo {
  source: string;
  tokenPrefix: string;
  description: string | null;
  accountIds: string[];
  enabled: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface WebhookLogEntry {
  accountId: string;
  conversationId: string;
  status: string;
  error: string | null;
  createdAt: string;
}

export type WebhookMessageType = "text" | "image";

export type WebhookTestRequest =
  | {
      accountId: string;
      conversationId: string;
      type: "text";
      text: string;
    }
  | {
      accountId: string;
      conversationId: string;
      type: "image";
      imageUrl: string;
      text?: string;
    };

/** Raw request helper for webhook endpoints that return plain JSON (not wrapped in { data }). */
async function webhookRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }
  const token = getAuthToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    localStorage.removeItem("auth_token");
    window.location.href = "/auth/login";
    throw new Error("Unauthorized");
  }
  const payload = await response.json().catch(() => ({ error: "invalid response" }));
  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? payload.message ?? `request failed with status ${response.status}`);
  }
  return payload as T;
}

export function fetchWebhookTokens(): Promise<{ data: WebhookTokenInfo[] }> {
  return webhookRequest<{ data: WebhookTokenInfo[] }>("/api/webhooks/tokens");
}

export function createWebhookToken(params: {
  source: string;
  description?: string;
  accountIds: string[];
}): Promise<{ token: string; source: string; accountIds: string[]; enabled: boolean; createdAt: string }> {
  return webhookRequest("/api/webhooks/tokens", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function toggleWebhookToken(source: string, enabled: boolean): Promise<{ success: boolean }> {
  return webhookRequest(`/api/webhooks/tokens/${encodeURIComponent(source)}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export function rotateWebhookToken(source: string): Promise<{ token: string; source: string; rotatedAt: string }> {
  return webhookRequest(`/api/webhooks/tokens/${encodeURIComponent(source)}/rotate`, {
    method: "POST",
    body: "{}",
  });
}

export function deleteWebhookToken(source: string): Promise<{ success: boolean }> {
  return webhookRequest(`/api/webhooks/tokens/${encodeURIComponent(source)}`, {
    method: "DELETE",
  });
}

export function fetchWebhookLogs(source: string, limit = 20): Promise<{ data: WebhookLogEntry[] }> {
  return webhookRequest<{ data: WebhookLogEntry[] }>(
    `/api/webhooks/tokens/${encodeURIComponent(source)}/logs?limit=${limit}`
  );
}

export function testWebhookToken(
  source: string,
  payload: WebhookTestRequest
): Promise<{ success: boolean; messageId: string; type: WebhookMessageType }> {
  return webhookRequest(`/api/webhooks/tokens/${encodeURIComponent(source)}/test`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ── Scheduled Tasks ──

export interface ScheduledTaskDto {
  id: string;
  seq: number;
  accountId: string;
  conversationId: string;
  name: string;
  prompt: string;
  type: "once" | "recurring";
  cron: string;
  timezone: string;
  enabled: boolean;
  status: "idle" | "running" | "error" | "paused";
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  runCount: number;
  failStreak: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRunDto {
  id: string;
  status: "success" | "error" | "timeout" | "skipped";
  prompt: string;
  result: string | null;
  durationMs: number | null;
  error: string | null;
  pushed: boolean;
  createdAt: string;
}

// Note: request() extracts payload.data, so these return the array directly, not wrapped in { data: ... }
export function fetchScheduledTasks(accountId?: string): Promise<ScheduledTaskDto[]> {
  const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
  return request<ScheduledTaskDto[]>(`/api/scheduled-tasks${query}`);
}

export function fetchScheduledTask(accountId: string, seq: number): Promise<{ data: ScheduledTaskDto }> {
  return request<{ data: ScheduledTaskDto }>(`/api/scheduled-tasks/${encodeURIComponent(accountId)}/${seq}`);
}

export function toggleScheduledTask(
  accountId: string,
  seq: number,
  enabled: boolean,
): Promise<ScheduledTaskDto> {
  return request<ScheduledTaskDto>(
    `/api/scheduled-tasks/${encodeURIComponent(accountId)}/${seq}`,
    { method: "PATCH", body: JSON.stringify({ enabled }) },
  );
}

export function fetchScheduledTaskRuns(
  accountId: string,
  seq: number,
  limit?: number
): Promise<ScheduledTaskRunDto[]> {
  const query = limit ? `?limit=${limit}` : "";
  return request<ScheduledTaskRunDto[]>(
    `/api/scheduled-tasks/${encodeURIComponent(accountId)}/${seq}/runs${query}`
  );
}

// ── Model Config ────────────────────────────────────────────────────

export function fetchModelConfigs(): Promise<ModelConfigDto[]> {
  return request<ModelConfigDto[]>("/api/model-configs");
}

export function fetchModelProviderTemplates(): Promise<ModelProviderTemplateDto[]> {
  return request<ModelProviderTemplateDto[]>("/api/model-provider-templates");
}

export function createModelProviderTemplate(payload: {
  name: string;
  provider: string;
  model_ids: string[];
  api_key?: string | null;
  base_url?: string | null;
  enabled?: boolean;
}): Promise<ModelProviderTemplateDto> {
  return request<ModelProviderTemplateDto>("/api/model-provider-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function updateModelProviderTemplate(
  id: string,
  payload: {
    name: string;
    provider: string;
    model_ids: string[];
    api_key?: string | null;
    clear_api_key?: boolean;
    base_url?: string | null;
    enabled?: boolean;
  },
): Promise<ModelProviderTemplateDto> {
  return request<ModelProviderTemplateDto>(
    `/api/model-provider-templates/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export function deleteModelProviderTemplate(
  id: string,
): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(
    `/api/model-provider-templates/${encodeURIComponent(id)}`,
    {
      method: "DELETE",
    },
  );
}

export function upsertModelConfig(payload: {
  scope: "global" | "account" | "conversation";
  scope_key: string;
  purpose: string;
  template_id: string;
  model_id: string;
  enabled?: boolean;
  priority?: number;
}): Promise<ModelConfigDto> {
  return request<ModelConfigDto>("/api/model-configs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function deleteModelConfig(id: string): Promise<{ success: boolean }> {
  return request<{ success: boolean }>(`/api/model-configs/${id}`, {
    method: "DELETE",
  });
}
