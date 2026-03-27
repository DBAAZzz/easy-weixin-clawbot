import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const OPENCLAW_DIR = join(homedir(), ".openclaw", "openclaw-weixin");
export const ACCOUNTS_FILE = join(OPENCLAW_DIR, "accounts.json");
export const MEDIA_CACHE_DIR = join(OPENCLAW_DIR, "media-cache");
export const TTS_CACHE_DIR = join(OPENCLAW_DIR, "tts-cache");

const CURRENT_FILE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(CURRENT_FILE_DIR, "..", "..", "..");

export const DATA_DIR = resolve(REPO_ROOT, "data");
export const TOOLS_BUILTIN_DIR = resolve(DATA_DIR, "tools", "builtin");
export const TOOLS_USER_DIR = resolve(DATA_DIR, "tools", "user");
export const SKILLS_BUILTIN_DIR = resolve(DATA_DIR, "skills", "builtin");
export const SKILLS_USER_DIR = resolve(DATA_DIR, "skills", "user");
