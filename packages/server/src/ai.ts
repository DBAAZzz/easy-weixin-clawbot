/**
 * Bootstrap — reads env, creates agent runner, injects port implementations.
 *
 * After migration, this file no longer contains chat() or media logic.
 * Those live in @clawbot/agent.
 */

import {
  createCompositeToolRegistry,
  createAgentRunner,
  createSkillInstaller,
  createSkillRegistry,
  createToolInstaller,
  createToolRegistry,
  setMessageStore,
  setTapeStore,
  setSchedulerStore,
  setPushService,
  setModelConfigStore,
  setHeartbeatStore,
  setHeartbeatExecutor,
  schedulerToolRegistry,
  heartbeatToolRegistry,
} from "@clawbot/agent";
import { setChatDeps } from "@clawbot/agent/chat";
import { setDefaultModel, buildModelFromConfig } from "@clawbot/agent/model-resolver";
import type { Model } from "@mariozechner/pi-ai";
import { mkdirSync } from "node:fs";
import { ensurePrismaUrls } from "./db/prisma-env.js";
import { PrismaMessageStore } from "./db/message-store.impl.js";
import { PrismaTapeStore } from "./db/tape-store.impl.js";
import { PrismaSchedulerStore } from "./db/scheduler-store.impl.js";
import { PrismaModelConfigStore } from "./db/model-config-store.impl.js";
import { PrismaHeartbeatStore } from "./db/heartbeat-store.impl.js";
import { createHeartbeatExecutor } from "./db/heartbeat-executor.impl.js";
import { log } from "./logger.js";
import {
  DOWNLOADS_DIR,
  SKILLS_BUILTIN_DIR,
  SKILLS_USER_DIR,
  TOOLS_BUILTIN_DIR,
  TOOLS_USER_DIR,
} from "./paths.js";
import { sendProactiveMessage } from "./proactive-push.js";

mkdirSync(DOWNLOADS_DIR, { recursive: true });

// ── Env config ─────────────────────────────────────────────────────

const PROVIDER = process.env.LLM_PROVIDER ?? "anthropic";
const MODEL_ID = process.env.LLM_MODEL ?? "claude-sonnet-4-20250514";
const BASE_SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ?? "你是一个微信智能助手，回答简洁、友好。";

const MEDIA_SEND_INSTRUCTIONS = `
## 发送媒体文件

你可以向用户发送图片、视频或文件。当你需要发送媒体时，在回复末尾加上标记：

\`[send_file:<类型>:<文件路径>]\`

类型：image / video / file

示例：
- 发送图片：[send_file:image:/path/to/photo.jpg]
- 发送视频：[send_file:video:/path/to/video.mp4]
- 发送文件：[send_file:file:/path/to/doc.pdf]

**使用 opencli 下载内容后发送给用户的流程：**
1. 调用 opencli download 命令时，必须加 --output ${DOWNLOADS_DIR} 指定下载目录
2. 使用 -f json 获取结构化输出，从中提取实际保存的文件路径
3. 在回复中加上 [send_file:类型:文件路径] 标记将文件发给用户

注意：标记会被自动解析移除，用户不会看到。每条回复只能发送一个媒体文件。
`.trim();

const SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}\n\n${MEDIA_SEND_INSTRUCTIONS}`;

const EXPLICIT_API_KEY = process.env.LLM_API_KEY ?? process.env.KEY;

// ── Config validation ──────────────────────────────────────────────

export function validateConfig() {
  const lines = [
    `  provider : ${PROVIDER}`,
    `  model    : ${MODEL_ID}`,
    `  api key  : ${EXPLICIT_API_KEY ? `${EXPLICIT_API_KEY.slice(0, 6)}…` : "(none — using provider env var)"}`,
    `  api port : ${process.env.API_PORT ?? "3001"}`,
  ];
  console.log("[config]\n" + lines.join("\n"));

  if (!EXPLICIT_API_KEY) {
    const envMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      "kimi-coding": "KIMI_API_KEY",
      google: "GOOGLE_API_KEY",
    };
    const expected = envMap[PROVIDER];
    if (expected && !process.env[expected]) {
      console.warn(
        `[config] WARNING: LLM_API_KEY not set and ${expected} is missing — API calls will fail`
      );
    }
  }

  if (!process.env.DATABASE_URL && !process.env.SUPABASE_PASSWORD) {
    console.warn(
      "[config] WARNING: Prisma database env vars missing — persistence/API queries will fail"
    );
  }

  if (!process.env.API_SECRET) {
    console.warn("[config] WARNING: API_SECRET missing — web API auth will reject all requests");
  }

  try {
    ensurePrismaUrls();
  } catch (error) {
    console.warn(`[config] WARNING: ${(error as Error).message}`);
  }
}

// ── Model resolution ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const model: Model<any> = (() => {
  try {
    return buildModelFromConfig(PROVIDER, MODEL_ID);
  } catch {
    throw new Error(
      `[ai] Unknown provider/model: LLM_PROVIDER="${PROVIDER}" LLM_MODEL="${MODEL_ID}". ` +
        `Check .env — for Moonshot use LLM_PROVIDER=moonshot, for Kimi K2 use LLM_PROVIDER=kimi-coding with LLM_MODEL=kimi-k2-thinking or k2p5.`
    );
  }
})();

// Register the env-var model as the fallback default for ModelResolver
setDefaultModel({ model, modelId: MODEL_ID, apiKey: EXPLICIT_API_KEY });

// ── Tool & skill registries ────────────────────────────────────────

export const localToolRegistry = createToolRegistry();
export const mcpToolRegistry = createToolRegistry();

export const toolRegistry = createCompositeToolRegistry(localToolRegistry, mcpToolRegistry, schedulerToolRegistry, heartbeatToolRegistry);
export const toolInstaller = createToolInstaller(localToolRegistry);
export const skillRegistry = createSkillRegistry();
export const skillInstaller = createSkillInstaller(skillRegistry);

const loadedTools = await toolInstaller.initialize(TOOLS_BUILTIN_DIR, TOOLS_USER_DIR);
const loadedSkills = await skillInstaller.initialize(SKILLS_BUILTIN_DIR, SKILLS_USER_DIR);

console.log(`[tools] loaded: ${loadedTools.loaded.join(", ") || "(none)"}`);
for (const failure of loadedTools.failed) {
  console.warn(`[tools] compile-error ${failure.filePath}: ${failure.error}`);
}

console.log(`[skills] loaded: ${loadedSkills.loaded.join(", ") || "(none)"}`);
for (const failure of loadedSkills.failed) {
  console.warn(`[skills] compile-error ${failure.filePath}: ${failure.error}`);
}

// ── Agent runner ───────────────────────────────────────────────────

const runner = createAgentRunner(
  {
    model,
    systemPrompt: SYSTEM_PROMPT,
    apiKey: EXPLICIT_API_KEY,
  },
  toolRegistry,
  skillRegistry,
);

// ── Port injection ─────────────────────────────────────────────────

setMessageStore(new PrismaMessageStore());
setTapeStore(new PrismaTapeStore());
setSchedulerStore(new PrismaSchedulerStore());
setModelConfigStore(new PrismaModelConfigStore());
setPushService({ sendProactiveMessage });
setHeartbeatStore(new PrismaHeartbeatStore());
setHeartbeatExecutor(createHeartbeatExecutor());

setChatDeps({
  runner,
  log: {
    llm: log.llm,
    tool: log.tool,
    done: log.done,
  },
});
