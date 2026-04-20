/**
 * Bootstrap — reads env, creates agent runner, injects port implementations.
 *
 * After migration, this file no longer contains chat() or media logic.
 * Those live in @clawbot/agent.
 */

import "./config/load-env.js";
import {
  createCompositeToolRegistry,
  createAgentRunner,
  createSkillInstaller,
  createSkillRegistry,
  createSkillRuntimeToolSnapshot,
  createToolInstaller,
  createToolRegistry,
  createRuntimeProvisioner,
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
import { createModuleLogger, getErrorFields, log } from "./logger.js";
import {
  DOWNLOADS_DIR,
  SKILLS_BUILTIN_DIR,
  SKILLS_USER_DIR,
  TOOLS_BUILTIN_DIR,
  TOOLS_USER_DIR,
} from "./paths.js";
import { sendProactiveMessage } from "./proactive-push.js";

mkdirSync(DOWNLOADS_DIR, { recursive: true });

const aiLogger = createModuleLogger("ai");

// ── Env config ─────────────────────────────────────────────────────

const PROVIDER = process.env.LLM_PROVIDER ?? "anthropic";
const MODEL_ID = process.env.LLM_MODEL ?? "claude-sonnet-4-20250514";

const EXPLICIT_API_KEY = process.env.LLM_API_KEY ?? process.env.KEY;
const EXPLICIT_BASE_URL =
  process.env.LLM_BASE_URL && process.env.LLM_BASE_URL.trim()
    ? process.env.LLM_BASE_URL.trim()
    : null;

// ── Prompt assets ──────────────────────────────────────────────────

const promptAssets = loadPromptAssets({
  vars: {
    DOWNLOADS_DIR,
  },
});

for (const spec of PROMPT_ASSET_SPECS) {
  validateTemplateVars(spec.key, promptAssets.get(spec.key), spec.allowedRuntimeVars);
}

setPromptAssets(promptAssets);

// ── Config validation ──────────────────────────────────────────────

export function validateConfig() {
  aiLogger.info(
    {
      provider: PROVIDER,
      modelId: MODEL_ID,
      apiKeyConfigured: Boolean(EXPLICIT_API_KEY),
      apiKeyPreview: EXPLICIT_API_KEY ? `${EXPLICIT_API_KEY.slice(0, 6)}…` : null,
      baseUrl: EXPLICIT_BASE_URL ?? null,
      apiPort: process.env.API_PORT ?? "8028",
    },
    "已加载运行时配置",
  );

  if (!EXPLICIT_API_KEY) {
    const envMap: Record<string, string[]> = {
      anthropic: ["ANTHROPIC_API_KEY"],
      openai: ["OPENAI_API_KEY"],
      google: ["GOOGLE_API_KEY"],
      deepseek: ["DEEPSEEK_API_KEY"],
      moonshot: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
      kimi: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
      "kimi-coding": ["KIMI_API_KEY", "ANTHROPIC_API_KEY", "MOONSHOT_API_KEY"],
      xai: ["XAI_API_KEY"],
      groq: ["GROQ_API_KEY"],
      mistral: ["MISTRAL_API_KEY"],
    };
    const expected = envMap[PROVIDER];
    const hasExpected = expected?.some((key) => Boolean(process.env[key]));
    if (expected && !hasExpected) {
      aiLogger.warn(
        { provider: PROVIDER, expectedEnvKeys: expected },
        "缺少 LLM API Key 配置，后续调用将失败",
      );
    }
  }

  if (!process.env.DATABASE_URL && !process.env.SUPABASE_PASSWORD) {
    aiLogger.warn(
      "缺少 Prisma 数据库环境变量，持久化与 API 查询将失败",
    );
  }

  try {
    ensurePrismaUrls();
  } catch (error) {
    aiLogger.warn(
      { ...getErrorFields(error) },
      "Prisma URL 配置校验失败",
    );
  }
}

// ── Model resolution ───────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const { model, meta } = (() => {
  try {
    return buildModelFromConfig(PROVIDER, MODEL_ID, {
      apiKey: EXPLICIT_API_KEY,
      baseUrl: EXPLICIT_BASE_URL,
    });
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
export const skillRuntimeToolRegistry = createToolRegistry();
export const skillRegistry = createSkillRegistry();
export const skillInstaller = createSkillInstaller(skillRegistry);
export const runtimeProvisioner = createRuntimeProvisioner();

skillRuntimeToolRegistry.swap(createSkillRuntimeToolSnapshot(skillInstaller, runtimeProvisioner));

export const toolRegistry = createCompositeToolRegistry(
  localToolRegistry,
  mcpToolRegistry,
  schedulerToolRegistry,
  heartbeatToolRegistry,
  skillRuntimeToolRegistry,
);
export const toolInstaller = createToolInstaller(localToolRegistry);

const loadedTools = await toolInstaller.initialize(TOOLS_BUILTIN_DIR, TOOLS_USER_DIR);
const loadedSkills = await skillInstaller.initialize(SKILLS_BUILTIN_DIR, SKILLS_USER_DIR);

// ── Agent runner ───────────────────────────────────────────────────

const runner = createAgentRunner(
  {
    model,
    meta,
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
