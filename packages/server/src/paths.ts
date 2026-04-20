import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_FILE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(CURRENT_FILE_DIR, "..", "..", "..");
export const ROOT_ENV_FILE = resolve(REPO_ROOT, ".env");

export const DATA_DIR = resolve(REPO_ROOT, "data");
export const ACCOUNTS_FILE = resolve(DATA_DIR, "accounts.json");
export const MEDIA_CACHE_DIR = resolve(DATA_DIR, "media-cache");
export const TTS_CACHE_DIR = resolve(DATA_DIR, "tts-cache");
export const DOWNLOADS_DIR = resolve(DATA_DIR, "downloads");
export const TOOLS_BUILTIN_DIR = resolve(DATA_DIR, "tools", "builtin");
export const TOOLS_USER_DIR = resolve(DATA_DIR, "tools", "user");
export const SKILLS_BUILTIN_DIR = resolve(DATA_DIR, "skills", "builtin");
export const SKILLS_USER_DIR = resolve(DATA_DIR, "skills", "user");
