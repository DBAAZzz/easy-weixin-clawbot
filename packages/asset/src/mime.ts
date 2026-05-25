import { extname } from "node:path";
import type { AssetKind } from "./types.js";

const EXTENSIONS_BY_MIME: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
};

export function inferAssetKind(mimeType: string): AssetKind {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  return "file";
}

export function extensionForMimeType(mimeType: string, originalFilename?: string): string {
  const fromName = originalFilename ? extname(originalFilename) : "";
  if (fromName) return fromName.toLowerCase();
  return EXTENSIONS_BY_MIME[mimeType.toLowerCase()] ?? ".bin";
}
