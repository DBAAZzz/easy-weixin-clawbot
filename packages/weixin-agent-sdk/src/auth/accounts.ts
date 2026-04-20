import fs from "node:fs";
import path from "node:path";

import { resolveStateDir } from "../storage/state-dir.js";

export const DEFAULT_BASE_URL = "https://ilinkai.weixin.qq.com";
export const CDN_BASE_URL = "https://novac2c.cdn.weixin.qq.com/c2c";

/** Normalize an account ID to a filesystem-safe string. */
export function normalizeAccountId(raw: string): string {
  return raw.trim().toLowerCase().replace(/[@.]/g, "-");
}


// ---------------------------------------------------------------------------
// Account ID compatibility (legacy raw ID → normalized ID)
// ---------------------------------------------------------------------------

/**
 * Pattern-based reverse of normalizeWeixinAccountId for known weixin ID suffixes.
 * Used only as a compatibility fallback when loading accounts / sync bufs stored
 * under the old raw ID.
 * e.g. "b0f5860fdecb-im-bot" → "b0f5860fdecb@im.bot"
 */
export function deriveRawAccountId(normalizedId: string): string | undefined {
  if (normalizedId.endsWith("-im-bot")) {
    return `${normalizedId.slice(0, -7)}@im.bot`;
  }
  if (normalizedId.endsWith("-im-wechat")) {
    return `${normalizedId.slice(0, -10)}@im.wechat`;
  }
  return undefined;
}

/**
 * Resolve the openclaw.json config file path.
 * Checks OPENCLAW_CONFIG env var, then state dir.
 */
function resolveConfigPath(): string {
  const envPath = process.env.OPENCLAW_CONFIG?.trim();
  if (envPath) return envPath;
  return path.join(resolveStateDir(), "openclaw.json");
}

/**
 * Read `routeTag` from openclaw.json (for callers without an `OpenClawConfig` object).
 * Checks per-account `channels.<id>.accounts[accountId].routeTag` first, then section-level
 * `channels.<id>.routeTag`. Matches `feat_weixin_extension` behavior; channel key is `"openclaw-weixin"`.
 */
export function loadConfigRouteTag(accountId?: string): string | undefined {
  try {
    const configPath = resolveConfigPath();
    if (!fs.existsSync(configPath)) return undefined;
    const raw = fs.readFileSync(configPath, "utf-8");
    const cfg = JSON.parse(raw) as Record<string, unknown>;
    const channels = cfg.channels as Record<string, unknown> | undefined;
    const section = channels?.["openclaw-weixin"] as Record<string, unknown> | undefined;
    if (!section) return undefined;
    if (accountId) {
      const accounts = section.accounts as Record<string, Record<string, unknown>> | undefined;
      const tag = accounts?.[accountId]?.routeTag;
      if (typeof tag === "number") return String(tag);
      if (typeof tag === "string" && tag.trim()) return tag.trim();
    }
    if (typeof section.routeTag === "number") return String(section.routeTag);
    return typeof section.routeTag === "string" && section.routeTag.trim()
      ? section.routeTag.trim()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * No-op stub — config reload is now handled externally via `openclaw gateway restart`.
 */
export async function triggerWeixinChannelReload(): Promise<void> {}
