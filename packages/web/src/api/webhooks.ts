import { rawRequest } from "./core/client";

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

export function fetchWebhookTokens(): Promise<{ data: WebhookTokenInfo[] }> {
  return rawRequest<{ data: WebhookTokenInfo[] }>("/api/webhooks/tokens");
}

export function createWebhookToken(params: {
  source: string;
  description?: string;
  accountIds: string[];
}): Promise<{
  token: string;
  source: string;
  accountIds: string[];
  enabled: boolean;
  createdAt: string;
}> {
  return rawRequest("/api/webhooks/tokens", {
    method: "POST",
    body: JSON.stringify(params),
  });
}

export function toggleWebhookToken(
  source: string,
  enabled: boolean,
): Promise<{ success: boolean }> {
  return rawRequest(`/api/webhooks/tokens/${encodeURIComponent(source)}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export function rotateWebhookToken(
  source: string,
): Promise<{ token: string; source: string; rotatedAt: string }> {
  return rawRequest(`/api/webhooks/tokens/${encodeURIComponent(source)}/rotate`, {
    method: "POST",
    body: "{}",
  });
}

export function deleteWebhookToken(source: string): Promise<{ success: boolean }> {
  return rawRequest(`/api/webhooks/tokens/${encodeURIComponent(source)}`, {
    method: "DELETE",
  });
}

export function fetchWebhookLogs(source: string, limit = 20): Promise<{ data: WebhookLogEntry[] }> {
  return rawRequest<{ data: WebhookLogEntry[] }>(
    `/api/webhooks/tokens/${encodeURIComponent(source)}/logs?limit=${limit}`,
  );
}

export function testWebhookToken(
  source: string,
  payload: WebhookTestRequest,
): Promise<{ success: boolean; messageId: string; type: WebhookMessageType }> {
  return rawRequest(`/api/webhooks/tokens/${encodeURIComponent(source)}/test`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
