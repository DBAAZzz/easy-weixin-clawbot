# 标准 Skill 兼容与精简运行时检测设计

> 状态：Implemented
>  
> 本文档用于替代“把外部 Skill 强行改写成内部 companion tool 配置”的方向，并收敛出一套面向标准 Skill 包的正确实现。  
>  
> 本设计在“可执行 Skill”方向上，**覆盖并取代** [docs/skill-heuristic-adaptation-runtime-design.md](/Users/mac/Documents/DBAA/easy-weixin-clawbot/docs/skill-heuristic-adaptation-runtime-design.md) 中过宽的运行时探测方案，以及 [docs/markdown-skill-system.md](/Users/mac/Documents/DBAA/easy-weixin-clawbot/docs/markdown-skill-system.md) 中“外部 Skill 需要声明 `handler/inputSchema/runtime` 才能运行”的隐含方向。

## 1. 背景

当前仓库曾经把 Skill 混成两套语义：

1. **标准外部 Skill**
   - 核心是 `SKILL.md`
   - 可能附带 `scripts/`、`references/`、`_meta.json`
   - 目标是给 Agent 一套可复用的方法、脚本和参考资料

2. **私有内部扩展字段**
   - 在 frontmatter 中声明 `handler`、`inputSchema`、`runtime`
   - 曾尝试把 Skill 编译成 `companionTool`

这个方向已经被确认是错误实现：它会把“外部标准 Skill”硬拧成内部 DSL，导致系统只能完整支持自定义格式，无法兼容网上可下载的标准 Skill 包。

以 `akshare-a-stock` 为例，它的真实目录结构更像：

```text
akshare-a-stock/
├── SKILL.md
├── _meta.json
├── references/
│   └── api-reference.md
└── scripts/
    └── stock_cli.py
```

这是一个典型的“**Skill 包**”，不是一个“要求作者额外提供内部 DSL 的 Tool 声明文件”。

## 2. 结论

系统应当做如下扭转：

1. **外部 Skill 的主模型必须回归为“目录包”而不是“自定义 companion tool”**
2. **运行时检测必须围绕 `SKILL.md + scripts/` 做精简确定性检测**
3. **`_meta.json` 仅作为发布展示元数据，不参与 runtime 识别**
4. **依赖识别优先从 `SKILL.md` 的安装代码块和入口脚本 import 中提取**
5. **执行模型应转向“通用 Skill 运行能力”，而不是默认把外部 Skill 自动编译成专用 tool**

## 3. 设计原则

### 3.1 外部格式优先

系统必须兼容网上已有的标准 Skill 包，不能要求 Skill 作者迁就当前仓库的私有字段设计。

### 3.2 确定性优先

运行时识别、入口推断、依赖提取应优先使用固定规则完成。  
AI 可以作为兜底建议器，但**不是主协议**。

### 3.3 Skill 包，不是项目仓库

探测对象是一个 Skill 目录，而不是一个通用 Python/Node 项目。  
因此不应把 `requirements.txt`、`package.json`、lockfile 作为第一版主路径。

### 3.4 外部 Skill 不强制 Tool 化

标准 Skill 的职责是“描述如何完成任务，并附带脚本/文档资源”。  
系统应提供受控的通用执行能力，而不是强制把每个 Skill 重新翻译成一套内部 Tool Schema。

### 3.5 私有 Skill DSL 废弃

基于 `handler/inputSchema/runtime` 的 Skill 私有扩展字段已经废弃。  
当前实现会忽略这些字段，Skill 不再生成 `companionTool`，统一回归为“标准 Skill 包 + 通用运行能力”模型。

## 4. 当前实现中需要纠正的点

### 4.1 错误方向一：把外部 Skill 等同于内部 companion tool

此前的错误实现是：

- 用 `handler + inputSchema` 去定义“什么叫可执行 Skill”
- 让 [packages/server/src/api/routes/skills.ts](/Users/mac/Documents/DBAA/easy-weixin-clawbot/packages/server/src/api/routes/skills.ts) 中的 `buildLocalRunCheck()` 先看 `installed.skill.companionTool`

这个判断门槛已经移除。当前实现改为基于 `packageIndex + detectedRuntime` 做统一识别。

### 4.2 错误方向二：运行时检测铺得过宽

把 `requirements.txt`、`pyproject.toml`、`package.json`、lockfile 等当成主检测入口，属于“项目仓库识别”思路。  
对于标准 Skill 包，这个范围过大，也容易引入误判。

### 4.3 错误方向三：把 `_meta.json` 当成 runtime 信息来源

像 `akshare-a-stock` 这类 Skill 的 `_meta.json` 往往只有：

- owner
- slug
- displayName
- latest version / commit

它是发布元数据，不是运行时 manifest。  
因此 `_meta.json` 不应参与 runtime 决策。

## 5. 正确目标模型

### 5.1 Skill 包模型

标准外部 Skill 统一被视为：

```text
Skill Package
├── SKILL.md               # 主说明
├── _meta.json             # 发布元数据（可选）
├── references/            # 参考文档（可选）
└── scripts/               # 可执行脚本（可选）
```

其中：

- `SKILL.md` 必须存在
- `_meta.json` 可选，仅用于展示
- `references/` 可选，仅作为知识资源
- `scripts/` 可选，若存在则可能构成“可执行 Skill”

### 5.2 内部生成的运行时描述

系统不要求外部 Skill 自带内部 `runtime` 声明。  
安装时由系统扫描包内容，生成一个内部 `DetectedSkillRuntime`。

这份内部 manifest 才是后续：

- preflight
- provision
- health check
- 通用脚本执行

的统一依据。

## 6. 精简后的确定性检测规则

### 6.1 包扫描规则

扫描对象仅限 Skill 目录中的以下内容：

- `SKILL.md`
- `_meta.json`
- `references/**`
- `scripts/**`

第一版**不把**以下文件纳入主检测流程：

- `requirements.txt`
- `pyproject.toml`
- `Pipfile`
- `package.json`
- `pnpm-lock.yaml`
- `package-lock.json`
- `yarn.lock`

这些文件未来如需支持，只能作为低优先级兼容项，而不是主路径。

### 6.2 Runtime 检测规则

只围绕 `scripts/` 做判断：

1. `scripts/` 不存在或没有脚本
   - `kind = "knowledge-only"`

2. `scripts/` 下只有一个 `.py` 文件
   - `kind = "python-script"`
   - 该文件即入口

3. `scripts/` 下只有一个 `.js` / `.mjs` / `.cjs` 文件
   - `kind = "node-script"`
   - 该文件即入口

4. `scripts/` 下有多个脚本
   - 按命名约定选入口
   - Python 优先级：
     - `*_cli.py`
     - `main.py`
     - `cli.py`
     - `run.py`
   - Node 优先级：
     - `*_cli.js`
     - `main.js`
     - `cli.js`
     - `run.js`

5. 多脚本且无法唯一确定入口
   - `kind = "manual-needed"`

### 6.3 依赖检测规则

依赖检测只做两步：

1. **解析 `SKILL.md` 中的安装代码块**
2. **扫描已选中的入口脚本 import**

第一版支持的安装命令提取：

- `uv pip install ...`
- `pip install ...`
- `python -m pip install ...`
- `python3 -m pip install ...`
- `npm install ...`
- `pnpm add ...`
- `yarn add ...`

### 6.4 依赖置信度规则

1. 安装代码块命中 + 脚本 import 命中
   - `confidence = "high"`

2. 只有安装代码块命中
   - `confidence = "medium"`

3. 只有脚本 import 命中
   - `confidence = "medium"`

4. 都没有命中
   - `manual-needed`

## 7. `akshare-a-stock` 的识别结果

对于如下目录：

```text
akshare-a-stock/
├── SKILL.md
├── _meta.json
├── references/
│   └── api-reference.md
└── scripts/
    └── stock_cli.py
```

系统应当得到如下结论：

1. `scripts/stock_cli.py` 存在，且是唯一 Python 脚本
   - `kind = "python-script"`
   - `entrypoint = "scripts/stock_cli.py"`

2. `SKILL.md` 中存在：

```bash
uv pip install akshare
```

则依赖识别得到：

- `dependency = akshare`
- `installer = uv-pip`

3. 若入口脚本内还存在：

```python
import akshare as ak
```

则依赖置信度提升为 `high`。

预期内部结果：

```json
{
  "kind": "python-script",
  "entrypoint": {
    "path": "scripts/stock_cli.py",
    "runtime": "python",
    "source": "single-script"
  },
  "dependencies": [
    {
      "name": "akshare",
      "source": "markdown-install",
      "confidence": "high"
    }
  ],
  "issues": [],
  "evidence": [
    "scripts/stock_cli.py",
    "SKILL.md:bash:uv pip install akshare"
  ]
}
```

## 8. 数据结构

### 8.1 Skill 包索引

```ts
export interface SkillPackageIndex {
  rootDir: string;
  skillMdPath: string;
  metaJsonPath?: string;
  referenceFiles: string[];
  scriptFiles: string[];
}
```

### 8.2 脚本描述

```ts
export type SkillRuntime = "python" | "node";

export interface ScriptDescriptor {
  path: string;
  runtime: SkillRuntime;
  imports: string[];
  hasCliMain: boolean;
}
```

### 8.3 入口描述

```ts
export interface SkillEntrypoint {
  path: string;
  runtime: SkillRuntime;
  source: "single-script" | "naming-convention" | "manual";
}
```

### 8.4 依赖描述

```ts
export interface SkillDependency {
  name: string;
  source: "markdown-install" | "import-scan";
  confidence: "high" | "medium" | "low";
}
```

### 8.5 运行时检测结果

```ts
export type DetectedSkillKind =
  | "knowledge-only"
  | "python-script"
  | "node-script"
  | "manual-needed";

export interface DetectedSkillRuntime {
  kind: DetectedSkillKind;
  entrypoint?: SkillEntrypoint;
  dependencies: SkillDependency[];
  issues: string[];
  evidence: string[];
}
```

### 8.6 Provision 计划

```ts
export interface ProvisionPlan {
  runtime: "python" | "node";
  installer: "uv-pip" | "pip" | "npm" | "pnpm" | "yarn" | "manual";
  createEnv: boolean;
  commandPreview: string[];
  dependencies: SkillDependency[];
}
```

### 8.7 安装态扩展

当前实现中，`packageIndex + detectedRuntime` 挂在 `CompiledSkill` 上，`InstalledSkill` 继续承载来源、启停和 provision 状态：

```ts
export interface CompiledSkill {
  source: SkillSource;
  packageIndex?: SkillPackageIndex;
  detectedRuntime?: DetectedSkillRuntime;
}

export interface InstalledSkill {
  skill: CompiledSkill;
  origin: "builtin" | "user";
  enabled: boolean;
  installedAt: string;
  provisionStatus?: ProvisionStatus;
  provisionError?: string;
}
```

## 9. 正确执行模型

### 9.1 `use_skill` 继续保留

`use_skill` 仍然负责把 `SKILL.md` 的正文注入上下文。  
这一点不变。

### 9.2 新增通用 Skill 运行能力

对于标准外部 Skill，不再默认自动生成专用 `companionTool`。  
应改为增加通用能力：

1. `read_skill_file`
2. `prepare_skill_runtime`
3. `run_skill_script`

示例：

```ts
run_skill_script({
  skill_name: "akshare-a-stock",
  script: "scripts/stock_cli.py",
  argv: ["quote", "--symbol", "600519"]
})
```

这样：

- 标准 Skill 仍保持原格式
- Agent 可以在读完 `SKILL.md` 后调用通用脚本执行能力
- 系统只负责“受控执行”，不负责为每个外部 Skill 自动发明私有 tool schema

### 9.3 companion tool 机制废弃

`companionTool` 已不再是 Skill 系统的一部分。  
即使是内部自定义 Skill，也不再保留这条路径。Skill 的运行统一依赖：

1. `read_skill_file`
2. `prepare_skill_runtime`
3. `run_skill_script`

## 10. Provision 与健康检查

### 10.1 Python Skill 的 Provision

第一版做 Python 与 Node：

1. 创建 `.venv`
2. 安装检测出的依赖
3. 做最小健康验证

推荐预览：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install akshare
.venv/bin/python -m py_compile scripts/stock_cli.py
```

如果脚本支持 `--help`，可替换最后一步为：

```bash
.venv/bin/python scripts/stock_cli.py --help
```

### 10.2 健康检查

当前 [packages/agent/src/skills/runtime-provisioner.ts](/Users/mac/Documents/DBAA/easy-weixin-clawbot/packages/agent/src/skills/runtime-provisioner.ts) 的健康检查只验证 `.venv/bin/python --version`，这不够。

正确的检查应当是：

1. `.venv/bin/python` 存在
2. 入口脚本存在
3. 入口脚本能通过 `py_compile` 或 `--help`

## 11. 需要废弃的实现

以下实现需要明确废弃。

### 11.1 废弃：把外部 Skill 的可执行性绑定到 `companionTool`

废弃原因：

- 外部标准 Skill 普遍不会声明 `handler/inputSchema`
- 这会把大量真实可执行 Skill 误判为“knowledge-only”

影响点：

- [packages/server/src/api/routes/skills.ts](/Users/mac/Documents/DBAA/easy-weixin-clawbot/packages/server/src/api/routes/skills.ts) 中 `buildLocalRunCheck()` 不能再以 `installed.skill.companionTool` 作为首个判断门槛

### 11.2 废弃：把 `handler/inputSchema/runtime` 作为 Skill 的推荐格式

废弃原因：

- 这是当前仓库的私有内部扩展
- 不兼容网上 Skill 生态

当前处理：

- 编译器忽略这些私有字段
- Skill 安装、校验、运行时检测不再依赖这些字段
- 文档与 API 心智模型统一回到标准 Skill 包

### 11.3 废弃：以 `requirements.txt/package.json/lockfile` 为第一版主检测路径

废弃原因：

- 标准 Skill 包的核心形态不是普通项目仓库
- 主路径应围绕 `SKILL.md + scripts/`

### 11.4 废弃：把 `_meta.json` 作为 runtime 检测来源

废弃原因：

- 它只是发布元数据
- 不具备环境与执行协议信息

## 12. 代码改造方案

### 12.1 新增文件

建议新增：

```text
packages/agent/src/skills/
├── package-scanner.ts
├── runtime-detector.ts
└── script-analyzer.ts
```

职责：

- `package-scanner.ts`
  - 扫描 skill 目录
  - 产出 `SkillPackageIndex`

- `runtime-detector.ts`
  - 根据 `SkillPackageIndex + SKILL.md + scripts` 生成 `DetectedSkillRuntime`

- `script-analyzer.ts`
  - 解析 Python / Node 入口脚本 import
  - 提供 `ScriptDescriptor`

### 12.2 需要修改的现有文件

#### [packages/agent/src/skills/installer.ts](/Users/mac/Documents/DBAA/easy-weixin-clawbot/packages/agent/src/skills/installer.ts)

新增职责：

- 复制目录后扫描整个 Skill 包
- 把 `packageIndex + detectedRuntime` 写入 `CompiledSkill`
- `rebuild()` 时不再只关注 `CompiledSkill`

#### [packages/agent/src/skills/types.ts](/Users/mac/Documents/DBAA/easy-weixin-clawbot/packages/agent/src/skills/types.ts)

新增：

- `SkillPackageIndex`
- `DetectedSkillRuntime`
- 扩展 `CompiledSkill` 与 `SkillCatalogItem`

#### [packages/server/src/api/routes/skills.ts](/Users/mac/Documents/DBAA/easy-weixin-clawbot/packages/server/src/api/routes/skills.ts)

改造点：

- `buildLocalRunCheck()` 不再先看 `companionTool`
- 改为：
  - 看 `detectedRuntime.kind`
  - 看 `entrypoint`
  - 看 `provisionStatus`
  - 看健康检查结果

#### [packages/agent/src/skills/runtime-provisioner.ts](/Users/mac/Documents/DBAA/easy-weixin-clawbot/packages/agent/src/skills/runtime-provisioner.ts)

改造点：

- 不再假设 runtime 一定来自 `skill.source.runtime`
- 改为接受 `detectedRuntime`
- 健康检查升级到“入口脚本级”

#### [packages/agent/src/runtime/skill-runtime.ts](/Users/mac/Documents/DBAA/easy-weixin-clawbot/packages/agent/src/runtime/skill-runtime.ts)

建议增强：

- `use_skill` 返回正文时，可附带简要文件提示
- 例如告诉模型该 Skill 附带：
  - `scripts/stock_cli.py`
  - `references/api-reference.md`

## 13. 迁移路径

### Phase 1：识别模型纠偏

目标：

- 不改执行模型
- 先把“什么是可执行 Skill”识别正确

工作：

1. 新增 `package-scanner.ts`
2. 新增 `runtime-detector.ts`
3. 在 installer 中保存 `detectedRuntime`
4. 改造 `buildLocalRunCheck()`

### Phase 2：Provision 纠偏

目标：

- preflight / provision 基于 `detectedRuntime` 运转

工作：

1. runtime-provisioner 改为读取 `detectedRuntime`
2. 升级 health check
3. 支持 `SKILL.md` 安装块解析

### Phase 3：执行模型纠偏

目标：

- 从“自动 companionTool 化”转向“通用 Skill 执行能力”

工作：

1. 新增 `run_skill_script`
2. 新增 `read_skill_file`
3. 新增 `prepare_skill_runtime`
4. 彻底移除 companion tool 路径

## 14. 非目标

第一版不做：

1. 通用项目仓库探测
2. Shell 全面支持
3. AI 自动推断作为主协议
4. 自动生成外部 Skill 的结构化 Tool Schema

## 15. 最终判断标准

改造完成后，系统应满足以下标准：

1. 对 `akshare-a-stock` 这类标准 Skill 包：
   - 能正确识别为 `python-script`
   - 能正确识别入口 `scripts/stock_cli.py`
   - 能从 `SKILL.md` 提取 `akshare`
   - 不要求 Skill 作者补写 `handler/inputSchema/runtime`

2. 对没有脚本的 Skill：
   - 仍然正常作为 `knowledge-only skill` 使用

3. 对内部自定义 Skill：
   - 不再保留 `companionTool`
   - 若要运行，也必须走标准 Skill 包 + 通用运行能力

4. 对代码与文档心智模型：
   - “标准 Skill”与“内部扩展 Skill”边界清晰
   - 不再把私有格式误写成通用 Skill 标准
