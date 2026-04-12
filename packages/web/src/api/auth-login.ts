import { request } from "./core/client";

export function login(
  username: string,
  password: string,
): Promise<{ token: string; expiresIn: string }> {
  return request<{ token: string; expiresIn: string }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}
