import assert from "node:assert/strict";
import test from "node:test";

const LLM_ENV_KEYS = [
  "LLM_PROVIDER",
  "LLM_MODEL",
  "LLM_BASE_URL",
  "LLM_API_KEY",
  "KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GOOGLE_API_KEY",
  "DEEPSEEK_API_KEY",
  "MOONSHOT_API_KEY",
  "KIMI_API_KEY",
  "XAI_API_KEY",
  "GROQ_API_KEY",
  "MISTRAL_API_KEY",
];

function snapshotEnv(keys: string[]): Map<string, string | undefined> {
  return new Map(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot: Map<string, string | undefined>): void {
  for (const [key, value] of snapshot) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

async function importFreshAiModule(tag: string) {
  return import(new URL(`./ai.ts?${tag}`, import.meta.url).href);
}

test("server ai bootstrap does not require LLM env vars", async () => {
  const snapshot = snapshotEnv([
    ...LLM_ENV_KEYS,
    "DATABASE_URL",
    "DIRECT_URL",
  ]);

  try {
    for (const key of LLM_ENV_KEYS) {
      delete process.env[key];
    }
    process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/clawbot";
    process.env.DIRECT_URL = "postgresql://postgres:postgres@127.0.0.1:5432/clawbot";

    await assert.doesNotReject(() => importFreshAiModule(`bootstrap-${Date.now()}`));
  } finally {
    restoreEnv(snapshot);
  }
});

test("config validation does not warn about missing LLM API keys", async () => {
  const snapshot = snapshotEnv([
    ...LLM_ENV_KEYS,
    "DATABASE_URL",
    "DIRECT_URL",
    "API_PORT",
  ]);

  try {
    for (const key of LLM_ENV_KEYS) {
      delete process.env[key];
    }
    process.env.DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:5432/clawbot";
    process.env.DIRECT_URL = "postgresql://postgres:postgres@127.0.0.1:5432/clawbot";
    process.env.API_PORT = "8028";

    const { getConfigDiagnostics } = await importFreshAiModule(`diagnostics-${Date.now()}`);
    const diagnostics = getConfigDiagnostics(process.env);

    assert.deepEqual(diagnostics.warnings, []);
    assert.deepEqual(diagnostics.info, {
      llmConfigSource: "database",
      apiPort: "8028",
    });
  } finally {
    restoreEnv(snapshot);
  }
});