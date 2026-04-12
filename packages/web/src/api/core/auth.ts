export function getAuthToken(): string | null {
  return localStorage.getItem("auth_token");
}

export function clearAuthAndRedirect(): never {
  localStorage.removeItem("auth_token");
  window.location.href = "/auth/login";
  throw new Error("Unauthorized");
}
