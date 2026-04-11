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
  loadPromptAssets,
  setPromptAssets,
  validateTemplateVars,
  PROMPT_ASSET_SPECS,
  PROMPT_PROFILES,
} from "@clawbot/agent";
import { setChatDeps } from "@clawbot/agent/chat";
import { setDefaultModel, buildModelFromConfig } from "@clawbot/agent/model-resolver";
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

const EXPLICIT_API_KEY = process.env.LLM_API_KEY ?? process.env.KEY;

// ── Prompt assets ──────────────────────────────────────────────────

const promptAssets = loadPromptAssets({
  vars: {
    BASE_SYSTEM_PROMPT,
    DOWNLOADS_DIR,
  },
});

for (const spec of PROMPT_ASSET_SPECS) {
  validateTemplateVars(spec.key, promptAssets.get(spec.key), spec.allowedRuntimeVars);
}

setPromptAssets(promptAssets);

// The chat system prompt is loaded from the bundled agent prompt assets
// with startup variables resolved eagerly during bootstrap.
const SYSTEM_PROMPT = promptAssets.get(PROMPT_PROFILES.chat.systemPromptKey);

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
    const envMap: Record<string, string[]> = {
      anthropic: ["ANTHROPIC_API_KEY"],
      openai: ["OPENAI_API_KEY"],
      google: ["GOOGLE_API_KEY"],
      deepseek: ["DEEPSEEK_API_KEY"],
      moonshot: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
      kimi: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
      "kimi-coding": ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
      xai: ["XAI_API_KEY"],
      groq: ["GROQ_API_KEY"],
      mistral: ["MISTRAL_API_KEY"],
    };
    const expected = envMap[PROVIDER];
    const hasExpected = expected?.some((key) => Boolean(process.env[key]));
    if (expected && !hasExpected) {
      console.warn(
        `[config] WARNING: LLM_API_KEY not set and none of ${expected.join(" / ")} is set — API calls will fail`
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
const { model, meta } = (() => {
  try {
    return buildModelFromConfig(PROVIDER, MODEL_ID, { apiKey: EXPLICIT_API_KEY });
  } catch {
    throw new Error(
      `[ai] Unknown provider/model: LLM_PROVIDER="${PROVIDER}" LLM_MODEL="${MODEL_ID}". ` +
        `Check .env — e.g. LLM_PROVIDER=moonshot with LLM_MODEL=kimi-k2.5, or LLM_PROVIDER=deepseek with LLM_MODEL=deepseek-chat.`
    );
  }
})();

// Register the env-var model as the fallback default for ModelResolver
setDefaultModel({ model, modelId: MODEL_ID, meta });

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
    meta,
    systemPrompt: SYSTEM_PROMPT,
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
