/**
 * Media file extraction and path resolution — decoupled from transport layer.
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { ChatResponse } from "./types.js";

const SEND_FILE_RE = /\[send_file:(image|video|file):([^\]]+)\]/;

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"];
const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".mkv", ".avi"];
const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS, ".pdf", ".zip"];

/**
 * Resolve a file path that the LLM may have written with the wrong extension.
 * Returns the corrected path if found, or null if the file truly doesn't exist.
 */
export function resolveFilePath(filePath: string): string | null {
  if (existsSync(filePath)) return filePath;

  const dir = dirname(filePath);
  const nameWithoutExt = basename(filePath, extname(filePath));

  // Try alternate extensions in the same directory
  for (const ext of ALL_EXTS) {
    const candidate = join(dir, nameWithoutExt + ext);
    if (existsSync(candidate)) return candidate;
  }

  // Fallback: scan the directory for any file starting with the stem
  try {
    const entries = readdirSync(dir);
    const match = entries.find(
      (e) => e === nameWithoutExt || e.startsWith(nameWithoutExt + "."),
    );
    if (match) return join(dir, match);
  } catch {
    // dir doesn't exist or isn't readable
  }

  return null;
}

export function extractMediaFromText(text: string): {
  cleanText: string;
  media?: ChatResponse["media"];
} {
  const match = text.match(SEND_FILE_RE);
  if (!match) return { cleanText: text };

  const type = match[1] as "image" | "video" | "file";
  const url = match[2].trim();
  const cleanText = text.replace(SEND_FILE_RE, "").trim();

  // Validate the file exists before handing it to the SDK.
  // If missing, try to find a same-named file with a different extension
  // (LLM often guesses .jpg but the actual file may be .png / .webp etc.)
  const resolvedUrl = resolveFilePath(url);
  if (!resolvedUrl) {
    console.error(`[media] send_file: path not found — ${url}`);
    const hint = `\n\n(⚠️ 文件发送失败：路径不存在 ${url})`;
    return { cleanText: cleanText + hint };
  }

  if (resolvedUrl !== url) {
    console.log(`[media] send_file: extension corrected ${url} → ${resolvedUrl}`);
  }

  return { cleanText, media: { type, url: resolvedUrl } };
}
