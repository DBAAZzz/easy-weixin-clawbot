import type { LoginState } from "@clawbot/shared";
import { request } from "./core/client";

export function startLogin(): Promise<LoginState> {
  return request<LoginState>("/api/login/start", { method: "POST", body: "{}" });
}

export function fetchLoginStatus(): Promise<LoginState> {
  return request<LoginState>("/api/login/status");
}

export function cancelLogin(): Promise<LoginState> {
  return request<LoginState>("/api/login/cancel", { method: "POST", body: "{}" });
}
