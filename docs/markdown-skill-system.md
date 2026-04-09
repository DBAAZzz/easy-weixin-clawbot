# Markdown 驱动的 Tool & Skill 系统

> 取代内存硬编码的 JS 注册，改为 Markdown 文件驱动。Tool 和 Skill 是两个正交系统：Tool 是可调用的函数（返回数据），Skill 是可注入的知识（影响模型行为）。统一使用 .md 文件格式，共享分层存储和安装服务基础设施。

## 问题

```text
现状                                     问题
─────────────────────────────────────────────────────────────
tools 是 TypeScript class              添加 tool 必须写 JS 代码、重新编译部署
registry 用 Map 存内存                   无法动态安装/卸载，重启即丢
ai.ts 硬编码 register()                  新增 tool 必须改源码
与市面格式不兼容                          Dify/Coze/GPTs/Claude 均使用 Markdown/YAML 声明式格式
tool 和 skill 概念混淆                   "执行工具"和"知识注入"共用一个 execute 语义，边界模糊
无分层管理                               内置与用户安装的无法独立管理
```

## 设计目标

1. **两个正交系统**：Tool（可调用函数）和 Skill（知识注入），各自独立，不互相侵入
2. **统一文件格式**：YAML frontmatter + Markdown body 的 .md 文件，git-friendly
3. **Tool = 声明式配置**：.md 文件声明元数据和参数，映射到内置 handler 执行，返回结构化数据
4. **Skill = 领域知识文档**：.md 文件定义行为规范和领域知识，按需注入对话上下文，模型自行运用
5. **渐进式加载**：Skill 元数据始终在上下文，正文按需加载，避免 token 浪费
6. **分层存储**：builtin / user 两层，共享基础设施
7. **不可变快照**：热加载通过原子替换快照实现，并发对话安全
8. **安装服务 API**：安装/卸载/启停/校验

## 核心概念

### Tool vs Skill

```text
Tool（工具）                              Skill（技能/知识）
──────────────────────────────            ──────────────────────────────
有 inputSchema，有 handler               有 summary，有 body（文档）
被 LLM 通过 tool calling 调用             被 Runner 注入对话上下文
结构化输入 → 结构化输出                    非结构化知识 → 影响模型行为
执行后返回数据（data_result）              加载后成为模型的"工作手册"
类比：函数                                类比：操作手册
例：web_search(query) → 搜索结果          例："翻译时保留专业术语并括号标注"
.md 作用：声明式工具配置                   .md 作用：领域知识和行为规范
```

**判断原则**：如果它需要执行代码/调用外部服务/返回数据 → Tool。如果它是教模型"如何做某事"的指令 → Skill。

### 三层模型（Tool 和 Skill 共享）

```text
Source (.md 文件)
  │  解析 + 校验
  ▼
Compiled (运行时对象)
  │  安装 + 状态管理
  ▼
Installed (带安装元数据)
  │  快照注入
  ▼
Snapshot (不可变，供对话使用)
```

- **Source**：.md 文件本身。可编辑、可导入导出。不包含运行时状态。
- **Compiled**：解析 frontmatter、校验 schema、绑定 handler（tool）或索引（skill）后的运行时对象。
- **Installed**：Compiled + 安装元数据（来源 `builtin | user`、启用状态）。安装元数据不在 .md 文件中，由 installer 管理。

---

## Part 1: Tool 系统

### Tool 文件格式

```yaml
---
name: string              # 唯一标识，作为 LLM tool name
                           # 校验规则: /^[a-z][a-z0-9_-]{1,48}$/
version: string            # 语义化版本号
type: tool                 # 固定值，标识这是 tool
author?: string
summary: string            # 一句话描述
handler: string            # 映射到内置 handler allowlist
handlerConfig?: object     # handler 特有配置
inputSchema:               # 参数定义，转换为 JSON Schema 供 LLM 使用
  <paramName>:
    type: string | integer | number | boolean
    description: string
    required?: boolean
    default?: any
    enum?: any[]
---

Markdown body 作为 tool.description 传给 LLM。
```

### Tool 示例

#### web_search

```markdown
---
name: web_search
version: 1.0.0
type: tool
author: clawbot
summary: 搜索互联网，返回标题、链接和摘要
handler: web-search
inputSchema:
  query:
    type: string
    description: 搜索关键词或完整问题
    required: true
  maxResults:
    type: integer
    description: 返回结果数量，默认 5，最多 8
    default: 5
---

搜索互联网并返回标题、链接和摘要，适合查询最新信息或外部资料。
```

#### opencli

```markdown
---
name: opencli
version: 1.0.0
type: tool
author: clawbot
summary: 调用 opencli 执行外部网站、应用和命令行工具
handler: cli
handlerConfig:
  binary: opencli
  defaultArgs: []
  maxOutputChars: 4000
  timeout: 30000
inputSchema:
  command:
    type: string
    description: >
      Subcommand and arguments (without "opencli" prefix).
      Example: "bilibili hot --limit 5"
    required: true
---

Execute opencli commands to access websites, apps, and external CLIs.
Common commands:
  bilibili hot/search/download    zhihu hot/search/download
  xiaohongshu search/feed/publish weibo hot/search
  twitter trending/search/post    hackernews top/search
  youtube search/transcript       web read <url>
  douban search/top250            jike feed/search
  weread shelf/search/highlights  xueqiu hot-stock/search
  gh pr list / gh issue list      docker ps
Add "-f json" for structured output. Use "list" to see all commands.
```

### Tool 执行流程

```text
LLM 调用 tool "web_search" { query: "AI news" }
  → ToolRegistry.execute("web_search", args, signal)
  → 查找 handler allowlist: getNativeHandler("web-search")
  → handler.execute(args, config, ctx)
  → 返回 SkillContent[]（结构化数据）
  → 作为 tool_result message 返回给 LLM
```

Tool 始终注册为 LLM 的 tool，始终通过 tool calling 调用，始终返回数据。

### Tool 代码架构

```text
packages/agent/src/tools/
├── types.ts              ToolSource, CompiledTool, InstalledTool
├── parser.ts             解析 tool .md → ToolSource
├── compiler.ts           ToolSource → CompiledTool（校验 handler + 构建 JSON Schema）
├── registry.ts           不可变快照，snapshot swap
├── loader.ts             扫描目录 → 解析 → 编译
├── installer.ts          分层合并 + 状态管理 + 快照生成
└── handlers/
    ├── index.ts           handler allowlist
    ├── web-search.ts      搜索 handler
    └── cli.ts             CLI handler（含 binary allowlist）
```

### Tool 核心类型

```typescript
// packages/agent/src/tools/types.ts

export interface ToolSource {
  name: string;                // /^[a-z][a-z0-9_-]{1,48}$/
  version: string;
  type: "tool";
  author?: string;
  summary: string;
  handler: string;             // 必须在 handler allowlist 中
  handlerConfig?: Record<string, unknown>;
  inputSchema: Record<string, ParameterDef>;
  body: string;                // Markdown body，作为 tool description
  filePath: string;
}

export interface ParameterDef {
  type: "string" | "integer" | "number" | "boolean";
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
}

export interface CompiledTool {
  source: ToolSource;
  jsonSchema: Record<string, unknown>;  // 转换后的 JSON Schema
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolContent[]>;
}

export interface InstalledTool {
  tool: CompiledTool;
  origin: "builtin" | "user";
  enabled: boolean;
  installedAt: string;
}

export interface NativeHandler {
  execute(
    args: Record<string, unknown>,
    config: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolContent[]>;
}

export interface ToolContext {
  signal: AbortSignal;
}

export type ToolContent = TextContent | ImageContent;
```

### Handler Allowlist

```typescript
// packages/agent/src/tools/handlers/index.ts

const HANDLER_ALLOWLIST: Record<string, NativeHandler> = {
  "web-search": webSearchHandler,
  cli: cliHandler,
};

export function getNativeHandler(name: string): NativeHandler | undefined {
  return HANDLER_ALLOWLIST[name];
}
```

用户通过 API 安装的 tool 只能使用 allowlist 中的 handler，不能指定任意 JS 模块。

### CLI Handler 安全策略

```typescript
const BINARY_ALLOWLIST = new Set(["opencli", "gh", "docker", "curl"]);

// 校验：
// - binary 必须在 allowlist 中
// - 参数禁止 shell 元字符（|, ;, &&, `, $() 等）
// - 超时默认 30s，上限 120s
// - 输出超过 maxOutputChars 截断并标注
```

### Tool Registry（不可变快照）

```typescript
// packages/agent/src/tools/registry.ts

export interface ToolSnapshot {
  readonly tools: ReadonlyArray<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    execute: CompiledTool["execute"];
  }>;
}

export interface ToolRegistry {
  swap(snapshot: ToolSnapshot): void;
  current(): ToolSnapshot;
  execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolContent[]>;
}
```

---

## Part 2: Skill 系统

### Skill 文件格式

```yaml
---
name: string              # 唯一标识
                           # 校验规则: /^[a-z][a-z0-9_-]{1,48}$/
version: string
type: skill                # 固定值，标识这是 skill
author?: string
summary: string            # 一句话描述（始终在上下文中，用于 routing）
---

Markdown body 是 skill 的完整知识内容。
按需加载到对话上下文。
```

**Skill 没有 inputSchema**——它不是函数，不接受结构化参数。用户的意图（目标语言、风格偏好等）已经在对话消息中，模型读完 skill 指令后自行从上下文提取。

**Skill 没有 handler**——它不执行代码。它的"执行"就是被注入到对话上下文，模型按知识行动。

### Skill 示例

当前仓库默认内置的是 `healthy-meal-reminder`。下面同时给出一个当前内置 skill 和两个假想示例，用于说明 on-demand / always 两种激活方式。

#### healthy-meal-reminder（当前内置）

```markdown
---
name: healthy-meal-reminder
version: 1.8.0
type: skill
author: clawbot
summary: 健康饮食提醒与饮食记录，基于定时任务管理三餐、下午茶、运动和周报
activation: on-demand
---

你是健康饮食提醒助手。用户提到饮食提醒、三餐提醒、吃什么、减肥食谱、健康饮食、meal reminder、吃了什么、体重打卡时，按以下规则工作：

- 推荐时固定给出 A / B / C 三个方案
- 早餐、午餐、晚餐推荐后 30 分钟自动跟进一次
- 用户回复后记录饮食、估算热量、汇总今日摄入
- 使用当前项目的定时任务工具创建和维护提醒
```

#### translation-ja（假想按需 skill）

```markdown
---
name: translation-ja
version: 1.0.0
type: skill
author: community
summary: 将文本翻译成日语，保留专有名词和原文结构
activation: on-demand
---

你是一位专业翻译。请遵循以下规则：

- 保持原文格式和结构
- 专有名词保留原文并补充必要注释
- 输出仅包含翻译结果，不添加额外解释
```

#### tone-professional（假想常驻 skill）

```markdown
---
name: tone-professional
version: 1.0.0
type: skill
author: community
summary: 始终以正式、专业、克制的语气作答
activation: always
---

你是一位专业的商务助手。请始终遵循以下行为规范：

- 使用正式、专业的语气
- 回复简洁有条理，使用结构化格式
- 避免使用口语化表达和 emoji
- 对不确定的信息明确标注
```

### Skill 加载策略：渐进式披露

借鉴 Claude Code 的三层渐进式架构，避免全量注入浪费 token：

#### 第一层：元数据（始终在上下文）

每个已启用 skill 的 `name` + `summary` 始终在 system prompt 中，作为 skill 索引：

```text
[System Prompt 附加段]

你有以下可用技能，当任务相关时可以请求加载：
- healthy-meal-reminder: 健康饮食提醒与饮食记录，基于定时任务管理三餐、下午茶、运动和周报
- translation-ja: 将文本翻译成日语，保留专有名词和原文结构
- tone-professional: 始终以正式、专业、克制的语气作答
要使用技能，调用 use_skill 工具。
```

每个 skill 占约 20-30 token，50 个 skill 约 1000-1500 token。

#### 第二层：正文（触发时加载）

当模型判断需要某个 skill 时，通过 `use_skill` meta tool 触发加载。Runner 将 skill body 注入到对话上下文中。

#### Skill 触发机制：use_skill Meta Tool

`use_skill` 是唯一一个连接 Tool 系统和 Skill 系统的桥梁——它本身是一个 tool，但作用是触发 skill 加载：

```typescript
// use_skill 是一个特殊的内置 tool，不通过 .md 文件定义
{
  name: "use_skill",
  description: "加载一个技能到当前对话。加载后，你将获得该技能的完整指令，按指令完成用户任务。",
  parameters: {
    type: "object",
    properties: {
      skill_name: {
        type: "string",
        description: "要加载的技能名称",
      },
    },
    required: ["skill_name"],
  },
}
```

### Skill 注入机制：通过 tool_result 返回

**关键设计**：skill body 不作为独立的 user message 注入，而是作为 `use_skill` 的 **tool_result** 返回。

这与 Claude Code 的实际实现一致。好处：

1. **语义正确**：skill 内容在 tool_result 里，模型天然理解为"工具给我的信息，我应该据此行动"
2. **不污染用户消息流**：skill 指令和真实用户输入不混在同一优先级
3. **不破坏 KV cache**：tool_result 是标准的 Assistant→User 轮次，消息前缀（system prompt + tool definitions）保持不变
4. **持久化安全**：tool_result 作为正常对话历史的一部分持久化，语义清晰

**use_skill 的执行逻辑**：

```typescript
/**
 * 每个对话维护已加载的按需 skill 集合。
 * 允许同时加载多个 skill（上限 MAX_SKILLS），支持多 skill 组合使用。
 * 重复加载同一 skill 幂等返回，不计入配额。
 */
const loadedSkillsInConversation = new Set<string>();
const MAX_ON_DEMAND_SKILLS_PER_CONVERSATION = 3;

async function handleUseSkill(skillName: string): Promise<ToolContent[]> {
  // 重复加载同一 skill → no-op，极短确认，不重复注入 body
  if (loadedSkillsInConversation.has(skillName)) {
    return [{ type: "text", text: "ok" }];
  }

  // 配额检查
  if (loadedSkillsInConversation.size >= MAX_ON_DEMAND_SKILLS_PER_CONVERSATION) {
    const loaded = [...loadedSkillsInConversation].join(", ");
    return [{
      type: "text",
      text: `本次对话已加载 ${loadedSkillsInConversation.size} 个技能（${loaded}），已达上限。请使用已加载的技能完成任务。`,
    }];
  }

  const skill = skillRegistry.getOnDemandSkill(skillName);
  if (!skill) {
    return [{ type: "text", text: `未找到技能: ${skillName}` }];
  }

  loadedSkillsInConversation.add(skillName);

  // skill body 作为 tool_result 返回，带强制 envelope
  // 多 skill 场景下，每个 skill 都有独立的 <skill> 标签，模型可区分
  return [{
    type: "text",
    text: [
      `<skill name="${skillName}" version="${skill.source.version}">`,
      `以下是已加载的技能指令。你必须在本次对话的后续回复中严格遵循这些指令来完成用户的请求。`,
      `如果你已加载了多个技能，请综合所有已加载技能的指令来完成任务。`,
      ``,
      skill.source.body,
      `</skill>`,
    ].join("\n"),
  }];
}
```

**多 skill 组合场景示例**：

```text
用户: "先把今天的饮食记录提炼成 3 条，再翻译成日语"

第 1 轮: LLM 调用 use_skill("diet-digest-writer") → 加载提炼指令
第 2 轮: LLM 调用 use_skill("translation-ja") → 加载翻译指令
第 3 轮: LLM context 中有两个 <skill> 标签，综合两个指令完成任务
         → 先按 diet-digest-writer 指令提取要点，再按 translation-ja 指令翻译
```

### Skill 完整执行流程（2 轮）

```text
用户: "帮我把这段话翻译成日语：人工智能正在改变世界"

第 1 轮（routing + skill 加载）:
  LLM 看到:
    tools: [web_search, opencli, use_skill]
    system prompt 包含 skill 摘要列表

  LLM 判断: 需要 translation-ja skill
  LLM 发出:
    {
      role: "assistant",
      content: [
        { type: "tool_use", name: "use_skill", input: { skill_name: "translation-ja" } }
      ]
    }

  Runner 处理 → 返回标准 tool_result（带强制 envelope）:
    {
      role: "user",
      content: [
        { type: "tool_result", tool_use_id: "...",
          content: "<skill name=\"translation-ja\" version=\"1.0.0\">\n以下是已加载的技能指令。你必须在本次对话的后续回复中严格遵循这些指令来完成用户的请求。\n\n你是一位专业翻译。请遵循以下规则：\n...\n</skill>" }
      ]
    }

第 2 轮（执行）:
  LLM context:
    [system] 基础 system prompt + skill 索引（未变，KV cache 命中）
    [user] "帮我把这段话翻译成日语：人工智能正在改变世界"
    [assistant] tool_use: use_skill("translation-ja")
    [user/tool_result] <skill name="translation-ja">...完整指令...</skill>

  LLM 按 skill 指令输出翻译结果:
    "人工知能は世界を変えています"
```

**与独立 user message 注入的对比**：

```text
❌ 错误做法: messages.push({ role: "user", content: skill.body })
  - 混入用户消息流，语义不清
  - 会被持久化为"用户说的话"
  - 破坏消息序列，可能影响 KV cache

✅ 正确做法: 作为 use_skill 的 tool_result 返回
  - 标准 tool use 周期，语义清晰
  - 持久化为"工具返回的结果"
  - 不破坏消息前缀结构
```

### 常驻 Skill vs 按需 Skill

有些 skill 适合始终生效（人设、安全策略），不需要每次触发：

```typescript
// Installer 初始化时，将 always-on skill 的 body 直接注入 system prompt
interface SkillSnapshot {
  /** 常驻 skill body，直接拼入 system prompt */
  readonly alwaysOn: ReadonlyArray<{ name: string; body: string }>;
  /** 按需 skill 索引，始终在 system prompt（供 routing） */
  readonly index: ReadonlyArray<{ name: string; summary: string }>;
  /** 按需 skill 完整内容，use_skill 触发时读取 */
  readonly onDemand: ReadonlyMap<string, CompiledSkill>;
}
```

frontmatter 中用 `activation` 字段区分：

```yaml
---
name: tone-professional
type: skill
activation: always        # always = 常驻, on-demand = 按需（默认）
---
```

- `always`：body 直接进 system prompt，每轮对话都带，无需 use_skill 触发
- `on-demand`（默认）：只有 summary 在 system prompt，body 通过 use_skill 按需加载

### Skill 代码架构

```text
packages/agent/src/skills/
├── types.ts              SkillSource, CompiledSkill, InstalledSkill
├── parser.ts             解析 skill .md → SkillSource
├── compiler.ts           SkillSource → CompiledSkill（校验元数据）
├── registry.ts           不可变快照
├── loader.ts             扫描目录 → 解析 → 编译
└── installer.ts          分层合并 + 状态管理 + 快照生成
```

### Skill 核心类型

```typescript
// packages/agent/src/skills/types.ts

export interface SkillSource {
  name: string;               // /^[a-z][a-z0-9_-]{1,48}$/
  version: string;
  type: "skill";
  author?: string;
  summary: string;            // 始终在上下文的摘要
  activation: "always" | "on-demand";  // 默认 on-demand
  body: string;               // Markdown 正文（知识内容）
  filePath: string;
}

export interface CompiledSkill {
  source: SkillSource;
}

export interface InstalledSkill {
  skill: CompiledSkill;
  origin: "builtin" | "user";
  enabled: boolean;
  installedAt: string;
}
```

### Skill Registry（不可变快照）

```typescript
// packages/agent/src/skills/registry.ts

export interface SkillSnapshot {
  /** 常驻 skill body，直接拼入 system prompt */
  readonly alwaysOn: ReadonlyArray<{ name: string; body: string }>;
  /** 按需 skill 索引，始终在 system prompt（供 routing） */
  readonly index: ReadonlyArray<{ name: string; summary: string }>;
  /** 按需 skill 完整内容，use_skill 触发时读取 */
  readonly onDemand: ReadonlyMap<string, CompiledSkill>;
}

export interface SkillRegistry {
  swap(snapshot: SkillSnapshot): void;
  current(): SkillSnapshot;
  /** use_skill 调用时，获取指定按需 skill。返回 null 表示未找到或未启用。 */
  getOnDemandSkill(name: string): CompiledSkill | null;
}
```

---

## Part 3: 共享基础设施

### 分层存储

```text
data/
├── tools/
│   ├── builtin/               # 随代码发布，git tracked
│   │   ├── web-search.md
│   │   └── opencli.md
│   └── user/                  # 用户安装，可 CRUD
│       └── ...
├── skills/
│   ├── builtin/               # 随代码发布
│   │   └── healthy-meal-reminder.md
│   └── user/                  # 用户安装
│       ├── translation-ja.md
│       └── diet-digest-writer.md
```

分层解析规则（tool 和 skill 相同）：

1. **builtin 层**：随代码发布，始终加载
2. **user 层**：用户通过 API 安装，可增删改
3. **覆盖**：user 层同 `name` 覆盖 builtin 版本
4. **禁用**：禁用 builtin 不删文件，在 installer 状态中标记 disabled

### Parser（共享）

```typescript
// packages/agent/src/shared/parser.ts

export interface ParsedFile {
  frontmatter: Record<string, unknown>;
  body: string;
  filePath: string;
}

/**
 * 解析 .md 文件的 YAML frontmatter + body。
 * Tool 和 Skill 共享此解析逻辑，各自在上层做 schema 校验。
 */
export async function parseMdFile(filePath: string): Promise<ParsedFile> {
  const content = await readFile(filePath, "utf-8");
  const { frontmatter, body } = splitFrontmatter(content);
  const meta = parseYaml(frontmatter);
  validateName(meta.name);  // /^[a-z][a-z0-9_-]{1,48}$/
  return { frontmatter: meta, body, filePath };
}
```

### Server 启动

```typescript
// packages/server/src/ai.ts

import { createToolInstaller, createToolRegistry } from "@clawbot/agent";
import { createSkillInstaller, createSkillRegistry } from "@clawbot/agent";

// Tool 系统
export const toolRegistry = createToolRegistry();
const toolInstaller = createToolInstaller(toolRegistry);
const toolResult = await toolInstaller.initialize("data/tools/builtin", "data/tools/user");
console.log(`[tools] loaded: ${toolResult.loaded.join(", ")}`);

// Skill 系统
export const skillRegistry = createSkillRegistry();
const skillInstaller = createSkillInstaller(skillRegistry);
const skillResult = await skillInstaller.initialize("data/skills/builtin", "data/skills/user");
console.log(`[skills] loaded: ${skillResult.loaded.join(", ")}`);
```

### Runner 改造

```typescript
// packages/server/src/runner.ts

function buildMessages(userMessage: string): Message[] {
  const toolSnap = toolRegistry.current();
  const skillSnap = skillRegistry.current();

  const messages: Message[] = [];

  // 1. System prompt = 基础指令 + 常驻 skill body + 按需 skill 索引
  let systemPrompt = BASE_SYSTEM_PROMPT;

  // 注入常驻 skill
  for (const { name, body } of skillSnap.alwaysOn) {
    systemPrompt += `\n\n[Skill: ${name}]\n${body}`;
  }

  // 注入按需 skill 索引
  if (skillSnap.index.length > 0) {
    systemPrompt += "\n\n你有以下可用技能，需要时调用 use_skill 加载：";
    for (const { name, summary } of skillSnap.index) {
      systemPrompt += `\n- ${name}: ${summary}`;
    }
  }

  messages.push({ role: "system", content: systemPrompt });

  // 2. 注册 tools = tool 系统的所有 tool + use_skill meta tool
  const tools = [
    ...toolSnap.tools,
    USE_SKILL_TOOL_DEF,  // 内置 meta tool
  ];

  // ...
}

// 3. use_skill 的执行逻辑
// 实现见上方 "Skill 注入机制" 章节的 handleUseSkill()
// 要点：
//   - 通过 skillRegistry.getOnDemandSkill() 获取 skill
//   - 每个对话最多加载 3 个按需 skill（loadedSkillsInConversation 集合）
//   - 重复加载同一 skill 幂等返回，不消耗配额
//   - skill body 包装在 <skill> envelope 中作为 tool_result 返回
//   - 多 skill 场景下各 <skill> 标签独立，模型综合执行
//   - 和其他 tool 走同一个 execute 通道，runner 无需特殊处理
```

### API 路由

```typescript
// packages/server/src/api/routes/tools.ts

app.get("/api/tools", (c) => c.json({ data: toolInstaller.list() }));
app.get("/api/tools/:name", (c) => { /* 详情 */ });
app.get("/api/tools/:name/source", (c) => { /* 原始 .md */ });
app.post("/api/tools/validate", async (c) => { /* 只校验不安装 */ });
app.post("/api/tools", async (c) => { /* 安装 */ });
app.put("/api/tools/:name", async (c) => { /* 更新 */ });
app.delete("/api/tools/:name", async (c) => { /* 卸载 */ });
app.post("/api/tools/:name/enable", async (c) => { /* 启用 */ });
app.post("/api/tools/:name/disable", async (c) => { /* 禁用 */ });

// packages/server/src/api/routes/skills.ts（同构 API）

app.get("/api/skills", (c) => c.json({ data: skillInstaller.list() }));
app.get("/api/skills/:name", (c) => { /* 详情 */ });
app.get("/api/skills/:name/source", (c) => { /* 原始 .md */ });
app.post("/api/skills/validate", async (c) => { /* 只校验不安装 */ });
app.post("/api/skills", async (c) => { /* 安装 */ });
app.put("/api/skills/:name", async (c) => { /* 更新 */ });
app.delete("/api/skills/:name", async (c) => { /* 卸载 */ });
app.post("/api/skills/:name/enable", async (c) => { /* 启用 */ });
app.post("/api/skills/:name/disable", async (c) => { /* 禁用 */ });
```

### Shared 类型

```typescript
// packages/shared/src/types.ts

export interface ToolInfo {
  name: string;
  summary: string;
  version: string;
  author?: string;
  type: "tool";
  handler: string;
  origin: "builtin" | "user";
  enabled: boolean;
  parameterNames: string[];
}

export interface SkillInfo {
  name: string;
  summary: string;
  version: string;
  author?: string;
  type: "skill";
  activation: "always" | "on-demand";
  origin: "builtin" | "user";
  enabled: boolean;
}
```

---

## 安全

### Tool 安全

- **Handler allowlist**：只有 `HANDLER_ALLOWLIST` 中注册的 handler 可被使用
- **CLI binary allowlist**：cli handler 只允许预定义的可执行文件
- **参数注入防护**：禁止 shell 元字符
- **超时**：默认 30s，上限 120s
- **输出截断**：超过 maxOutputChars 截断

### Skill 安全

- **body 长度限制**：单个 skill body 上限 5000 token，防止超长注入
- **常驻 skill 总量限制**：所有 `activation: always` 的 skill body 总计不超过 10000 token
- **每对话最多 3 个按需 skill**：`handleUseSkill()` 内部通过 `loadedSkillsInConversation` 集合追踪已加载 skill，超限时返回拒绝消息。重复加载同一 skill 幂等返回，不消耗配额。上限可配置（`MAX_ON_DEMAND_SKILLS_PER_CONVERSATION`），防止无限加载导致 context 膨胀
- **强制 envelope**：skill body 包装在 `<skill>` 标签中，附带"你必须严格遵循"的指令前缀，降低模型将其当作参考资料而非工作手册的风险

---

## 可观测性

```text
[tools] startup           tool 加载结果汇总
[tools] compile-error     单个文件编译失败
[tools] install           安装新 tool
[tools] execute           每次调用（name, duration, success）
[tools] execute-error     执行失败详情

[skills] startup          skill 加载结果汇总
[skills] compile-error    单个文件编译失败
[skills] install          安装新 skill
[skills] activate         use_skill 触发加载（name, conversation_id）
[skills] inject           常驻 skill 注入（对话开始时）

[shared] snapshot-swap    快照切换（变更列表）
[shared] enable/disable   启停状态变更
```

---

## API 兼容性迁移策略

### 现状

当前代码中 `/api/skills` 返回的实际是 tool 列表（web_search, opencli），类型为 `SkillInfo { id, summary, version, author, parameterNames }`。前端 `SkillsPage` 和 `useSkills` hook 都消费这个接口。

新 spec 将 tool 和 skill 拆成两个独立 API：
- `/api/tools` — 可调用工具（原 `/api/skills` 的内容）
- `/api/skills` — 知识技能（新概念）

如果直接改，Phase 1 落地后前端立刻断裂。

### 迁移方案：统一能力 API + 渐进重命名

**Phase 1 不拆 API 路径**。引入统一的 `/api/capabilities` 端点，同时保留旧 `/api/skills` 作为兼容别名：

```typescript
// Phase 1: /api/skills 语义不变，继续返回 tool 列表（只是底层改为 markdown 驱动）
// 新增 /api/capabilities 作为未来统一入口

// 兼容层：旧 /api/skills → 转发到 tool 列表
app.get("/api/skills", (c) => {
  const tools = toolInstaller.list();
  // 映射为旧 SkillInfo 格式（保持 id/summary/version/author/parameterNames 字段）
  const legacy: LegacySkillInfo[] = tools.map(t => ({
    id: t.name,
    summary: t.summary,
    version: t.version,
    author: t.author,
    parameterNames: t.parameterNames,
  }));
  return c.json({ data: legacy });
});

// 新 API
app.get("/api/tools", (c) => c.json({ data: toolInstaller.list() }));
```

**Phase 2 引入 `/api/skills`（新语义）时**，旧兼容端点改路径：

```typescript
// Phase 2: 旧兼容层移到 /api/legacy/skills（给还没更新的客户端用）
app.get("/api/legacy/skills", legacySkillsHandler);

// /api/skills 现在是真正的 skill API
app.get("/api/skills", (c) => c.json({ data: skillInstaller.list() }));
app.get("/api/tools", (c) => c.json({ data: toolInstaller.list() }));

// /api/capabilities 返回合并视图
app.get("/api/capabilities", (c) => {
  return c.json({
    tools: toolInstaller.list(),
    skills: skillInstaller.list(),
  });
});
```

### 前端迁移时序

| Phase | `/api/skills` 返回 | 前端改动 |
|-------|-------------------|---------|
| Phase 1 | tool 列表（旧格式兼容） | **无改动**，SkillsPage 正常工作 |
| Phase 2 | skill 列表（新语义） | SkillsPage 拆分为 ToolsPage + SkillsPage，消费 `/api/tools` 和 `/api/skills` |
| Phase 3 | skill 列表 | 移除 `/api/legacy/skills` 兼容层 |

### Shared 类型迁移

```typescript
// Phase 1: 保留旧 SkillInfo，新增 ToolInfo
export interface SkillInfo {           // 旧类型，Phase 2 后废弃
  id: string;
  summary: string;
  version: string;
  author?: string;
  parameterNames: string[];
}

export interface ToolInfo {            // 新类型
  name: string;
  summary: string;
  version: string;
  author?: string;
  type: "tool";
  handler: string;
  origin: "builtin" | "user";
  enabled: boolean;
  parameterNames: string[];
}

// Phase 2: 新增 SkillInfoV2，旧 SkillInfo 标记 @deprecated
/** @deprecated 使用 ToolInfo 或 SkillInfoV2 */
export interface SkillInfo { ... }

export interface SkillInfoV2 {
  name: string;
  summary: string;
  version: string;
  author?: string;
  type: "skill";
  activation: "always" | "on-demand";
  origin: "builtin" | "user";
  enabled: boolean;
}

// Phase 3: 删除旧 SkillInfo，SkillInfoV2 重命名为 SkillInfo
```

---

## 迁移计划

### Phase 1: Tool 系统 markdown 化 + 快照 registry

1. 新增 `yaml` 依赖
2. 实现共享 parser（frontmatter 解析 + name 校验）
3. 实现 tool types、compiler（handler 绑定 + JSON Schema 转换）
4. 迁移 handlers/web-search.ts 和 handlers/cli.ts
5. 实现 handler allowlist
6. 改造 tool registry（不可变快照 + swap）
7. 实现 tool loader + installer
8. 创建 `data/tools/builtin/web-search.md` 和 `opencli.md`
9. 简化 server/src/ai.ts（移除硬编码注册）
10. 新增 `/api/tools` 路由（GET/POST/DELETE/validate/enable/disable）
11. **保留 `/api/skills` 兼容层**：转发到 tool 列表，映射为旧 `SkillInfo` 格式
12. **前端零改动**：SkillsPage、useSkills、fetchSkills 保持原样

**验收**：
- 现有 web_search 和 opencli 功能不受影响
- 旧 `GET /api/skills` 返回数据格式不变，前端正常渲染
- 新 `GET /api/tools` 返回 `ToolInfo[]` 格式
- 通过 `/api/tools` 可安装新 tool
- `pnpm -r build` 通过

### Phase 2: Skill 系统 + 渐进式加载 + 前端重构

1. 实现 skill types、compiler
2. 实现 skill registry（alwaysOn + index + onDemand 三段快照）
3. 实现 skill loader + installer
4. 实现 use_skill meta tool
5. 改造 runner：system prompt 注入（常驻 skill + 按需索引）
6. 改造 runner：use_skill 触发后 skill body 作为 tool_result 返回
7. 创建示例 skill（healthy-meal-reminder, translation-ja）
8. 新增 `/api/skills`（新语义）路由
9. **旧兼容层移至 `/api/legacy/skills`**
10. 更新 shared/types.ts：新增 `SkillInfoV2`，旧 `SkillInfo` 标记 `@deprecated`
11. **前端重构**：SkillsPage → ToolsPage（消费 `/api/tools`）+ SkillsPage（消费 `/api/skills`）
12. 更新路由：`/tools` 和 `/skills` 两个页面

**验收**：
- 安装 translation-ja skill，LLM 自动触发 use_skill → skill body 作为 tool_result 返回 → 模型按指令翻译
- 常驻 skill（如 tone-professional）在每次对话中自动生效
- 前端 ToolsPage 显示 tool 列表，SkillsPage 显示 skill 列表
- 旧 `/api/legacy/skills` 仍可访问（兼容期）

### Phase 3: Web UI 完善 + 热加载 + 清理

1. ToolsPage + SkillsPage：详情页、编辑流
2. 安装/卸载/启停 UI
3. Markdown 编辑 + 实时预览
4. 文件 watcher → 自动 reload → snapshot swap
5. **删除 `/api/legacy/skills` 兼容层**
6. **删除旧 `SkillInfo` 类型**，`SkillInfoV2` 重命名为 `SkillInfo`

### Phase 4: 远程源（后续演进）

- 远程 skill/tool 仓库
- `POST /api/tools/install?url=...`
- `POST /api/skills/install?url=...`

---

## 验收标准汇总

1. Tool 和 Skill 使用独立的 .md 文件、独立的目录、独立的 registry
2. Tool 通过 tool calling 调用，返回数据
3. Skill 通过 use_skill 触发加载，skill body 作为 tool_result 返回，模型自行运用
4. 常驻 skill 自动注入 system prompt，无需触发
5. 按需 skill 索引（name + summary）始终在 system prompt，正文按需加载
6. 分层存储：builtin 不可通过 API 修改，user 可 CRUD，同名覆盖
7. 不可变快照：安装/卸载不影响进行中的对话
8. 所有 handler 在 allowlist 中，不可任意指定
9. **API 兼容**：Phase 1 期间旧 `/api/skills` 格式不变，前端零改动
10. `pnpm -r build` 全包编译通过
