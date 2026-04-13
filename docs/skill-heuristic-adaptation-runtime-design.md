# Skill 启发式自适应运行时方案（Heuristic Adaptation）

## 1. 背景与问题

当前系统支持通过 Markdown 安装 Skill，但远程 Skill 生态的格式非常分散，常见问题包括：

- 没有统一 `skill.yaml` 或标准化依赖声明。
- 仅提供一份 Markdown，缺少可执行脚本（例如 `scripts/akshare_cli.py`）。
- 依赖信息散落在自然语言段落和代码块中，无法直接结构化解析。
- 用户期望“装了就能用”，但系统当前不负责自动安装运行时依赖。

目标是把“识别与适配”从 Skill 作者侧转移到系统后台 + Agent 侧，实现“拿到什么，就推断什么”。

## 2. 已确认现状（当前代码）

- Skill 安装入口是 API：
  - `GET /api/skills` 列表
  - `POST /api/skills` 安装（提交 JSON 的 `markdown` 字段）
  - 文件：`packages/server/src/api/routes/skills.ts`
- Skill 安装器当前只做解析/写文件/启停，不做依赖安装：
  - 文件：`packages/agent/src/skills/installer.ts`
- Web `SkillsPage` 当前无“新增 Skill”UI（仅列表、启停、查看源码）：
  - 文件：`packages/web/src/pages/SkillsPage.tsx`
- Tool 的 CLI handler 有固定二进制白名单，默认不包含 `python/pip`：
  - 文件：`packages/agent/src/tools/handlers/cli.ts`

## 3. 设计目标与边界

### 3.1 目标

1. 不要求远程 Skill 提供统一配置文件。
2. 自动识别主流运行时（先 Python，后 Node）。
3. 每个 Skill 独立环境，避免互相污染。
4. 安装流程可观测、可重试、可重装。
5. 用户在 Web 端可看到明确“安装计划”，并确认执行。

### 3.2 非目标（首期）

- 不覆盖所有冷门语言运行时。
- 不做复杂安全攻防（假设用户上传的是自有 Skill），但保留基础白名单与隔离。

## 4. 总体方案

采用“规则优先 + Agent 兜底”的两阶段识别策略：

1. **规则引擎静态探测（确定性）**
2. **Agent 语义补全（不确定性兜底）**

### 4.1 自动指纹识别（File-Based Discovery）

解压后的 Skill workspace 做静态扫描：

- `requirements.txt` / `pyproject.toml` / `*.py` -> Python 倾向
- `package.json` -> Node 倾向
- `go.mod` -> Go（首期返回 unsupported）
- Markdown 内代码块与命令片段提取：
  - `pip install ...`
  - `python -c "..."`
  - `python scripts/xxx.py ...`

输出结构化证据（evidence）而非仅 confidence：

- 命中来源（文件路径/代码块序号）
- 推断依据（规则 ID）
- 推断结果（runtime/dependencies/entrypoint）

### 4.2 影子配置（Shadow Manifest）

当上传包缺少标准配置时，后台自动生成并维护影子配置：

- 数据库持久化（主存）
- 同步落盘到 workspace：
  - `data/skills/workspaces/{skillId}/.managed_meta.json`

建议字段：

- `schemaVersion`
- `skillId`
- `sourceType`（zip/markdown）
- `detectedRuntime`
- `dependencies`
- `entrypoints`
- `installPlan`
- `missingArtifacts`
- `status`
- `contentHash`
- `updatedAt`

这样可以实现“配置随代码走”，数据库异常时仍可从文件恢复。

### 4.3 隔离运行时中心（Isolated Runtime Hub）

统一目录：

- `data/skills/workspaces/{skillId}/`

Python Driver（Phase 1）：

- 在 workspace 内创建 `.venv`
- 使用 `.venv/bin/python -m pip ...` 安装依赖
- 运行命令时自动注入解释器路径（命令 shim）

Node Driver（Phase 4）：

- 在 workspace 内执行 `npm/pnpm install`
- 执行命令时固定 `cwd=workspace`

> 决策：禁用“全局安装开关”。默认强制 workspace 隔离，仅允许“环境继承（只读）”。

### 4.4 缺失工件处理（Missing Artifact）

若 Markdown 声明了脚本入口但文件不存在：

1. 标记 `missing_artifacts`
2. 阻止直接安装为 Ready
3. 提供 Agent 补全建议（从 Markdown 代码块提取）
4. 默认人工确认后再写入文件并重试 preflight

## 5. API 设计（建议）

### 5.1 上传与预检

- `POST /api/skills/upload`
  - 输入：zip 或 markdown
  - 输出：`skillId`

- `GET /api/skills/{id}/preflight`
  - 输出：安装计划（供 Web 渲染“可视化清单”）

示例：

```json
{
  "skillId": "sk_123",
  "detectedRuntime": "python",
  "dependencies": ["akshare", "pandas", "numpy"],
  "entrypoint": "scripts/akshare_cli.py",
  "missingArtifacts": [],
  "installPlan": [
    ".venv/bin/python -m pip install -U pip",
    ".venv/bin/python -m pip install -U akshare pandas numpy",
    ".venv/bin/python -c \"import akshare as ak; print(ak.__version__)\""
  ],
  "riskLevel": "low",
  "status": "preflight_ready",
  "evidence": [
    { "kind": "markdown_codeblock", "value": "pip install akshare --upgrade" },
    { "kind": "markdown_codeblock", "value": "python -c \"import akshare as ak; print(ak.__version__)\"" }
  ]
}
```

### 5.2 安装与日志

- `POST /api/skills/{id}/install`
  - 按 Driver 执行安装流程
  - 返回任务 ID 或即时状态

- `GET /api/skills/{id}/install-logs`（SSE 优先）
  - 实时输出 pip/npm 安装日志
  - 前端展示流式日志与进度

### 5.3 运行态与重装

- `GET /api/skills/{id}` 返回状态（含 health）
- `POST /api/skills/{id}/reinstall`
  - Driver 执行受控清理 + 重装（用于“玄学问题”恢复）

## 6. 状态机

建议状态：

- `uploaded`
- `preflight_ready`
- `preflight_failed`
- `installing`
- `ready`
- `failed`
- `repairing`

状态迁移原则：

- 非 `ready` 不允许进入生产调用路径
- 所有失败状态保留最近一次错误与日志索引

## 7. 前端交互建议

安装前不展示“抽象信心值”，直接展示“安装计划表”：

1. 检测到的运行时
2. 依赖来源（文件/Markdown）
3. 安装命令
4. 验证命令
5. 缺失工件（如有）

用户点击“确认安装”即视为对计划签名。

## 8. Driver 职责定义

每个 Driver 必须实现：

1. `preflight(scanResult) -> normalizedPlan`
2. `install(plan) -> logs + status`
3. `healthCheck(skillId) -> ok/error`
4. `reinstall(skillId) -> fresh_install`

## 9. 实施路线（Roadmap）

### Phase 0（基础建模）

- 定义状态机与 Shadow Manifest schema
- 建立 workspace 与元数据读写

### Phase 1（MVP）

- 上传能力
- Python Driver（`.venv` + pip 安装 + 验证）
- 安装日志（可先静态，再升级 SSE）

### Phase 2（智能预检）

- 规则引擎扫描文件/Markdown
- Agent 兜底生成 preflight 计划
- Web 可视化安装清单

### Phase 3（闭环恢复）

- 缺失工件检测与人工确认补全
- `reinstall` 流程
- 启动前 health check

### Phase 4（扩展）

- Node Driver
- 其他运行时按需扩展

## 10. 关键决策摘要

1. 不依赖远程 Skill 标准化格式。
2. 识别策略采用“规则优先，Agent 兜底”。
3. 默认强制 workspace 隔离，不走全局安装。
4. Shadow Manifest 双存储（DB + `.managed_meta.json`）。
5. 日志采用流式输出，提升安装可观测性与用户预期管理。
---

## 11. 架构评审：问题清单与废弃方案 ⚠️

> 以下是基于现有代码实现的架构评审。问题按严重程度排序。

### 11.1 🔴 致命：Skill 与 Tool 概念混淆

**现状**：在当前代码中，Skill 和 Tool 是**两个完全正交的系统**：

| | Tool | Skill |
|---|---|---|
| 有 `handler` 字段 | ✅ | ❌ |
| 有 `inputSchema` | ✅ | ❌ |
| 执行方式 | LLM tool_calling → handler 执行 → 返回数据 | Runner 注入 LLM 上下文（知识文档） |
| 类比 | 函数 | 操作手册 |
| 核心类型 | `CompiledTool.execute()` | `CompiledSkill`（无 execute） |
| 运行时文件 | `packages/agent/src/tools/` | `packages/agent/src/skills/` |

**问题**：本方案全文围绕"Skill 需要运行时依赖 / 创建 `.venv` / 执行 Python 脚本"展开，但 **Skill 根本不执行代码**。用户给出的 `akshare-stock-analysis.md` 虽然格式上像 Skill（没有 `handler`/`inputSchema`），但其核心功能是**调用 CLI 执行 Python 脚本**——这是 Tool 的职责。

本方案实际解决的问题是：**如何为外部 Tool（或 Skill + Tool 捆绑包）自动安装运行时依赖**，而非单纯的 Skill 问题。

**废弃方案**（防止后续写出错误代码）：
> ❌ 废弃：直接在 `SkillInstaller` 中添加 `preflight()`、`install(plan)`、`healthCheck()` 等运行时安装逻辑。Skill 是纯知识注入，不应有执行态。
>
> ✅ 正确方向：
> 1. 引入 **SkillPack**（技能包）概念：一个 SkillPack = 1 个 Skill（知识文档） + N 个 Tool（可执行工具） + 运行时声明。
> 2. 运行时安装逻辑应归属到一个新的 **RuntimeProvisioner** 服务，而非 SkillInstaller。
> 3. 安装 SkillPack 时，系统自动拆分：知识部分走 SkillInstaller，工具部分走 ToolInstaller + RuntimeProvisioner。

### 11.2 🔴 致命：`python`/`pip` 不在 CLI Handler 白名单

**现状**：`packages/agent/src/tools/handlers/cli.ts` 中 CLI handler 的 `BINARY_ALLOWLIST` 仅包含：

```typescript
const BINARY_ALLOWLIST = ["opencli", "gh", "docker", "curl"];
```

`FORBIDDEN_SHELL_PATTERN` 还禁止管道、`&&`、`$()`、反引号等 Shell 特性。

**问题**：方案假设可以直接 `python scripts/akshare_cli.py ...`，但现有 CLI handler **会拦截**所有不在白名单中的二进制。方案未讨论：
- 是否扩展 `BINARY_ALLOWLIST`（安全风险巨大）
- 还是为 Python/Node 创建新的 handler 类型

**废弃方案**：
> ❌ 废弃：将 `python`、`pip`、`node`、`npm` 加入全局 `BINARY_ALLOWLIST`。这会让所有 Tool 都能调用任意 Python/Node 命令，安全边界崩溃。
>
> ✅ 正确方向：
> 1. 新增 `python-venv` handler 类型（与 `cli` 并列），专门处理带虚拟环境的 Python 命令。
> 2. handler 内部硬编码解释器路径为 `data/skills/workspaces/{skillId}/.venv/bin/python`，禁止用户自选解释器。
> 3. `handlerConfig` 中声明 `skillId` 以绑定 workspace，运行时自动拼接路径。

### 11.3 🟠 严重：Shadow Manifest 双存储与现有架构冲突

**现状**：
- 当前 Skill/Tool 状态存储是**纯文件系统**：`data/skills/state.json`、`data/tools/state.json`。
- `agent` 包**禁止直接使用 Prisma**（必须通过 Port 接口，见 AGENTS.md 依赖方向约束）。

**问题**：
1. 方案提出 Shadow Manifest "DB + `.managed_meta.json`" 双存储，但 `agent` 包内的 Installer 不能访问数据库。
2. 当前 Installer 的设计是自洽的文件系统方案，引入 DB 会打破 Port/Adapter 边界。

**废弃方案**：
> ❌ 废弃：在 `packages/agent/src/skills/installer.ts` 中直接调用 Prisma 进行双存储。违反依赖方向约束。
>
> ✅ 正确方向：
> 1. `.managed_meta.json` 作为唯一存储（与现有 `state.json` 模式一致）。
> 2. 如果需要 DB 同步，由 `server` 包的 API 层在调用 Installer 后同步写入 DB（server → agent 单向依赖）。
> 3. 或者通过 `agent` 的 Port 接口定义 `RuntimeMetadataStore`，由 `server` 提供 Prisma 实现注入。

### 11.4 🟠 严重：API 设计与现有 API 不一致

**现状**：当前 Skills API（`packages/server/src/api/routes/skills.ts`）：

| 方法 | 路径 | 标识符 |
|---|---|---|
| GET | `/api/skills` | — |
| GET | `/api/skills/:name` | `name`（如 `healthy-meal-reminder`） |
| POST | `/api/skills` | body.markdown |
| PUT | `/api/skills/:name` | `name` |
| DELETE | `/api/skills/:name` | `name` |

**问题**：
1. 方案使用 `skillId`（如 `sk_123`）作为标识符，但现有系统用 `name`（frontmatter 中的 `name` 字段）。
2. 方案新增 `/api/skills/upload`、`/api/skills/{id}/preflight`、`/api/skills/{id}/install` 等端点，与现有 RESTful CRUD 风格不一致。
3. 现有 `POST /api/skills` 是"安装"语义，方案将其拆分为 upload → preflight → install 三步，但没有说明如何兼容已有端点。

**废弃方案**：
> ❌ 废弃：新增 `/api/skills/upload`、`/api/skills/{id}/preflight`、`/api/skills/{id}/install` 三个独立端点。与现有 API 风格割裂，前端需要维护两套调用逻辑。
>
> ✅ 正确方向：
> 1. 保持 `name` 作为标识符（与现有一致）。
> 2. 将 preflight 作为 `POST /api/skills` 的**可选步骤**：`POST /api/skills?dryRun=true` 返回安装计划，不实际安装。
> 3. 安装日志通过 `GET /api/skills/:name/logs`（SSE）获取。
> 4. 运行时安装作为 `POST /api/skills/:name/provision` 独立端点（仅 SkillPack 类型需要）。

### 11.5 🟠 严重：Sample Skill 的 frontmatter 不符合现有 schema

**现状**：当前 `SkillSource` 要求的 frontmatter 字段：

```typescript
// packages/agent/src/skills/compiler.ts → createSkillSource()
name: string          // 必填，/^[a-z][a-z0-9_-]{1,48}$/
version: string       // 必填
type: "skill"         // 必填，固定值
author?: string       // 可选
summary: string       // 必填
activation: "always" | "on-demand"  // 必填
```

**问题**：用户给出的 `akshare-stock-analysis.md` frontmatter：

```yaml
name: akshare-stock-analysis     # ✅ 合法
description: "专业股票分析..."     # ❌ 字段名错误，应为 summary
license: "Copyright © ..."        # ❌ 不在 schema 中
# 缺失: version, type, activation # ❌ 必填字段缺失
```

方案提到"不要求远程 Skill 提供统一配置文件"，但**完全没有设计 frontmatter 规范化/补全策略**。这些非标准 Skill 在当前 `createSkillSource()` 中会直接报错。

**废弃方案**：
> ❌ 废弃：放松 `createSkillSource()` 的校验规则，让非标准字段也通过。会导致运行时不可预测。
>
> ✅ 正确方向：
> 1. 在规则引擎阶段增加 **frontmatter 规范化器**（normalizer）：
>    - `description` → `summary`（字段名映射）
>    - 缺失 `version` → 默认 `"0.0.0"`
>    - 缺失 `type` → 从内容推断（有 `handler`/`inputSchema` → `"tool"`，否则 → `"skill"`）
>    - 缺失 `activation` → 默认 `"on-demand"`
> 2. 规范化结果写入 Shadow Manifest，不修改原始 `.md` 文件。
> 3. 不识别的字段（如 `license`）保留但不参与运行时逻辑。

### 11.6 🟡 一般：workspace 目录结构与现有布局冲突

**现状**：

```
data/skills/
├── state.json
├── builtin/          ← 内置 Skill（.md 文件）
└── user/             ← 用户安装的 Skill（.md 文件）
```

每个 Skill 是**单个 .md 文件**。

**问题**：方案提出 `data/skills/workspaces/{skillId}/`，但：
1. 纯知识型 Skill 不需要 workspace（一个 .md 文件足矣）。
2. 只有带运行时的 SkillPack 才需要 workspace 目录。
3. 方案未区分两者，会让简单 Skill 也被迫放入 workspace 目录。

**废弃方案**：
> ❌ 废弃：将所有 Skill 迁移到 `data/skills/workspaces/{skillId}/` 目录结构。对纯知识型 Skill 来说是不必要的复杂化。
>
> ✅ 正确方向：
> ```
> data/skills/
> ├── state.json
> ├── builtin/                    ← 内置 Skill（.md）
> ├── user/                       ← 用户 Skill（.md）
> └── packs/                      ← SkillPack（带运行时的捆绑包）
>     └── akshare-stock-analysis/
>         ├── skill.md            ← 知识文档
>         ├── tool.md             ← 工具声明
>         ├── .managed_meta.json  ← Shadow Manifest
>         ├── scripts/            ← 可执行脚本
>         └── .venv/              ← Python 虚拟环境
> ```

### 11.7 🟡 一般：状态机过度设计

**现状**：当前 Skill 安装状态只有 `enabled: boolean`，状态管理仅 2 行 JSON。

**问题**：方案提出 7 个状态（`uploaded → preflight_ready → preflight_failed → installing → ready → failed → repairing`），对于纯知识型 Skill 而言是过度设计。即使对于带运行时的 SkillPack，`preflight_ready` 和 `preflight_failed` 也可以是临时态，不需要持久化。

**废弃方案**：
> ❌ 废弃：为所有 Skill 统一使用 7 状态机。纯知识型 Skill 被迫走 preflight 流程毫无意义。
>
> ✅ 正确方向：
> - 纯知识 Skill：保持 `enabled: boolean`。
> - SkillPack：扩展为 `status: "pending" | "provisioning" | "ready" | "failed"`（4 个状态）。
> - `preflight` 是一次性查询操作，结果不作为持久化状态。

### 11.8 🟡 一般：安全模型过于薄弱

**现状**：方案声明"假设用户上传的是自有 Skill"，仅保留"基础白名单与隔离"。

**问题**：
1. `.venv` 隔离仅隔离 Python 依赖，**不隔离文件系统访问和网络**。
2. 恶意脚本可以读取 `config.yaml`（含 API Key）、`data/` 目录（含用户数据）、环境变量等。
3. 这个系统设计为**多账号管理平台**，一个恶意 Skill 可能影响所有账号。

**废弃方案**：
> ❌ 废弃：仅依赖 `.venv` 隔离作为安全边界。
>
> ✅ 正确方向（按优先级）：
> 1. **最小权限执行**：Python 进程以降权用户运行，`cwd` 锁定在 workspace 内，`PATH` 仅包含 `.venv/bin`。
> 2. **环境变量过滤**：执行脚本时清除敏感环境变量（API Key、DB 连接串等），仅传入白名单变量。
> 3. **输出大小限制**：已有（`maxOutputChars: 4000`），保持。
> 4. **超时强制杀进程**：已有（`MAX_TIMEOUT_MS: 120000`），保持。
> 5. **远期**：考虑 Docker/nsjail 沙箱（非首期）。

### 11.9 🟡 一般：未讨论 Skill 的 `activation` 语义与运行时失败的交互

**问题**：如果一个带运行时依赖的 SkillPack 被配置为 `activation: "always"`，但其运行时安装失败（`status: "failed"`），会发生什么？

- 如果阻塞所有对话 → 单个 Skill 故障导致全局不可用。
- 如果静默跳过 → 用户不知道 Skill 未生效。

**废弃方案**：
> ❌ 废弃：运行时安装失败的 Skill 仍然注入 always-on 上下文。LLM 会按照 Skill 知识行事，但执行工具时必然失败，产生混乱。
>
> ✅ 正确方向：运行时未 Ready 的 SkillPack 自动降级为 `disabled`，并在 Web 端显示告警，不阻塞其他对话。

### 11.10 💡 建议：缺少对 Sample Skill 的根本性改造方案

用户提供的 `akshare-stock-analysis.md` 要真正运行在当前系统里，需要拆分为：

**1. Skill 文件** `data/skills/packs/akshare-stock-analysis/skill.md`：
```yaml
---
name: akshare-stock-analysis
version: 1.0.0
type: skill
author: 少煊
summary: 专业股票分析技能，基于 AKShare 数据
activation: on-demand
---
# 知识文档（保留原文的"使用场景示例"等指导性内容）
```

**2. Tool 文件** `data/skills/packs/akshare-stock-analysis/tool.md`：
```yaml
---
name: akshare-cli
version: 1.0.0
type: tool
author: 少煊
summary: 调用 AKShare CLI 查询股票/基金/期货数据
handler: python-venv
handlerConfig:
  skillPack: akshare-stock-analysis
  entrypoint: scripts/akshare_cli.py
  timeout: 30000
inputSchema:
  subcommand:
    type: string
    description: "子命令：spot|tech|diagnose|plates|summary|detail|kline|northbound"
    required: true
  args:
    type: string
    description: "子命令参数，如 --code 600000 --start 20240101"
---
```

**3. 运行时声明** `.managed_meta.json`：
```json
{
  "schemaVersion": 1,
  "runtime": "python",
  "dependencies": ["akshare", "pandas", "numpy"],
  "entrypoint": "scripts/akshare_cli.py",
  "status": "pending"
}
```

这样才能与现有 Tool/Skill 双系统架构对齐。

---

### 评审摘要

| # | 级别 | 问题 | 关键词 |
|---|------|------|--------|
| 11.1 | 🔴 致命 | Skill 与 Tool 概念混淆，方案将执行逻辑加在纯知识系统上 | SkillPack |
| 11.2 | 🔴 致命 | `python` 不在 CLI handler 白名单，方案未设计新 handler | python-venv handler |
| 11.3 | 🟠 严重 | Shadow Manifest DB 存储违反 agent 包依赖约束 | Port/Adapter |
| 11.4 | 🟠 严重 | API 端点/标识符与现有 RESTful 不一致 | name vs skillId |
| 11.5 | 🟠 严重 | 非标准 frontmatter 无规范化策略 | normalizer |
| 11.6 | 🟡 一般 | workspace 目录对纯知识 Skill 过度设计 | packs/ 分离 |
| 11.7 | 🟡 一般 | 7 状态机对纯知识 Skill 过度设计 | 4 状态 |
| 11.8 | 🟡 一般 | 安全模型仅 `.venv` 隔离，不足 | 环境变量+降权 |
| 11.9 | 🟡 一般 | 未处理 always-on + 运行时失败的交互 | 自动降级 |
| 11.10 | 💡 建议 | 缺少对 Sample Skill 的具体拆分方案 | Skill + Tool + Meta |

> **⚠️ 注意**：第 11 节中提出的 `SkillPack` 概念（11.1、11.6、11.10）已在第 12 节中被废弃。第 12 节是最终修订方案。

---

## 12. 修订方案：统一 Skill 模型（Unified Skill Model）

> 本节替代第 11.1 / 11.6 / 11.10 中的 SkillPack 方案。

### 12.1 设计原则

**废弃概念**：

> ❌ `SkillPack`：混合了外部概念与内部实现细节，引入额外心智负担。
> ❌ `mode: knowledge` / `mode: executable`：本质仍是两种类型，只是换了名字，对内维护会产生与 `type: "tool" | "skill"` 相同的分支判断。

**采纳原则**：

1. **对外只有一个概念：Skill**。API、Web、文档、用户交互中只出现 `Skill`。
2. **不引入显式 `mode` 字段**。Skill 是否可执行，由 `handler` + `inputSchema` 字段的存在性隐式决定（自描述）。
3. **内部 Tool/Skill 注册表保持正交**。SkillCompiler 在检测到可执行字段时，自动产出**伴生 Tool**（companion tool），由 SkillInstaller 统一注册到 ToolRegistry。伴生 Tool 的生命周期绑定在 Skill 上：Skill 删除时伴生 Tool 自动注销，Skill 禁用时伴生 Tool 同步禁用。
4. **运行时隔离单独处理**。`runtime` 声明与 handler 分离，由 RuntimeProvisioner 服务负责，不侵入现有 Skill/Tool 编译链路。

### 12.2 Frontmatter Schema 扩展

在现有 `SkillSource` 基础上，新增**可选字段**（无可执行字段时完全兼容现有纯知识 Skill）：

```yaml
---
# ───── 现有字段（必填） ─────
name: akshare-stock-analysis          # 唯一标识
version: 1.0.0
type: skill                           # 固定 "skill"，不变
summary: 专业股票分析技能
activation: on-demand

# ───── 可选：伴生工具声明 ─────
handler: python-script                # 存在即表示该 Skill 有可执行能力
handlerConfig:                        #   └ handler 特有配置
  entrypoint: scripts/akshare_cli.py
  timeout: 30000
inputSchema:                          # 存在即注册为 LLM tool
  subcommand:
    type: string
    description: "子命令：spot|tech|diagnose|plates|summary|detail|kline|northbound"
    required: true
  args:
    type: string
    description: "子命令参数，如 --code 600000 --start 20240101"

# ───── 可选：运行时声明 ─────
runtime:
  type: python                        # python | node（首期仅 python）
  dependencies:                       # 自动 pip install 的包列表
    - akshare
    - pandas
    - numpy
---

# Markdown body：知识文档，注入 LLM 上下文
# 此处保留"使用场景"、"CLI 命令"、"数据格式"等指导性内容。
# LLM 阅读后了解何时调用伴生 Tool、如何解读输出。
```

**判断规则**：

| `handler` 存在？ | `inputSchema` 存在？ | `runtime` 存在？ | 结果 |
|---|---|---|---|
| ❌ | ❌ | ❌ | 纯知识 Skill（与现有行为完全一致） |
| ❌ | ❌ | ✅ | 带依赖的知识 Skill（先 provision 再使用，但不产生 Tool） |
| ✅ | ✅ | ❌ | 可执行 Skill，无需运行时安装（如调用系统已有的二进制） |
| ✅ | ✅ | ✅ | 可执行 Skill + 运行时安装（完整路径，如 akshare 示例） |
| ✅ | ❌ | — | ❌ 编译报错：有 handler 但没有 inputSchema |
| ❌ | ✅ | — | ❌ 编译报错：有 inputSchema 但没有 handler |

### 12.3 统一目录结构

**废弃**：
> ❌ `data/skills/builtin/*.md`（散装文件）
> ❌ `data/skills/packs/`（SkillPack 专属目录）
> ❌ `data/skills/workspaces/`（原方案的 workspace 目录）

**采纳**：所有 Skill 统一为目录结构，不区分纯知识/可执行。

```
data/skills/
├── state.json                             ← 全局状态（enabled/disabled）
├── builtin/
│   └── healthy-meal-reminder/
│       └── skill.md                       ← 纯知识 Skill，仅一个文件
└── user/
    └── akshare-stock-analysis/
        ├── skill.md                       ← Skill 定义（知识 + 可选的伴生 Tool 声明）
        ├── scripts/                       ← 可选：可执行脚本
        │   └── akshare_cli.py
        ├── .venv/                         ← 自动创建：Python 虚拟环境
        └── .managed_meta.json             ← 自动生成：运行时元数据
```

**规则**：
- Skill 入口固定为目录内的 `skill.md`（不支持其他文件名）。
- Loader 扫描逻辑从 "遍历 `*.md`" 改为 "遍历子目录，读取 `{dir}/skill.md`"。
- 纯知识 Skill 的目录内只有 `skill.md`，没有额外文件，保持简洁。
- `.venv/`、`.managed_meta.json` 由 RuntimeProvisioner 自动管理，不由用户手动创建。

### 12.4 类型系统变更

```typescript
// ═══ packages/agent/src/skills/types.ts 扩展 ═══

import type { ParameterDef } from "../tools/types.js";

export interface SkillSource {
  // ── 现有字段（不变） ──
  name: string;
  version: string;
  type: "skill";
  author?: string;
  summary: string;
  activation: SkillActivation;
  body: string;
  filePath: string;

  // ── 新增可选字段 ──
  handler?: string;                              // 存在 → 可执行
  handlerConfig?: Record<string, unknown>;
  inputSchema?: Record<string, ParameterDef>;    // 存在 → 注册伴生 Tool
  runtime?: SkillRuntime;                        // 存在 → 需要 provision
}

export interface SkillRuntime {
  type: "python" | "node";
  dependencies: string[];
}

export interface CompiledSkill {
  source: SkillSource;
  companionTool?: import("../tools/types.js").CompiledTool;  // 有执行能力时填充
}

// ── 运行时状态（仅可执行 Skill） ──
export type ProvisionStatus = "pending" | "provisioning" | "ready" | "failed";

// InstalledSkill 扩展
export interface InstalledSkill {
  skill: CompiledSkill;
  origin: "builtin" | "user";
  enabled: boolean;
  installedAt: string;
  provisionStatus?: ProvisionStatus;  // 仅当 runtime 存在时有值
  provisionError?: string;            // 仅当 failed 时有值
}
```

### 12.5 编译流程变更

```
                      ┌──────────────┐
                      │  skill.md    │
                      │ (frontmatter │
                      │  + body)     │
                      └──────┬───────┘
                             │
                      createSkillSource()
                     （扩展：提取可选的 handler/inputSchema/runtime）
                             │
                             ▼
                      ┌──────────────┐
                      │ SkillSource  │
                      │ handler?: ✓  │
                      │ inputSchema?:│
                      │ runtime?: ✓  │
                      └──────┬───────┘
                             │
                      compileSkill()
                             │
                   ┌─────────┴─────────┐
                   │ handler 存在？     │
                   ├── 否 ─→ 纯知识    │
                   │   CompiledSkill {  │
                   │     source,       │
                   │     companionTool: │
                   │       undefined   │
                   │   }               │
                   ├── 是 ─→ 可执行    │
                   │   1. 复用 Tool     │
                   │      编译链路     │
                   │      (getNative   │
                   │       Handler →   │
                   │       buildTool   │
                   │       Parameters) │
                   │   2. CompiledSkill│
                   │      {           │
                   │        source,   │
                   │        companion │
                   │        Tool: ✓   │
                   │      }           │
                   └───────────────────┘
```

**关键**：`compileSkill()` 内部复用 `packages/agent/src/tools/compiler.ts` 的 `buildToolParameters()`、`getNativeHandler()` 函数，不重复实现。伴生 Tool 的名字默认等于 Skill 的 `name`。

### 12.6 Installer 注册逻辑

`SkillInstaller.rebuild()` 在生成快照时：

1. 遍历所有已安装且 enabled 的 Skill。
2. 知识部分如常注册到 **SkillRegistry**。
3. 如果 `compiledSkill.companionTool` 存在 **且** `provisionStatus === "ready"`（或无 `runtime` 声明）：
   - 将伴生 Tool 注册到 **ToolRegistry**。
4. 如果 `companionTool` 存在但 `provisionStatus !== "ready"`：
   - **不注册伴生 Tool**（LLM 不可见）。
   - 知识部分仍注入（让 LLM 知道该能力存在但暂不可用）。

**生命周期绑定**：
```
Skill 安装 → 伴生 Tool 自动注册（如果 runtime ready）
Skill 禁用 → 伴生 Tool 自动注销
Skill 删除 → 伴生 Tool 自动注销
Skill 更新 → 伴生 Tool 自动替换
Runtime 从 failed → ready → 伴生 Tool 补注册
```

### 12.7 新增 `python-script` Handler

**废弃**：
> ❌ 将 `python`/`pip` 加入 `BINARY_ALLOWLIST`。全局开放，安全边界崩溃。
> ❌ 在 `cli` handler 中特判 Python。职责混乱。

**采纳**：新增独立 handler `python-script`，与 `cli`/`web-search` 并列。

```typescript
// packages/agent/src/tools/handlers/python-script.ts

import { execFile } from "node:child_process";
import { resolve, join } from "node:path";
import type { NativeHandler, ToolContext, ToolContent } from "../types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_CHARS = 8_000;

// 安全：清除敏感环境变量
function sanitizeEnv(): Record<string, string> {
  const env = { ...process.env };
  const SENSITIVE_PREFIXES = [
    "DATABASE_", "DB_", "OPENAI_", "ANTHROPIC_",
    "AWS_", "AZURE_", "JWT_", "SECRET_", "API_KEY",
  ];
  for (const key of Object.keys(env)) {
    if (SENSITIVE_PREFIXES.some((p) => key.toUpperCase().startsWith(p))) {
      delete env[key];
    }
  }
  return env as Record<string, string>;
}

export const pythonScriptHandler: NativeHandler = {
  async execute(args, config, ctx) {
    const entrypoint = config.entrypoint as string;
    const skillDir = config.__skillDir as string; // Installer 注入
    const timeout = Math.min(
      Number(config.timeout) || DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    );

    // 解析器路径：强制使用 Skill workspace 内的 .venv
    const pythonBin = join(skillDir, ".venv", "bin", "python");
    const scriptPath = resolve(skillDir, entrypoint);

    // 构建命令参数
    const cmdArgs = [scriptPath];
    if (args.subcommand) cmdArgs.push(String(args.subcommand));
    if (args.args) cmdArgs.push(...String(args.args).split(/\s+/));

    return new Promise<ToolContent[]>((resolve, reject) => {
      const child = execFile(
        pythonBin,
        cmdArgs,
        {
          cwd: skillDir,
          timeout,
          maxBuffer: 1024 * 1024,
          env: sanitizeEnv(),
        },
        (error, stdout, stderr) => {
          if (ctx.signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
          const output = (stdout || stderr || error?.message || "").slice(0, MAX_OUTPUT_CHARS);
          resolve([{ type: "text", text: output }]);
        },
      );
      ctx.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    });
  },
};
```

**Handler 注册**：

```typescript
// packages/agent/src/tools/handlers/index.ts 修改

import { pythonScriptHandler } from "./python-script.js";

const HANDLER_ALLOWLIST: Record<string, NativeHandler> = {
  "web-search": webSearchHandler,
  "cli": cliHandler,
  "python-script": pythonScriptHandler,  // 新增
};
```

**安全边界**：
- 解释器路径硬编码为 `{skillDir}/.venv/bin/python`，用户无法指定任意二进制。
- `cwd` 锁定在 Skill 目录内。
- 环境变量经 `sanitizeEnv()` 过滤。
- 输出大小限制（`MAX_OUTPUT_CHARS`）。
- 超时 + SIGTERM 强制终止。

### 12.8 RuntimeProvisioner 服务

位于 `packages/agent/src/skills/runtime-provisioner.ts`，纯 agent 包内实现（不依赖 Prisma）。

```typescript
interface RuntimeProvisioner {
  /** 预检：返回安装计划 */
  preflight(skill: InstalledSkill): Promise<ProvisionPlan>;

  /** 执行安装（创建 .venv → pip install → 验证） */
  provision(skill: InstalledSkill): AsyncGenerator<ProvisionLog>;

  /** 健康检查 */
  healthCheck(skillDir: string, runtime: SkillRuntime): Promise<boolean>;

  /** 清理重装 */
  reprovision(skill: InstalledSkill): AsyncGenerator<ProvisionLog>;
}

interface ProvisionPlan {
  runtime: "python" | "node";
  steps: string[];           // 人类可读的安装步骤
  dependencies: string[];
  estimatedDiskMB?: number;
}

interface ProvisionLog {
  level: "info" | "warn" | "error";
  message: string;
  timestamp: number;
}
```

**Python Driver 实现要点**：

1. `python3 -m venv {skillDir}/.venv`
2. `{skillDir}/.venv/bin/python -m pip install --upgrade pip`
3. `{skillDir}/.venv/bin/python -m pip install <dependencies>`
4. 验证：执行 Skill 声明的 `entrypoint` 的 `--version` 或 `import` 检查
5. 写入 `.managed_meta.json`（状态 + content hash + 时间戳）

### 12.9 API 设计修订

保持现有 RESTful 一致性，扩展而非重建：

| 方法 | 路径 | 说明 | 变更 |
|---|---|---|---|
| GET | `/api/skills` | 列表 | ⬜ 不变 |
| GET | `/api/skills/:name` | 详情 | 🔸 返回体新增 `provisionStatus?` |
| POST | `/api/skills` | 安装 | 🔸 支持 `multipart/form-data`（上传目录/zip） |
| POST | `/api/skills?dryRun=true` | **预检** | 🆕 返回安装计划，不实际安装 |
| PUT | `/api/skills/:name` | 更新 | ⬜ 不变 |
| DELETE | `/api/skills/:name` | 删除 | 🔸 同时清理 `.venv` 和 `scripts/` |
| POST | `/api/skills/:name/enable` | 启用 | ⬜ 不变 |
| POST | `/api/skills/:name/disable` | 禁用 | 🔸 同步注销伴生 Tool |
| POST | `/api/skills/:name/provision` | **安装运行时** | 🆕 触发 RuntimeProvisioner |
| GET | `/api/skills/:name/provision/logs` | **安装日志（SSE）** | 🆕 流式输出 pip/npm 日志 |
| POST | `/api/skills/:name/reprovision` | **重装运行时** | 🆕 清理 + 重装 |

**标识符**：始终使用 `name`（frontmatter 中的 `name` 字段），不引入 `skillId`。

### 12.10 Frontmatter 规范化器（Normalizer）

用于处理市面上非标准格式的 Skill Markdown，在编译前自动修正。

```typescript
// packages/agent/src/skills/normalizer.ts

interface NormalizeResult {
  normalized: Record<string, unknown>;  // 修正后的 frontmatter
  warnings: string[];                   // 修正说明（给前端展示）
}

function normalizeFrontmatter(raw: Record<string, unknown>): NormalizeResult {
  const warnings: string[] = [];
  const result = { ...raw };

  // 字段名映射
  if (result.description && !result.summary) {
    result.summary = result.description;
    delete result.description;
    warnings.push('字段 "description" 已映射为 "summary"');
  }

  // 缺失字段补全
  if (!result.version) {
    result.version = "0.0.0";
    warnings.push('缺失 "version"，已设为 "0.0.0"');
  }
  if (!result.type) {
    result.type = result.handler || result.inputSchema ? "tool" : "skill";
    warnings.push(`缺失 "type"，已推断为 "${result.type}"`);
  }
  if (!result.activation && result.type === "skill") {
    result.activation = "on-demand";
    warnings.push('缺失 "activation"，已设为 "on-demand"');
  }

  // 未识别字段保留但不参与运行时
  // （如 license、tags 等市面常见的自定义字段）

  return { normalized: result, warnings };
}
```

**调用时机**：`POST /api/skills` 和 `POST /api/skills?dryRun=true` 时，在 `createSkillSource()` 之前执行。前端展示 `warnings` 供用户确认。

### 12.11 状态管理修订

**废弃**：
> ❌ 7 状态机（uploaded → preflight_ready → ... → repairing）。
> ❌ 为纯知识 Skill 增加 provisionStatus。

**采纳**：

```
纯知识 Skill 状态：
  enabled: boolean          ← 与现有完全一致

可执行 Skill 状态（有 runtime 声明时）：
  enabled: boolean          ← Skill 整体开关
  provisionStatus:
    "pending"       → 刚安装，未执行 provision
    "provisioning"  → 正在安装依赖
    "ready"         → 依赖已就绪，伴生 Tool 已注册
    "failed"        → 安装失败，伴生 Tool 未注册
```

**交互规则**：
- `provisionStatus` 仅当 `runtime` 字段存在时才有意义。
- 纯知识 Skill 的 JSON 状态文件中不出现 `provisionStatus`。
- `enabled: false` 时无论 `provisionStatus` 如何，伴生 Tool 都不注册。
- `enabled: true && provisionStatus: "failed"` → 知识部分仍注入上下文，但在正文前注入提示："⚠️ 该技能的运行时未就绪，相关命令暂时不可用。"

### 12.12 akshare 示例：完整改造

按统一模型，用户提供的 `akshare-stock-analysis.md` 改造为：

**目录**：`data/skills/user/akshare-stock-analysis/`

**`skill.md`**：

```yaml
---
name: akshare-stock-analysis
version: 1.0.0
type: skill
author: 少煊
summary: 专业股票分析技能整合 akshare 数据 + 技术指标 + 板块轮动 + 持仓诊断
activation: on-demand

handler: python-script
handlerConfig:
  entrypoint: scripts/akshare_cli.py
  timeout: 30000
inputSchema:
  subcommand:
    type: string
    description: "子命令：spot | tech | diagnose | plates | summary | detail | kline | northbound"
    required: true
  args:
    type: string
    description: "子命令参数，如 --code 600000 --start 20240101 --end 20241231"

runtime:
  type: python
  dependencies:
    - akshare
    - pandas
    - numpy
---

# AKShare Stock Analysis Skill

基于 AKShare 实现股票数据查询…

（以下保留原始 Skill 正文：使用场景、CLI 命令说明、数据格式等）
```

**效果**：
- SkillCompiler 解析出 `handler: "python-script"` + `inputSchema` → 产出 `companionTool`。
- SkillInstaller 将知识注册到 SkillRegistry（on-demand），伴生 Tool 注册到 ToolRegistry。
- RuntimeProvisioner 根据 `runtime` 声明创建 `.venv`，安装 akshare/pandas/numpy。
- LLM 通过 `use_skill` 加载知识，通过 tool_calling 调用 `akshare-stock-analysis`（伴生 Tool 名 = Skill 名）。
- 用户从头到尾只看到一个 "Skill"。

### 12.13 实施路线修订

| Phase | 内容 | 依赖 |
|---|---|---|
| **0: 目录迁移** | Skill 存储从散装 `.md` 迁移到 `{name}/skill.md` 目录结构；Loader 改为扫描子目录 | 无 |
| **1: Frontmatter 扩展** | `SkillSource` 新增可选字段；`compileSkill()` 检测伴生 Tool 并复用 Tool 编译链路 | Phase 0 |
| **2: python-script handler** | 实现 `python-script` handler；注册到 `HANDLER_ALLOWLIST` | Phase 1 |
| **3: RuntimeProvisioner** | `.venv` 创建 + pip 安装 + 验证 + `.managed_meta.json`；`SkillInstaller.rebuild()` 集成 provisionStatus | Phase 2 |
| **4: API + Web** | `dryRun` 预检、`/provision` 端点、SSE 日志、前端安装计划面板 | Phase 3 |
| **5: Normalizer** | 非标准 frontmatter 规范化；导入市面 Skill 时自动修正 | Phase 1 |
| **6: Node Driver** | `node` 运行时支持（按需） | Phase 3 |

### 12.14 修订决策摘要

| # | 决策 | 替代 11 节中的 |
|---|---|---|
| 1 | 废弃 SkillPack，对外统一叫 Skill | 11.1 |
| 2 | 不使用显式 `mode` 字段，通过 `handler`/`inputSchema` 存在性隐式判断 | 11.1 |
| 3 | 所有 Skill 统一目录结构 `{name}/skill.md`，不分 packs/ | 11.6 |
| 4 | 伴生 Tool 由 SkillCompiler 自动产出，生命周期绑定 Skill | 11.10 |
| 5 | 新增 `python-script` handler，不扩展 `BINARY_ALLOWLIST` | 11.2 |
| 6 | Shadow Manifest 仅文件存储，不直接写 DB | 11.3 |
| 7 | API 保持 `name` 标识符，扩展 `dryRun`+`provision` 子资源 | 11.4 |
| 8 | 4 状态机（仅可执行 Skill），纯知识 Skill 保持 `enabled: boolean` | 11.7 |
| 9 | runtime 未 ready 时知识仍注入但标注警告，伴生 Tool 不注册 | 11.9 |
