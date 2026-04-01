import crypto from "node:crypto";

export function generateWebhookToken(): string {
  const randomBytes = crypto.randomBytes(32);
  return `whk_${randomBytes.toString("hex")}`;
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getTokenPrefix(token: string): string {
  return token.substring(0, 12);
}
