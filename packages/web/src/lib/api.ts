import type {
  AccountSummary,
  ApiResponse,
  CapabilityCollection,
  ConversationRow,
  HealthStatus,
  LegacySkillInfo,
  LoginState,
  MarkdownSource,
  MessageRow,
  PaginatedResponse,
  SkillInfo,
  ToolInfo,
} from "@clawbot/shared";

const API_SECRET = import.meta.env.VITE_API_SECRET;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);

  if (!headers.has("Content-Type") && init?.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }

  if (API_SECRET) {
    headers.set("Authorization", `Bearer ${API_SECRET}`);
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

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

  if (API_SECRET) {
    headers.set("Authorization", `Bearer ${API_SECRET}`);
  }

  const response = await fetch(path, {
    ...init,
    headers,
  });

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

export function fetchHealth(): Promise<HealthStatus> {
  return request<HealthStatus>("/api/health");
}

export function fetchAccounts(): Promise<AccountSummary[]> {
  return request<AccountSummary[]>("/api/accounts");
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

export function fetchMessages(
  accountId: string,
  conversationId: string,
  options?: { before?: number; limit?: number }
): Promise<PaginatedResponse<MessageRow>> {
  const search = new URLSearchParams();
  if (options?.limit) search.set("limit", String(options.limit));
  if (options?.before) search.set("before", String(options.before));

  const query = search.toString();
  const suffix = query ? `?${query}` : "";

  return requestPaginated<MessageRow>(
    `/api/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`
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
