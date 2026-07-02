# Markdown Tool & Skill System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded in-memory tool registration with a Markdown-driven Tool and Skill system, expose management APIs, and ship matching web console pages.

**Architecture:** The agent package will own two independent registries backed by immutable snapshots: `tools` for executable handlers and `skills` for prompt injection. Server startup will load layered Markdown sources from `data/tools/*` and `data/skills/*`, expose CRUD/enable/source APIs, and the web app will split the current skills console into dedicated Tools and Skills pages while preserving the existing visual language.

**Tech Stack:** TypeScript, pnpm workspaces, React 19 + Vite, Hono, `@mariozechner/pi-ai`, YAML frontmatter parsing, Node test runner via `tsx --test`

---

### Task 1: Add test harness and lock the Markdown loading contracts

**Files:**
- Modify: `packages/agent/package.json`
- Create: `packages/agent/src/test/helpers.ts`
- Create: `packages/agent/src/tools/installer.test.ts`
- Create: `packages/agent/src/skills/installer.test.ts`
- Create: `packages/agent/src/runtime/skill-runtime.test.ts`

- [ ] **Step 1: Write the failing tool installer test**

```ts
test("tool installer loads builtin markdown tools and lets user layer override builtin", async () => {
  const fixture = await createTempCapabilityFixture({
    "tools/builtin/web-search.md": BUILTIN_WEB_SEARCH,
    "tools/user/web-search.md": USER_OVERRIDE_WEB_SEARCH,
    "tools/user/opencli.md": USER_OPENCLI,
  });

  const registry = createToolRegistry();
  const installer = createToolInstaller(registry);
  await installer.initialize(fixture.toolsBuiltinDir, fixture.toolsUserDir);

  const tools = installer.list();

  expect(tools.map((item) => item.name)).toEqual(["opencli", "web_search"]);
  expect(tools.find((item) => item.name === "web_search")?.origin).toBe("user");
  expect(registry.current().tools.map((item) => item.name)).toEqual(["opencli", "web_search"]);
});
```

- [ ] **Step 2: Run tool installer test to verify it fails**

Run: `pnpm --filter @clawbot/agent exec tsx --test src/tools/installer.test.ts`
Expected: FAIL because `createToolInstaller`, `createToolRegistry`, and fixture helpers do not exist yet.

- [ ] **Step 3: Write the failing skill installer test**

```ts
test("skill installer splits always-on and on-demand markdown skills into registry snapshot", async () => {
  const fixture = await createTempCapabilityFixture({
    "skills/builtin/default-tone.md": ALWAYS_ON_SKILL,
    "skills/user/translation-ja.md": ON_DEMAND_TRANSLATION,
  });

  const registry = createSkillRegistry();
  const installer = createSkillInstaller(registry);
  await installer.initialize(fixture.skillsBuiltinDir, fixture.skillsUserDir);

  const snapshot = registry.current();

  expect(snapshot.alwaysOn.map((item) => item.name)).toEqual(["default-tone"]);
  expect(snapshot.index.map((item) => item.name)).toEqual(["translation-ja"]);
  expect(snapshot.onDemand.has("translation-ja")).toBe(true);
});
```

- [ ] **Step 4: Run skill installer test to verify it fails**

Run: `pnpm --filter @clawbot/agent exec tsx --test src/skills/installer.test.ts`
Expected: FAIL because the new skill installer and registry snapshot shape do not exist yet.

- [ ] **Step 5: Write the failing skill runtime test**

```ts
test("use-skill runtime returns an enveloped tool result and enforces per-conversation limits", async () => {
  const runtime = createConversationSkillRuntime({
    registry: registryWithTranslationAndDigest(),
    maxOnDemandSkills: 1,
  });

  const first = await runtime.execute("translation-ja");
  const second = await runtime.execute("translation-ja");
  const third = await runtime.execute("digest-writer");

  expect(first[0]?.text).toContain('<skill name="translation-ja"');
  expect(second[0]?.text).toBe("ok");
  expect(third[0]?.text).toContain("已达上限");
});
```

- [ ] **Step 6: Run skill runtime test to verify it fails**

Run: `pnpm --filter @clawbot/agent exec tsx --test src/runtime/skill-runtime.test.ts`
Expected: FAIL because the helper runtime does not exist yet.

- [ ] **Step 7: Commit**

```bash
git add packages/agent/package.json packages/agent/src/test/helpers.ts packages/agent/src/tools/installer.test.ts packages/agent/src/skills/installer.test.ts packages/agent/src/runtime/skill-runtime.test.ts
git commit -m "test: add markdown capability system contracts"
```

### Task 2: Implement Markdown-driven tool loading and execution

**Files:**
- Create: `packages/agent/src/shared/parser.ts`
- Create: `packages/agent/src/tools/types.ts`
- Create: `packages/agent/src/tools/compiler.ts`
- Create: `packages/agent/src/tools/loader.ts`
- Create: `packages/agent/src/tools/registry.ts`
- Create: `packages/agent/src/tools/installer.ts`
- Create: `packages/agent/src/tools/handlers/index.ts`
- Create: `packages/agent/src/tools/handlers/web-search.ts`
- Create: `packages/agent/src/tools/handlers/cli.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Implement frontmatter parsing and validation**

```ts
export async function parseMdFile(filePath: string): Promise<ParsedFile> {
  const raw = await readFile(filePath, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`Missing YAML frontmatter: ${filePath}`);

  const frontmatter = parse(match[1]);
  validateCapabilityName(frontmatter.name, filePath);

  return {
    frontmatter: asRecord(frontmatter, filePath),
    body: match[2].trim(),
    filePath,
  };
}
```

- [ ] **Step 2: Implement tool compiler and handler allowlist**

```ts
const HANDLER_ALLOWLIST: Record<string, NativeHandler> = {
  "web-search": webSearchHandler,
  cli: cliHandler,
};

export function compileTool(source: ToolSource): CompiledTool {
  const handler = getNativeHandler(source.handler);
  if (!handler) throw new Error(`Unknown tool handler: ${source.handler}`);

  return {
    source,
    jsonSchema: buildJsonSchema(source.inputSchema),
    execute(args, ctx) {
      return handler.execute(args, source.handlerConfig ?? {}, ctx);
    },
  };
}
```

- [ ] **Step 3: Implement immutable tool registry and layered installer**

```ts
export function createToolRegistry(): ToolRegistry {
  let snapshot: ToolSnapshot = { tools: [] };

  return {
    swap(next) {
      snapshot = next;
    },
    current() {
      return snapshot;
    },
    async execute(name, args, ctx) {
      const tool = snapshot.tools.find((item) => item.name === name);
      if (!tool) throw new Error(`Unknown tool: ${name}`);
      return tool.execute(args, ctx);
    },
  };
}
```

- [ ] **Step 4: Run the tool installer test to verify it passes**

Run: `pnpm --filter @clawbot/agent exec tsx --test src/tools/installer.test.ts`
Expected: PASS

- [ ] **Step 5: Refactor handler code only after green**

```ts
function buildToolSnapshot(installed: InstalledTool[]): ToolSnapshot {
  return {
    tools: installed
      .filter((item) => item.enabled)
      .map((item) => ({
        name: item.tool.source.name,
        description: item.tool.source.body,
        parameters: item.tool.jsonSchema,
        execute: item.tool.execute,
      })),
  };
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent/src/shared/parser.ts packages/agent/src/tools/types.ts packages/agent/src/tools/compiler.ts packages/agent/src/tools/loader.ts packages/agent/src/tools/registry.ts packages/agent/src/tools/installer.ts packages/agent/src/tools/handlers/index.ts packages/agent/src/tools/handlers/web-search.ts packages/agent/src/tools/handlers/cli.ts packages/agent/src/index.ts
git commit -m "feat: add markdown-driven tool registry"
```

### Task 3: Implement Markdown-driven skill loading and use-skill runtime

**Files:**
- Modify: `packages/agent/src/skills/types.ts`
- Create: `packages/agent/src/skills/compiler.ts`
- Create: `packages/agent/src/skills/loader.ts`
- Modify: `packages/agent/src/skills/registry.ts`
- Create: `packages/agent/src/skills/installer.ts`
- Create: `packages/agent/src/runtime/skill-runtime.ts`
- Modify: `packages/agent/src/runner.ts`
- Modify: `packages/agent/src/index.ts`

- [ ] **Step 1: Implement skill source parsing and compiled snapshot model**

```ts
export interface SkillSnapshot {
  readonly alwaysOn: ReadonlyArray<{ name: string; body: string }>;
  readonly index: ReadonlyArray<{ name: string; summary: string }>;
  readonly onDemand: ReadonlyMap<string, CompiledSkill>;
}
```

- [ ] **Step 2: Implement conversation-scoped use-skill runtime**

```ts
export function createConversationSkillRuntime(config: ConversationSkillRuntimeConfig) {
  const loaded = new Set<string>();

  return {
    async execute(skillName: string): Promise<ToolContent[]> {
      if (loaded.has(skillName)) return [{ type: "text", text: "ok" }];
      if (loaded.size >= config.maxOnDemandSkills) {
        return [{ type: "text", text: `本次对话已加载 ${loaded.size} 个技能，已达上限。` }];
      }
      const skill = config.registry.getOnDemandSkill(skillName);
      if (!skill) return [{ type: "text", text: `未找到技能: ${skillName}` }];
      loaded.add(skillName);
      return [{ type: "text", text: wrapSkillEnvelope(skill) }];
    },
  };
}
```

- [ ] **Step 3: Update the runner to combine system prompt, tools, and the `use_skill` meta tool**

```ts
const toolDefinitions = [...toolRegistry.current().tools, USE_SKILL_TOOL];
const systemPrompt = buildSystemPrompt(config.systemPrompt, skillRegistry.current());
```

- [ ] **Step 4: Run skill installer and runtime tests to verify they pass**

Run: `pnpm --filter @clawbot/agent exec tsx --test src/skills/installer.test.ts src/runtime/skill-runtime.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/agent/src/skills/types.ts packages/agent/src/skills/compiler.ts packages/agent/src/skills/loader.ts packages/agent/src/skills/registry.ts packages/agent/src/skills/installer.ts packages/agent/src/runtime/skill-runtime.ts packages/agent/src/runner.ts packages/agent/src/index.ts
git commit -m "feat: add markdown-driven skill runtime"
```

### Task 4: Wire server startup, storage, and management APIs

**Files:**
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`
- Modify: `packages/server/src/paths.ts`
- Modify: `packages/server/src/ai.ts`
- Modify: `packages/server/src/index.ts`
- Modify: `packages/server/src/api/index.ts`
- Create: `packages/server/src/api/routes/tools.ts`
- Modify: `packages/server/src/api/routes/skills.ts`

- [ ] **Step 1: Add the failing server API contract test**

```ts
test("capability routes expose tools, skills, and legacy skills compatibility", async () => {
  const app = createApiApp({
    runtime: stubRuntime,
    loginManager: stubLoginManager,
    capabilityApi: stubCapabilityApi,
    startedAt: new Date("2026-03-27T00:00:00Z"),
  });

  const tools = await app.request("/api/tools", authHeader());
  const skills = await app.request("/api/skills", authHeader());
  const legacy = await app.request("/api/legacy/skills", authHeader());

  expect(tools.status).toBe(200);
  expect(skills.status).toBe(200);
  expect(legacy.status).toBe(200);
});
```

- [ ] **Step 2: Run the server API test to verify it fails**

Run: `pnpm --filter @clawbot/server exec tsx --test src/api/routes/capabilities.test.ts`
Expected: FAIL because capability dependencies and routes are not implemented yet.

- [ ] **Step 3: Implement startup installers, file roots, and API routes**

```ts
const toolInstaller = createToolInstaller(toolRegistry);
const skillInstaller = createSkillInstaller(skillRegistry);

await toolInstaller.initialize(DATA_TOOLS_BUILTIN_DIR, DATA_TOOLS_USER_DIR);
await skillInstaller.initialize(DATA_SKILLS_BUILTIN_DIR, DATA_SKILLS_USER_DIR);
```

- [ ] **Step 4: Implement route handlers for list/detail/source/validate/install/update/delete/enable/disable**

```ts
app.post("/api/tools", async (c) => {
  const body = await c.req.json();
  const installed = await capabilityApi.tools.install(body.content);
  return c.json({ data: installed }, 201);
});
```

- [ ] **Step 5: Run the server API test to verify it passes**

Run: `pnpm --filter @clawbot/server exec tsx --test src/api/routes/capabilities.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/types.ts packages/shared/src/index.ts packages/server/src/paths.ts packages/server/src/ai.ts packages/server/src/index.ts packages/server/src/api/index.ts packages/server/src/api/routes/tools.ts packages/server/src/api/routes/skills.ts packages/server/src/api/routes/capabilities.test.ts
git commit -m "feat: expose markdown capability management APIs"
```

### Task 5: Add builtin Markdown assets and ship the web console

**Files:**
- Create: `data/tools/builtin/web-search.md`
- Create: `data/tools/builtin/opencli.md`
- Create: `data/skills/builtin/healthy-meal-reminder.md`
- Modify: `packages/web/src/lib/api.ts`
- Create: `packages/web/src/hooks/useTools.ts`
- Modify: `packages/web/src/hooks/useSkills.ts`
- Create: `packages/web/src/pages/ToolsPage.tsx`
- Modify: `packages/web/src/pages/SkillsPage.tsx`
- Modify: `packages/web/src/components/layout/Sidebar.tsx`
- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/components/ui/icons.tsx`

- [ ] **Step 1: Add builtin Markdown definitions matching the new loaders**

```md
---
name: web_search
version: 1.0.0
type: tool
summary: 搜索互联网，返回标题、链接和摘要
handler: web-search
inputSchema:
  query:
    type: string
    description: 搜索关键词或完整问题
    required: true
---

搜索互联网并返回标题、链接和摘要，适合查询最新信息或外部资料。
```

- [ ] **Step 2: Build ToolsPage and SkillsPage around list/source/status actions**

```tsx
<section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.9fr)]">
  <CapabilityTable items={tools} onSelect={setSelectedTool} />
  <CapabilitySourcePanel item={selectedTool} onToggle={toggleTool} />
</section>
```

- [ ] **Step 3: Keep the UI aligned with the existing glass-panel skeleton**

```tsx
<div className="border-b border-[var(--line)] px-4 py-3 hover:bg-[rgba(21,110,99,0.04)]">
  ...
</div>
```

- [ ] **Step 4: Run web build to verify the UI compiles**

Run: `pnpm --filter @clawbot/web build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add data/tools/builtin/web-search.md data/tools/builtin/opencli.md data/skills/builtin/healthy-meal-reminder.md packages/web/src/lib/api.ts packages/web/src/hooks/useTools.ts packages/web/src/hooks/useSkills.ts packages/web/src/pages/ToolsPage.tsx packages/web/src/pages/SkillsPage.tsx packages/web/src/components/layout/Sidebar.tsx packages/web/src/app.tsx packages/web/src/components/ui/icons.tsx
git commit -m "feat: add tool and skill management console"
```

### Task 6: Verify end-to-end behavior

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add explicit test scripts if still missing**

```json
{
  "scripts": {
    "test:agent": "pnpm --filter @clawbot/agent exec tsx --test src/**/*.test.ts",
    "test:server": "pnpm --filter @clawbot/server exec tsx --test src/**/*.test.ts"
  }
}
```

- [ ] **Step 2: Run full agent tests**

Run: `pnpm test:agent`
Expected: PASS

- [ ] **Step 3: Run full server tests**

Run: `pnpm test:server`
Expected: PASS

- [ ] **Step 4: Run the workspace build**

Run: `pnpm build`
Expected: PASS for shared, agent, server, and web

- [ ] **Step 5: Re-check requirements against the spec**

```text
- Tool/Skill markdown definitions split and loaded from builtin/user layers
- use_skill tool result envelope works
- /api/tools and /api/skills both available
- web console has dedicated Tools and Skills pages
```

- [ ] **Step 6: Commit**

```bash
git add package.json
git commit -m "chore: add verification scripts for markdown capability system"
```
