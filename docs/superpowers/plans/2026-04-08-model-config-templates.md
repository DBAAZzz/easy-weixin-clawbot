# Model Config Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct per-config model credentials with reusable provider templates, then rebuild `/model-config` around template management plus scoped template references.

**Architecture:** Persist provider credentials in a new `model_provider_templates` table and reduce `model_configs` to scoped bindings that reference templates plus one selected `model_id`. The server and agent layers expose joined config data to keep runtime resolution and admin listing simple, while the web page becomes a two-work-area screen: template management on top and scoped usage configs below.

**Tech Stack:** Prisma, Hono, TypeScript, React 19, Vite, node:test / tsx test runner

---

### Task 1: Lock Shared Contracts And Web API Payloads

**Files:**
- Create: `packages/web/tests/model-config-api.test.ts`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/web/src/lib/api.ts`

- [ ] **Step 1: Write the failing web API test**

```ts
import test from "node:test";
import assert from "node:assert/strict";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const originalLocalStorage = globalThis.localStorage;

test("createModelProviderTemplate posts template payload", async () => {
  let requestInit: RequestInit | undefined;
  globalThis.localStorage = {
    getItem: () => "token",
    removeItem: () => {},
  } as Storage;
  globalThis.window = { location: { href: "" } } as Window & typeof globalThis;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response(
      JSON.stringify({
        data: {
          id: "1",
          name: "OpenAI Main",
          provider: "openai",
          model_ids: ["gpt-5", "gpt-5-mini"],
          api_key_set: true,
          base_url: null,
          enabled: true,
          usage_count: 0,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const { createModelProviderTemplate } = await import("../src/lib/api.ts");

  await createModelProviderTemplate({
    name: "OpenAI Main",
    provider: "openai",
    model_ids: ["gpt-5", "gpt-5-mini"],
    api_key: "sk-test",
    base_url: null,
    enabled: true,
  });

  assert.equal(requestInit?.method, "POST");
  assert.match(String(requestInit?.body), /"provider":"openai"/);
  assert.match(String(requestInit?.body), /"model_ids":\["gpt-5","gpt-5-mini"\]/);
});

test("upsertModelConfig sends template_id instead of provider credentials", async () => {
  let requestInit: RequestInit | undefined;
  globalThis.localStorage = {
    getItem: () => "token",
    removeItem: () => {},
  } as Storage;
  globalThis.window = { location: { href: "" } } as Window & typeof globalThis;
  globalThis.fetch = async (_input, init) => {
    requestInit = init;
    return new Response(
      JSON.stringify({
        data: {
          id: "10",
          scope: "global",
          scope_key: "*",
          purpose: "chat",
          template_id: "1",
          template_name: "OpenAI Main",
          provider: "openai",
          model_id: "gpt-5",
          template_enabled: true,
          enabled: true,
          priority: 0,
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };

  const { upsertModelConfig } = await import("../src/lib/api.ts");

  await upsertModelConfig({
    scope: "global",
    scope_key: "*",
    purpose: "chat",
    template_id: "1",
    model_id: "gpt-5",
    enabled: true,
    priority: 0,
  });

  assert.doesNotMatch(String(requestInit?.body), /provider|api_key|base_url/);
  assert.match(String(requestInit?.body), /"template_id":"1"/);
  assert.match(String(requestInit?.body), /"model_id":"gpt-5"/);
});

test.after(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
  globalThis.localStorage = originalLocalStorage;
});
```

- [ ] **Step 2: Run the web API test to verify it fails**

Run: `node --test --experimental-strip-types packages/web/tests/model-config-api.test.ts`

Expected: FAIL because `createModelProviderTemplate` does not exist and `upsertModelConfig()` still expects provider credentials.

- [ ] **Step 3: Update shared DTOs and web API client**

```ts
export interface ModelProviderTemplateDto {
  id: string;
  name: string;
  provider: string;
  model_ids: string[];
  api_key_set: boolean;
  base_url: string | null;
  enabled: boolean;
  usage_count: number;
}

export interface ModelConfigDto {
  id: string;
  scope: "global" | "account" | "conversation";
  scope_key: string;
  purpose: string;
  template_id: string;
  template_name: string;
  provider: string;
  model_id: string;
  template_enabled: boolean;
  enabled: boolean;
  priority: number;
}

export function fetchModelProviderTemplates(): Promise<ModelProviderTemplateDto[]> {
  return request<ModelProviderTemplateDto[]>("/api/model-provider-templates");
}

export function createModelProviderTemplate(payload: {
  name: string;
  provider: string;
  model_ids: string[];
  api_key?: string | null;
  base_url?: string | null;
  enabled?: boolean;
}): Promise<ModelProviderTemplateDto> {
  return request<ModelProviderTemplateDto>("/api/model-provider-templates", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateModelProviderTemplate(
  id: string,
  payload: {
    name: string;
    provider: string;
    model_ids: string[];
    api_key?: string | null;
    clear_api_key?: boolean;
    base_url?: string | null;
    enabled?: boolean;
  },
): Promise<ModelProviderTemplateDto> {
  return request<ModelProviderTemplateDto>(
    `/api/model-provider-templates/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(payload) },
  );
}
```

- [ ] **Step 4: Re-run the web API test**

Run: `node --test --experimental-strip-types packages/web/tests/model-config-api.test.ts`

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts packages/web/src/lib/api.ts packages/web/tests/model-config-api.test.ts
git commit -m "feat: add model provider template api contracts"
```

### Task 2: Redesign Agent Store Contracts And Resolver Behavior

**Files:**
- Create: `packages/agent/src/model-resolver.test.ts`
- Modify: `packages/agent/src/ports/model-config-store.ts`
- Modify: `packages/agent/src/ports/index.ts`
- Modify: `packages/agent/src/model-resolver.ts`

- [ ] **Step 1: Write the failing resolver test**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveModel,
  invalidateModelCache,
} from "./model-resolver.ts";
import {
  setModelConfigStore,
  type ModelConfigStore,
} from "./ports/model-config-store.ts";

function makeStore(): ModelConfigStore {
  return {
    async listTemplates() {
      return [];
    },
    async createTemplate() {
      throw new Error("not implemented");
    },
    async updateTemplate() {
      throw new Error("not implemented");
    },
    async deleteTemplate() {
      return false;
    },
    async getTemplateById() {
      return null;
    },
    async listAllConfigs() {
      return [];
    },
    async upsertConfig() {
      throw new Error("not implemented");
    },
    async deleteConfig() {
      return false;
    },
    async findByScope(scope, scopeKey) {
      if (scope === "global" && scopeKey === "*") {
        return [
          {
            id: 1n,
            scope: "global",
            scopeKey: "*",
            purpose: "chat",
            templateId: 5n,
            templateName: "Moonshot Main",
            provider: "moonshot",
            modelId: "moonshot-v1-8k",
            modelIds: ["moonshot-v1-8k", "moonshot-v1-32k"],
            apiKey: "sk-test",
            baseUrl: "https://api.moonshot.cn/v1",
            templateEnabled: true,
            enabled: true,
            priority: 0,
          },
        ];
      }
      return [];
    },
  };
}

test("resolveModel uses template-backed config data", async () => {
  setModelConfigStore(makeStore());
  invalidateModelCache();

  const resolved = await resolveModel("wxid_1", "conv_1", "chat");

  assert.equal(resolved.modelId, "moonshot-v1-8k");
  assert.equal(resolved.apiKey, "sk-test");
});

test("resolveModel skips disabled templates and falls back", async () => {
  let calls = 0;
  setModelConfigStore({
    ...makeStore(),
    async findByScope(scope, scopeKey) {
      calls++;
      if (scope === "global" && scopeKey === "*") {
        return [
          {
            id: 2n,
            scope: "global",
            scopeKey: "*",
            purpose: "chat",
            templateId: 6n,
            templateName: "Disabled OpenAI",
            provider: "openai",
            modelId: "gpt-5",
            modelIds: ["gpt-5"],
            apiKey: "sk-test",
            baseUrl: null,
            templateEnabled: false,
            enabled: true,
            priority: 0,
          },
        ];
      }
      return [];
    },
  });
  invalidateModelCache();

  await assert.rejects(
    () => resolveModel("wxid_1", "conv_1", "chat"),
    /Default model not set/,
  );
  assert.ok(calls > 0);
});
```

- [ ] **Step 2: Run the resolver test to verify it fails**

Run: `pnpm -F @clawbot/agent exec tsx --test src/model-resolver.test.ts`

Expected: FAIL because the store interface and resolver still expect direct provider fields on `ModelConfigRow`.

- [ ] **Step 3: Extend the store contract and resolver**

```ts
export interface ModelProviderTemplateRow {
  id: bigint;
  name: string;
  provider: string;
  modelIds: string[];
  apiKey: string | null;
  baseUrl: string | null;
  enabled: boolean;
  usageCount: number;
}

export interface ModelConfigRow {
  id: bigint;
  scope: ModelScope;
  scopeKey: string;
  purpose: string;
  templateId: bigint;
  templateName: string;
  provider: string;
  modelId: string;
  modelIds: string[];
  apiKey: string | null;
  baseUrl: string | null;
  templateEnabled: boolean;
  enabled: boolean;
  priority: number;
}

function rowSupportsModel(row: ModelConfigRow): boolean {
  return row.modelIds.includes(row.modelId);
}

if (match && match.templateEnabled && rowSupportsModel(match)) {
  const model = buildModelFromConfig(match.provider, match.modelId, match.baseUrl);
  return {
    model,
    modelId: match.modelId,
    apiKey: match.apiKey ?? undefined,
  };
}
```

- [ ] **Step 4: Re-run the resolver test**

Run: `pnpm -F @clawbot/agent exec tsx --test src/model-resolver.test.ts`

Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/model-resolver.test.ts packages/agent/src/ports/model-config-store.ts packages/agent/src/ports/index.ts packages/agent/src/model-resolver.ts
git commit -m "feat: resolve models through provider templates"
```

### Task 3: Replace Server Persistence And Route Layer

**Files:**
- Create: `packages/server/src/api/routes/model-provider-templates.test.ts`
- Create: `packages/server/src/api/routes/model-config.test.ts`
- Modify: `packages/server/prisma/schema.prisma`
- Modify: `packages/server/src/db/model-config-store.impl.ts`
- Modify: `packages/server/src/api/routes/model-config.ts`
- Create: `packages/server/src/api/routes/model-provider-templates.ts`
- Modify: `packages/server/src/api/index.ts`

- [ ] **Step 1: Write the failing route tests**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { registerModelProviderTemplateRoutes } from "./model-provider-templates.ts";
import { registerModelConfigRoutes } from "./model-config.ts";

test("POST /api/model-provider-templates rejects empty model_ids", async () => {
  const app = new Hono();
  registerModelProviderTemplateRoutes(app);

  const response = await app.request("/api/model-provider-templates", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "OpenAI Main",
      provider: "openai",
      model_ids: [],
    }),
  });

  assert.equal(response.status, 400);
});

test("PUT /api/model-configs rejects model outside template list", async () => {
  const app = new Hono();
  registerModelConfigRoutes(app);

  const response = await app.request("/api/model-configs", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope: "global",
      scope_key: "*",
      purpose: "chat",
      template_id: "1",
      model_id: "not-allowed",
    }),
  });

  assert.equal(response.status, 400);
});
```

- [ ] **Step 2: Run the server route tests to verify they fail**

Run: `pnpm -F @clawbot/server exec tsx --test src/api/routes/model-provider-templates.test.ts src/api/routes/model-config.test.ts`

Expected: FAIL because the new route module does not exist and model-config route still validates provider credentials directly.

- [ ] **Step 3: Implement schema, Prisma store, and routes**

```prisma
model ModelProviderTemplate {
  id        BigInt   @id @default(autoincrement())
  name      String   @db.Text
  provider  String   @db.Text
  modelIds  String[] @default([]) @map("model_ids")
  apiKey    String?  @map("api_key") @db.Text
  baseUrl   String?  @map("base_url") @db.Text
  enabled   Boolean  @default(true)
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)
  configs   ModelConfig[]

  @@map("model_provider_templates")
}

model ModelConfig {
  id         BigInt               @id @default(autoincrement())
  scope      String               @db.Text
  scopeKey   String               @map("scope_key") @db.Text
  purpose    String               @db.Text
  templateId BigInt               @map("template_id")
  modelId    String               @map("model_id") @db.Text
  enabled    Boolean              @default(true)
  priority   Int                  @default(0)
  createdAt  DateTime             @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt  DateTime             @updatedAt @map("updated_at") @db.Timestamptz(6)
  template   ModelProviderTemplate @relation(fields: [templateId], references: [id], onDelete: Restrict)

  @@unique([scope, scopeKey, purpose], map: "model_config_scope_key_purpose_key")
  @@index([scope, scopeKey], map: "idx_model_config_scope")
  @@map("model_configs")
}
```

```ts
function normalizeModelIds(values: unknown): string[] {
  const normalized = Array.isArray(values)
    ? values.map((value) => String(value).trim()).filter(Boolean)
    : [];
  return [...new Set(normalized)];
}

if (!template.modelIds.includes(body.model_id)) {
  return c.json({ error: "model_id must belong to the selected template" }, 400);
}

if ((await store().countConfigsForTemplate(id)) > 0) {
  return c.json({ error: "template is still referenced by model configs" }, 409);
}
```

- [ ] **Step 4: Re-run the server route tests**

Run: `pnpm -F @clawbot/server exec tsx --test src/api/routes/model-provider-templates.test.ts src/api/routes/model-config.test.ts`

Expected: PASS.

- [ ] **Step 5: Regenerate Prisma client and validate schema**

Run: `pnpm -F @clawbot/server prisma:generate`

Expected: Prisma client generation succeeds.

Run: `pnpm -F @clawbot/server prisma:validate`

Expected: Prisma schema validation succeeds.

- [ ] **Step 6: Commit**

```bash
git add packages/server/prisma/schema.prisma packages/server/src/db/model-config-store.impl.ts packages/server/src/api/routes/model-config.ts packages/server/src/api/routes/model-provider-templates.ts packages/server/src/api/routes/model-provider-templates.test.ts packages/server/src/api/routes/model-config.test.ts packages/server/src/api/index.ts
git commit -m "feat: add provider template persistence and routes"
```

### Task 4: Rebuild The Model Config Page Around Templates

**Files:**
- Create: `packages/web/tests/model-config-form.test.ts`
- Create: `packages/web/src/pages/model-config/providerPresets.ts`
- Create: `packages/web/src/pages/model-config/templateForm.ts`
- Modify: `packages/web/src/pages/ModelConfigPage.tsx`

- [ ] **Step 1: Write a failing pure-function test for template form behavior**

```ts
import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeModelIdList,
  resolveNextSelectedModel,
} from "../src/pages/model-config/templateForm.ts";

test("normalizeModelIdList trims empties and duplicates", () => {
  assert.deepEqual(
    normalizeModelIdList([" gpt-5 ", "", "gpt-5", "gpt-5-mini "]),
    ["gpt-5", "gpt-5-mini"],
  );
});

test("resolveNextSelectedModel clears invalid model after template switch", () => {
  assert.equal(
    resolveNextSelectedModel("gpt-5", ["claude-sonnet-4"]),
    "",
  );
});
```

- [ ] **Step 2: Run the pure-function test to verify it fails**

Run: `node --test --experimental-strip-types packages/web/tests/model-config-form.test.ts`

Expected: FAIL because `templateForm.ts` and helper exports do not exist.

- [ ] **Step 3: Extract helper modules and rebuild the page**

```ts
export const MODEL_PROVIDER_PRESETS = [
  { label: "OpenAI", provider: "openai", baseUrlPlaceholder: "https://api.openai.com/v1" },
  { label: "Anthropic", provider: "anthropic" },
  { label: "Google Gemini", provider: "google" },
  { label: "DeepSeek", provider: "deepseek" },
  { label: "Moonshot", provider: "moonshot", baseUrlPlaceholder: "https://api.moonshot.cn/v1" },
  { label: "Kimi", provider: "kimi", baseUrlPlaceholder: "https://api.kimi.ai/v1" },
  { label: "OpenRouter", provider: "openrouter", baseUrlPlaceholder: "https://openrouter.ai/api/v1" },
  { label: "Azure OpenAI", provider: "azure-openai" },
  { label: "Custom", provider: "" },
] as const;

export function normalizeModelIdList(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function resolveNextSelectedModel(current: string, allowed: string[]): string {
  return allowed.includes(current) ? current : "";
}
```

The page rewrite must:

- load templates and configs together
- show template list + template detail editor in the top section
- show scoped usage config cards in the bottom section
- create usage configs only from enabled templates
- edit existing usage configs while still displaying disabled templates
- remove provider/api/base URL inputs from the scoped config editor
- render model selection as a `<select>` sourced from `template.model_ids`

- [ ] **Step 4: Re-run the pure-function test and build**

Run: `node --test --experimental-strip-types packages/web/tests/model-config-form.test.ts`

Expected: PASS.

Run: `pnpm -F @clawbot/web build`

Expected: Web package builds successfully.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/pages/model-config/providerPresets.ts packages/web/src/pages/model-config/templateForm.ts packages/web/src/pages/ModelConfigPage.tsx packages/web/tests/model-config-form.test.ts
git commit -m "feat: redesign model config page around templates"
```

### Task 5: Final Verification And Regression Sweep

**Files:**
- Modify: `docs/superpowers/plans/2026-04-08-model-config-templates.md`

- [ ] **Step 1: Run focused package tests**

Run: `node --test --experimental-strip-types packages/web/tests/model-config-api.test.ts packages/web/tests/model-config-form.test.ts`

Expected: PASS.

Run: `pnpm -F @clawbot/agent exec tsx --test src/model-resolver.test.ts`

Expected: PASS.

Run: `pnpm -F @clawbot/server exec tsx --test src/api/routes/model-provider-templates.test.ts src/api/routes/model-config.test.ts`

Expected: PASS.

- [ ] **Step 2: Run package builds**

Run: `pnpm -F @clawbot/shared build`

Expected: PASS.

Run: `pnpm -F @clawbot/agent build`

Expected: PASS.

Run: `pnpm -F @clawbot/web build`

Expected: PASS.

- [ ] **Step 3: Run server build if route dependencies allow**

Run: `pnpm -F @clawbot/server build`

Expected: PASS, unless blocked by the known unrelated `generateTapeGraph` issue in `packages/server/src/api/routes/tape.ts`.

If it still fails on the same unrelated error, record that explicitly as an existing repo issue rather than a regression from this change.

- [ ] **Step 4: Update the plan checkboxes and summarize any residual risk**

```md
- [x] Task 1 complete
- [x] Task 2 complete
- [x] Task 3 complete
- [x] Task 4 complete
- [x] Task 5 complete
```

Execution summary:

- [x] Task 1 complete
- [x] Task 2 complete
- [x] Task 3 complete
- [x] Task 4 complete
- [x] Task 5 complete

Residual risk:

- `packages/server build` still fails in this repository, but the current failure is the pre-existing `TS6305` declaration/output chain across `@clawbot/server` -> `@clawbot/agent`, plus existing implicit-`any` errors in unrelated server files and tests.
- The new model template feature itself passed its focused web tests, agent resolver tests, server route tests, Prisma generate/validate, and `shared/agent/web` builds.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-04-08-model-config-templates.md
git commit -m "docs: mark model config templates plan complete"
```
