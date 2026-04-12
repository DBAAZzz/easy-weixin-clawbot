import type { ApiResponse, PaginatedResponse } from "@clawbot/shared";
import { clearAuthAndRedirect, getAuthToken } from "./auth";

function buildHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type") && init?.method && init.method !== "GET") {
    headers.set("Content-Type", "application/json");
  }
  const token = getAuthToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return headers;
}

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = buildHeaders(init);

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    clearAuthAndRedirect();
  }

  const payload = (await response
    .json()
    .catch(() => ({ error: "invalid response" }))) as ApiResponse<T>;

  if (!response.ok || payload.error) {
    throw new Error(payload.error ?? `request failed with status ${response.status}`);
  }

  return payload.data as T;
}

export async function requestPaginated<T>(
  path: string,
  init?: RequestInit,
): Promise<PaginatedResponse<T>> {
  const headers = buildHeaders(init);

  const response = await fetch(path, {
    ...init,
    headers,
  });

  if (response.status === 401) {
    clearAuthAndRedirect();
  }

  const payload = (await response.json().catch(() => ({ error: "invalid response" }))) as
    | PaginatedResponse<T>
    | { error?: string };

  if (!response.ok || ("error" in payload && payload.error)) {
    throw new Error(
      "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `request failed with status ${response.status}`,
    );
  }

  return payload as PaginatedResponse<T>;
}

/** Raw request helper for endpoints that return plain JSON (not wrapped in { data }). */
export async function rawRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = buildHeaders(init);

  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    clearAuthAndRedirect();
  }
  const payload = await response.json().catch(() => ({ error: "invalid response" }));
  if (!response.ok || payload.error) {
    throw new Error(
      payload.error ?? payload.message ?? `request failed with status ${response.status}`,
    );
  }
  return payload as T;
}
