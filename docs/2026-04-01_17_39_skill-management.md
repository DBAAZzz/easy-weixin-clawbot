# Skill 元数据展示 — 只读技能列表

> Web 控制台展示已注册的 Skill 列表。动态安装/卸载/启停降级为后续 RFC。

## 现状

```text
agent/skills/types.ts    → Skill { tool, execute }        — 无元数据
agent/skills/registry.ts → SkillRegistry { register, getTools, execute } — 无 list 能力
server/ai.ts             → 硬编码注册 timeSkill / webSearchSkill / cliSkill
web/                     → 无 Skill 相关页面
```

问题：Skill 是匿名的——没有版本、作者等展示信息，registry 无法向外暴露已注册的技能列表。

## 设计决策

### tool.name 是唯一标识

registry 按 `tool.name` 建索引（`registry.ts:23`），manifest 不再重复 `name` 字段，避免漂移。

### manifest 只存展示元数据，不复制 tool 字段

当前 `tool.description` 是给 LLM 看的长提示词（如 `ai.ts:114` 的 opencli description），不适合 Web 展示。manifest 增加独立的 `summary` 字段，专门用于 UI 短描述。

```typescript
export interface SkillManifest {
  summary: string;     // UI 展示用的一句话描述
  version: string;
  author?: string;
}
```

### 不暴露 tool.parameters schema 给前端

`tool.parameters` 来自 `Type.Object(...)` 是 agent 内部表示（`cli.ts:77`、`web-search.ts:128`），直接穿到 shared/web 会泄露内部结构。API 只返回 `parameterNames: string[]`。

### 没有 enabled 状态

当前 registry 只有"已注册到 Map"一种状态（`registry.ts:22`），没有开关和持久化。页面状态列固定显示"已注册"，不引入假状态字段。

## 改动范围

```text
packages/
├── shared/src/
│   ├── types.ts                 + SkillInfo 类型
│   └── index.ts                 + 导出 SkillInfo
├── agent/src/skills/
│   ├── types.ts                 + SkillManifest, Skill.manifest 字段
│   ├── registry.ts              + list() 方法
│   ├── cli.ts                   + manifest
│   └── web-search.ts            + manifest
├── agent/src/index.ts           + 导出新类型
├── server/src/
│   ├── ai.ts                    + 导出 skills registry
│   ├── api/index.ts             + 注册 skills 路由, ApiDependencies 加字段
│   ├── api/routes/skills.ts     新增: GET /api/skills
│   └── index.ts                 + 传入 skillRegistry
└── web/src/
    ├── lib/api.ts               + fetchSkills()
    ├── hooks/useSkills.ts       新增
    ├── pages/SkillsPage.tsx     新增
    ├── app.tsx                  + /skills 路由
    └── components/
        ├── layout/Sidebar.tsx   + Skills 导航项
        └── ui/icons.tsx         + PuzzleIcon
```

## 核心接口

### 1. SkillManifest & Skill（agent 包）

```typescript
// packages/agent/src/skills/types.ts
export interface SkillManifest {
  summary: string;    // UI 展示短描述，与 tool.description（LLM prompt）独立
  version: string;
  author?: string;
}

export interface Skill {
  manifest: SkillManifest;
  tool: Tool;         // tool.name 是唯一标识，tool.description 是 LLM 提示词
  execute(args: Record<string, unknown>, ctx: SkillContext): Promise<SkillContent[]>;
}
```

### 2. SkillRegistry.list()（agent 包）

```typescript
// packages/agent/src/skills/registry.ts
export interface SkillRegistryEntry {
  id: string;              // 来自 tool.name
  summary: string;         // 来自 manifest.summary
  version: string;
  author?: string;
  parameterNames: string[];  // Object.keys(tool.parameters.properties)
}

export interface SkillRegistry {
  register(skill: Skill): void;
  getTools(): Tool[];
  list(): SkillRegistryEntry[];
  execute(...): Promise<ToolResultMessage>;
}
```

`list()` 实现：遍历已注册 skill，从 `manifest` 取展示信息，从 `tool.parameters.properties` 取参数名列表。

### 3. SkillInfo（shared 包）

```typescript
// packages/shared/src/types.ts
export interface SkillInfo {
  id: string;
  summary: string;
  version: string;
  author?: string;
  parameterNames: string[];
}
```

与 `SkillRegistryEntry` 结构一致，作为 API 传输类型。在 `shared/src/index.ts` 导出。

### 4. 各 Skill 补充 manifest

```typescript
// web-search.ts
export const webSearchSkill: Skill = {
  manifest: {
    summary: "搜索互联网，返回标题、链接和摘要",
    version: "1.0.0",
  },
  tool: { name: "web_search", description: "搜索互联网并返回...(LLM长描述)", ... },
  execute(...) { ... },
};

// cli.ts — createCliSkill 生成独立的 summary
export function createCliSkill(config: CliSkillConfig): Skill {
  return {
    manifest: {
      summary: config.summary ?? `执行 ${config.binary} 命令`,
      version: "1.0.0",
    },
    tool: { name: config.name, description: config.description, ... },
    execute(...) { ... },
  };
}
```

`CliSkillConfig` 新增可选的 `summary` 字段。若未提供，自动生成。`config.description` 仍然只用于 LLM tool description。

### 5. API 路由

```typescript
// packages/server/src/api/routes/skills.ts
import type { Hono } from "hono";
import type { SkillInfo } from "@clawbot/shared";
import type { SkillRegistry } from "@clawbot/agent";

export function registerSkillRoutes(app: Hono, registry: SkillRegistry) {
  app.get("/api/skills", (c) => {
    const skills: SkillInfo[] = registry.list();
    return c.json({ data: skills });
  });
}
```

`ApiDependencies` 新增 `skillRegistry: SkillRegistry`。

### 6. Web 端

**页面 `SkillsPage.tsx`** — 表格展示：

| 列 | 来源 | 说明 |
|---|---|---|
| 名称 | `id` | tool.name |
| 描述 | `summary` | manifest 短描述 |
| 版本 | `version` | |
| 状态 | 固定 "已注册" | 无动态状态 |
| 参数 | `parameterNames` | 逗号分隔 |

**侧栏：** "工作台" section 增加 `{ to: "/skills", label: "技能管理", icon: <PuzzleIcon /> }`。

## 数据流

```text
Skill（manifest + tool）
  → SkillRegistry.register()
  → SkillRegistry.list()  → SkillRegistryEntry[]
  → GET /api/skills        → SkillInfo[]
  → fetchSkills()
  → useSkills()
  → SkillsPage 渲染
```

## 验收标准

1. `GET /api/skills` 返回 3 个技能（web_search, opencli, 以及 time 如果保留），每个包含 id/summary/version/parameterNames
2. `/skills` 页面可正常打开，展示技能列表表格
3. 空列表和 API 错误状态下页面有合理的兜底展示
4. `pnpm -r build` 全包编译通过

## 实施顺序

1. `shared/src/types.ts` — 新增 `SkillInfo`
2. `shared/src/index.ts` — 导出 `SkillInfo`
3. `agent/src/skills/types.ts` — 新增 `SkillManifest`，`Skill` 加 `manifest`
4. `agent/src/skills/registry.ts` — 新增 `SkillRegistryEntry`，`list()` 方法
5. `agent/src/skills/web-search.ts` — 补 `manifest`
6. `agent/src/skills/cli.ts` — `CliSkillConfig` 加 `summary?`，补 `manifest`
7. `agent/src/index.ts` — 导出新类型
8. `server/src/ai.ts` — 导出 `skills` registry，`createCliSkill` 传入 `summary`
9. `server/src/api/routes/skills.ts` — 新增路由
10. `server/src/api/index.ts` — 注册路由，`ApiDependencies` 新增 `skillRegistry`
11. `server/src/index.ts` — 传入 `skillRegistry`
12. `web/src/lib/api.ts` — `fetchSkills()`
13. `web/src/hooks/useSkills.ts` — hook
14. `web/src/components/ui/icons.tsx` — `PuzzleIcon`
15. `web/src/pages/SkillsPage.tsx` — 页面
16. `web/src/app.tsx` — 路由
17. `web/src/components/layout/Sidebar.tsx` — 导航入口

## 后续 RFC（本次不实现）

- 启用/禁用：需要 DB 持久化 + PUT /api/skills/:id/toggle
- 动态安装第三方 Skill：SkillLoader + npm 包规范 + sandbox
- Skill 配置：config schema + init() 生命周期 + Web 表单
- Skill 卸载：unregister() + DELETE /api/skills/:id
