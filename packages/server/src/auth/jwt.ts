import jwt from "jsonwebtoken";
import type { AuthConfig } from "../config/auth.js";

export interface JwtPayload {
  username: string;
  iat: number;
  exp: number;
}

export function generateToken(username: string, config: AuthConfig): string {
  const expiry = parseExpiry(config.tokenExpiry);

  return jwt.sign(
    { username },
    config.jwtSecret,
    { expiresIn: expiry }
  );
}

export function verifyToken(token: string, secret: string): JwtPayload {
  return jwt.verify(token, secret) as JwtPayload;
}

function parseExpiry(expiry: string): number {
  const match = expiry.match(/^(\d+)([hdm])$/);
  if (!match) return 86400;

  const [, num, unit] = match;
  const value = parseInt(num, 10);

  switch (unit) {
    case "h": return value * 3600;
    case "d": return value * 86400;
    case "m": return value * 60;
    default: return 86400;
  }
}
