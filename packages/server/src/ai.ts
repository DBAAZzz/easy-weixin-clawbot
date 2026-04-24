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
  createToolRegistry,
  createRuntimeProvisioner,
  setMessageStore,
  setTapeStore,
  setSchedulerStore,
  setScheduledTaskHandler,
  setPushService,
  setModelConfigStore,
  setHeartbeatStore,
  setHeartbeatExecutor,
  setWebToolService,
  schedulerToolRegistry,
  heartbeatToolRegistry,
  loadPromptAssets,
  setPromptAssets,
  validateTemplateVars,
  PROMPT_ASSET_SPECS,
} from "@clawbot/agent";
import { createBuiltinToolSnapshot } from "@clawbot/agent/tools/builtins";
import { setChatDeps } from "@clawbot/agent/chat";
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
} from "./paths.js";
import { sendProactiveMessage } from "./proactive-push.js";
import { createWebToolService } from "./web-tools/service.js";
import { rssTaskHandler } from "./api/routes/rss.js";

mkdirSync(DOWNLOADS_DIR, { recursive: true });

const aiLogger = createModuleLogger("ai");

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

export interface ConfigDiagnostics {
  info: {
    llmConfigSource: "database";
    apiPort: string;
  };
  warnings: string[];
}

export function getConfigDiagnostics(
  env: NodeJS.ProcessEnv = process.env,
): ConfigDiagnostics {
  const warnings: string[] = [];

  if (!env.DATABASE_URL || !env.DIRECT_URL) {
    warnings.push("missing-prisma-urls");
  }

  return {
    info: {
      llmConfigSource: "database",
      apiPort: env.API_PORT ?? "8028",
    },
    warnings,
  };
}

export function validateConfig() {
  const diagnostics = getConfigDiagnostics();

  aiLogger.info(diagnostics.info, "已加载运行时配置");

  if (diagnostics.warnings.includes("missing-prisma-urls")) {
    aiLogger.warn(
      "缺少 DATABASE_URL 或 DIRECT_URL，持久化与 API 查询将失败",
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

// ── Tool & skill registries ────────────────────────────────────────

export const localToolRegistry = createToolRegistry();
export const mcpToolRegistry = createToolRegistry();
export const skillRuntimeToolRegistry = createToolRegistry();
export const skillRegistry = createSkillRegistry();
export const skillInstaller = createSkillInstaller(skillRegistry);
export const runtimeProvisioner = createRuntimeProvisioner();

localToolRegistry.swap(createBuiltinToolSnapshot());
skillRuntimeToolRegistry.swap(createSkillRuntimeToolSnapshot(skillInstaller, runtimeProvisioner));

export const toolRegistry = createCompositeToolRegistry(
  localToolRegistry,
  mcpToolRegistry,
  schedulerToolRegistry,
  heartbeatToolRegistry,
  skillRuntimeToolRegistry,
);

// ── Agent runner ───────────────────────────────────────────────────

const runner = createAgentRunner(
  {},
  toolRegistry,
  skillRegistry,
);

// ── Port injection ─────────────────────────────────────────────────

setMessageStore(new PrismaMessageStore());
setTapeStore(new PrismaTapeStore());
setSchedulerStore(new PrismaSchedulerStore());
setScheduledTaskHandler(rssTaskHandler);
setModelConfigStore(new PrismaModelConfigStore());
setPushService({ sendProactiveMessage });
setHeartbeatStore(new PrismaHeartbeatStore());
setHeartbeatExecutor(createHeartbeatExecutor());
setWebToolService(createWebToolService());

setChatDeps({
  runner,
  log: {
    llm: log.llm,
    tool: log.tool,
    done: log.done,
  },
});
