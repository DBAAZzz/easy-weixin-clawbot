# Skill 详情弹窗「环境配置」改版设计（2026-07-24）

> 阅读对象：负责实施的 AI 编程智能体。本文是需求访谈（grilling）后达成的共识记录，用于指导 `packages/web/src/features/Skills/` 及配套后端改动。文中标注的文件路径/行号以调研时的代码为准，实施时若有漂移，以「本文描述的语义」为准。
>
> 范围边界：**文档（Markdown）Tab 不做改动**，本文仅覆盖「环境配置」（runtime）Tab 及其依赖的后端能力。

---

## 0. 背景与现状问题

用户诉求：Skill 详情弹窗的「环境配置」页期望更清晰——通过环境检测列表展示 Python 环境、numpy、pandas 等依赖在当前运行环境中是否满足；点击安装时通过 SSE 展示完整安装过程。

调研发现两处现状缺口：

1. **`preflight` 从不检测真实环境状态**。`packages/agent/src/skills/runtime-provisioner.ts` 的 `createProvisionPlan()` 只描述「将要安装什么」（依赖名/来源/置信度），从未检查 numpy/pandas 等具体依赖当前是否已满足。唯一涉及宿主探测的是 `ensureBinaryAvailable()`（`runtime-provisioner.ts:109-116`，跑 `<binary> --version` 仅用于选择安装器）和只服务于上传流程的 `buildLocalRunCheck()`（`packages/server/src/api/routes/skills.ts:28-96`），两者都不检查具体包依赖。
2. **重装（reprovision）没有 SSE**。首次安装（`onProvision` → `handleProvision` → `streamProvision`）已经走 SSE（`GET /api/skills/:name/provision/logs`，`packages/server/src/api/routes/skills.ts:318-349`）。但只要 `provisionStatus` 是 `"ready"`/`"failed"` 或已有 `installedAt`（`SkillDetailModal.tsx:69-74` 的判断），弹窗就会改走 `onReprovision` → `handleReprovision` → 阻塞式 `POST /api/skills/:name/reprovision`（`skills.ts:293-316`），一次性等待安装完成后才返回全部日志，过程中前端完全看不到实时输出。这是大多数「已经点过一次」的 skill 在实际使用中看不到日志流的根因。

---

## 1. 数据模型改动

`packages/shared/src/types.ts` 的 `SkillProvisionPlan.dependencies[]` 增加满足状态字段：

```ts
export type SkillDependencyStatus = "ok" | "missing" | "outdated" | "unknown";

export interface SkillDependencyCheck {
  name: string;
  installSpec?: string;
  source: "markdown-install" | "import-scan" | "requirements-txt" | "frontmatter";
  confidence: "high" | "medium" | "low";
  status: SkillDependencyStatus;   // 新增
  installedVersion?: string;       // 新增
}

export interface SkillRuntimeCheck { // 新增：解释器自身
  runtime: "python" | "node";
  binary: string;                    // "python3" | "node"
  status: "ok" | "missing";
  version?: string;                  // "3.11.5"
  envReady: boolean;                 // .venv / node_modules 是否已就绪
}

export interface SkillProvisionPlan {
  runtime: "python" | "node";
  installer: "uv-pip" | "pip" | "npm" | "pnpm" | "yarn" | "manual";
  createEnv: boolean;
  commandPreview: string[];
  dependencies: SkillDependencyCheck[];
  runtimeCheck: SkillRuntimeCheck;
}
```

> 实施时对原设计的两处调整：
> 1. `runtimeCheck` 只承载事实（binary/version/envReady），**不含 `label` 文案**——中文标签由 web 层组装，避免 agent 包出现面向用户的展示文案。
> 2. `runtimeCheck.status` 去掉了 `unknown`：探测手段就是跑 `--version`，只有「能跑」和「不能跑」两种结果。

四种 `status` 的含义：

| 状态 | 含义 | UI 表现 |
|---|---|---|
| `ok` | 已安装且满足 `installSpec` 约束（无约束则视为已安装即满足） | 绿色勾选 |
| `missing` | 确认未安装 | 红色/警示，需安装 |
| `outdated` | 已安装但版本不满足 `installSpec`（如需要 `>=1.20` 实装 `1.18`） | 黄色警示，展示「已装 x.y，需 z」 |
| `unknown` | 无法执行检测本身（如 `pip`/`uv` 二进制缺失，查不到包状态） | 中性图标+提示文案，不等同于「缺失」 |

`runtimeCheck` 是解释器自身的探测结果，作为列表第一行，在依赖列表之前展示。

---

## 2. 检测机制（后端，`packages/agent/src/skills/runtime-provisioner.ts`）

探测逻辑落在两个新文件：

- `packages/agent/src/skills/version-spec.ts`：纯函数，版本约束解析与比较。
- `packages/agent/src/skills/environment-probe.ts`：环境探测（解释器 + 已安装包快照）。

`RuntimeAdapter` 新增 `probeRuntime()` / `probeDependencies()` 两个方法，python 与 node 各自实现。

### 2.1 Python 依赖

**对原设计的调整**：不再对每个依赖跑一次 `pip show`，改为**一次** `python -c` 元数据查询拿到全量快照：

```python
import importlib.metadata as md
# {"versions": {发行版名: 版本}, "modules": {顶层模块名: [发行版名]}}
```

这样做的两个收益：

1. **子进程数与依赖个数无关**——恒定 1 次，而不是 N 次。
2. **修正 import 名与发行版名不一致**。`packages_distributions()` 给出「顶层模块名 → 发行版」映射，import 扫描得到的 `yaml` 能正确解析到 `PyYAML`。没有这一步，凡是 import 名与包名不同的依赖（yaml/PIL/cv2/sklearn）都会被误报为「未安装」。已实测验证：`yaml` → PyYAML 6.0.3，status = ok。

它仍然只是**元数据查询**，不是逐个 `import` 依赖，符合原定的「不为验证依赖而启动解释器」约束。

判定规则：

- `.venv` 不存在 → 全部 `missing`（环境干净，不是探测失败）；
- 查询失败（解释器跑不起来、输出不可解析）→ 全部 `unknown`，并 `console.warn` 记录原因；
- 包名按 PEP 503 规范化（大小写与 `-_.` 不敏感）后查表；查不到 → `missing`；
- 查到版本且有 `installSpec` → 按约束比较判定 `ok` / `outdated`；无 `installSpec` → `ok`。

### 2.2 Node 依赖

检查 `<skill 目录>/node_modules/<name>/package.json`，读取 `version` 字段。纯文件系统检查，不起子进程。`node_modules` 不存在 → 全部 `missing`。

附带修正：上游 `normalizePackageSpec` 只切分 PEP 440 操作符，`npm install lodash@^4.17.0` 会把整串当包名。探测侧用 `stripNodeVersionRange()` 剥离尾部版本区间再拼路径（作用域包 `@scope/pkg` 的首字符 `@` 保留）。

### 2.3 版本约束比较

`version-spec.ts` 覆盖 PEP 440 的 `==`/`!=`/`>=`/`<=`/`>`/`<`/`~=` 与 npm 的 `^`/`~`，支持逗号分隔多子句、`==1.4.*` 通配、npm caret 的 0.x 特殊规则。**解析不出来的约束一律按「无约束」处理**——宁可漏报 outdated，也不要把能用的环境误判成过期。预发布后缀（`1.0.0-rc.1`）不参与排序，直接截断。

### 2.4 解释器探测

`probeInterpreter()` 跑 `--version`（python3 老版本把版本号写到 stderr，两路都取），解析出版本号；`envReady` 记录 `.venv` / `node_modules` 是否已就绪。

**对原设计的调整**：`preflight()` 不再先调用会抛错的 `ensureToolchain()`，而是先 `probeRuntime()`；解释器缺失时返回一个降级 plan（`installer: "manual"`、依赖全 `unknown`），让「Python 环境 · 未安装」作为列表首行**可见**，而不是整个请求 500 只剩一句错误文案。`provision` 路径仍然照旧抛错——没有解释器就是装不了。

所有子进程调用统一通过 `@clawbot/exec` 的 `run()`（经 `fs-utils.ts` 的 `execPromise()` 包装），`pnpm check:fence` 已验证未绕过统一出口。

`GET /api/skills/:name/preflight` 保持单次阻塞 JSON 响应——现在探测总共只有 2 次子进程调用（解释器 + 包快照），不需要改造成 SSE。

---

## 3. 安装流程改动

### 3.1 安装粒度：保持单一批量按钮

不引入「单个依赖单独安装/重试」。`SkillDetailModal.tsx` 现有的「安装」按钮逻辑（`primaryInstallAction`）保留一次性安装所有缺失项的语义。当 `dependencies` 与 `runtimeCheck` 全部为 `ok` 时：

- 按钮禁用，文案从「安装」改为「环境已就绪」；
- 「重新检测」按钮保持可用，供用户手动刷新状态。

### 3.2 重装补齐 SSE（关键改动）

`RuntimeProvisioner` 新增 `reprovisionStream()`（复用已有的 `reprovisionWithAdapter` 生成器）。服务端把首装/重装的路由处理器抽成一个 `streamProvisionRoute(mode)` 工厂，两条路由共用同一份 SSE 逻辑，只在选择哪条流时分叉：

```ts
app.get("/api/skills/:name/provision/logs", streamProvisionRoute("provision"));
app.get("/api/skills/:name/reprovision/logs", streamProvisionRoute("reprovision"));
```

SSE 事件协议保持不变：

```
event: log   data: { level, message, timestamp }
event: done  data: { status: "ready" }
event: error data: { error: string }
```

前端 `streamProvisionLogs(name, mode, handlers)` 增加 `mode` 参数拼接端点；`useSkillsPage` 把 `handleProvision`/`handleReprovision` 合并成同一个 `runProvision(skill, mode)`。安装成功后额外触发一次 `handlePreflight()`——环境已变，列表状态要跟上。

原有阻塞式 `POST /api/skills/:name/reprovision` **不删除**（避免破坏其他潜在调用方），仅弹窗 UI 不再使用它。

---

## 4. 前端 UI 改动（`SkillDetailModal.tsx` 「环境配置」Tab）

新增两个组件：`EnvironmentChecklist.tsx`（状态列表）与 `ProvisionConsole.tsx`（日志控制台）。

### 4.1 状态列表（替换原 `环境数据` JSON 调试块）

`buildEnvironmentSnapshot()` 及对应的 `<pre>` 块已删除。改为结构化列表，行与行之间用 `border-t border-line` 分隔，不套嵌套盒子：

- 第一行：`runtimeCheck` —— 「Python 3.11.5」+ 副行「虚拟环境 .venv 已就绪 / 待创建」；
- 之后每行一个依赖：包名（等宽）+ 状态（色点 + 短词）；
  - `ok` 且有版本 → 副行显示版本号；
  - `outdated` → 副行「已装 1.18.0 · 需要 numpy>=1.20」；
  - `unknown` → 副行「未能读取环境信息」；
  - `missing` → 无副行。
- 状态配色全部取自 `@theme` 令牌：ok = `account-success`、outdated = `account-warning`、missing = `danger`、unknown = `account-muted-faint`。
- 依赖的 `source` / `confidence` **不展示**——它们不改变用户接下来的操作。

### 4.2 安装命令预览

列表下方以 `border-t` 分隔的小节：`安装命令 · uv-pip` + 等宽命令行。命令是数据不是文案，如实列出全部（建 venv / 装依赖 / 校验入口）。

### 4.3 安装日志（SSE 展示）升级

`ProvisionConsole` 取代原「`<pre>` 静态拼接」：

- 按 `log.level`（info/warn/error）着色，每行带 `HH:MM:SS` 时间戳；
- `useEffect` 监听日志条数，新日志到达时自动滚到底部；
- 顶部状态标签：安装中（带脉冲点）/ 已完成 / 失败，失败由「最后一条日志是 error」判定（供给流抛错前必定先发一条 error 日志）；
- `role="log"` + `aria-live="polite"`，屏幕阅读器可跟读。

**对原设计的一处澄清**：控制台沿用项目的浅色毛玻璃语言（`bg-white/78` + `border-line` + `font-mono`），不引入深色终端配色——深色块会与整站设计系统冲突。「终端风格」体现在等宽、逐行、时间戳、自动滚动上。

- **不解析**日志文本重建「第几个依赖正在装」的结构化进度——pip/npm/pnpm/yarn 输出格式不统一，文本启发式匹配脆弱，明确排除。

### 4.4 文档 Tab

不改动。

---

## 5. 明确不做的事（Non-goals）

- ❌ 按依赖单独安装/重试（保持批量安装）
- ❌ 用 `import X` / `require(X)` 方式探测依赖满足状态
- ❌ 从安装日志文本解析出per-依赖结构化进度条
- ❌ 改动文档（Markdown）Tab 的任何展示逻辑
- ❌ 删除现有阻塞式 `/reprovision` 接口

---

## 6. 涉及文件清单（供实施定位）

| 文件 | 改动 |
|---|---|
| `packages/shared/src/types.ts` | 新增 `SkillDependencyStatus`/`SkillDependencyCheck`/`SkillRuntimeCheck`，`SkillProvisionPlan` 引用之 |
| `packages/agent/src/skills/version-spec.ts` | **新增**：版本约束解析与比较（纯函数） |
| `packages/agent/src/skills/environment-probe.ts` | **新增**：解释器与已安装包探测 |
| `packages/agent/src/skills/types.ts` | 新增 `DependencyStatus`/`SkillDependencyCheck`/`SkillRuntimeCheck` |
| `packages/agent/src/skills/runtime-provisioner.ts` | adapter 新增 `probeRuntime`/`probeDependencies`；`preflight()` 接入探测与降级分支；新增 `reprovisionStream()` |
| `packages/agent/src/index.ts` | 导出新增类型 |
| `packages/server/src/api/routes/skills.ts` | 抽出 `streamProvisionRoute(mode)`，新增 `GET /api/skills/:name/reprovision/logs` |
| `packages/web/src/api/skills.ts` | `streamProvisionLogs` 增加 `mode` 参数 |
| `packages/web/src/hooks/useSkills.ts` | `streamProvision` 透传 `mode` |
| `packages/web/src/features/Skills/useSkillsPage.ts` | 首装/重装合并为 `runProvision(skill, mode)`，均走 SSE |
| `packages/web/src/features/Skills/EnvironmentChecklist.tsx` | **新增**：环境状态列表 + 命令预览 |
| `packages/web/src/features/Skills/ProvisionConsole.tsx` | **新增**：实时日志控制台 |
| `packages/web/src/features/Skills/SkillDetailModal.tsx` | 「环境配置」Tab 接入新组件；安装按钮在环境就绪时禁用并改文案 |
| `packages/web/src/features/Skills/types.ts` | 移除 `buildEnvironmentSnapshot`，新增状态/标签格式化与 `isEnvironmentReady` |
| `packages/agent/test/skills/version-spec.test.ts` | **新增**：8 个用例 |
| `packages/agent/test/skills/environment-probe.test.ts` | **新增**：9 个用例 |

---

## 7. 验收结果

| 检查项 | 结果 |
|---|---|
| `pnpm -F @clawbot/{shared,agent,server,web} exec tsc --noEmit` | 全部通过 |
| `pnpm test:agent` | 128 passed / 0 failed（含新增 17 个用例） |
| `pnpm test:server` | 80 passed / 0 failed |
| `pnpm check:fence` | 通过（未绕过 `@clawbot/exec`） |
| 真实 venv 实测 | `packaging 24.0` 对 `>=23.0` → ok、对 `>=99.0` → outdated；未装的 `numpy` → missing；`yaml` → 正确解析到 PyYAML 6.0.3 → ok |

未做端到端 UI 验证（未启动 dev server 实际点击安装按钮观察 SSE 渲染）。
