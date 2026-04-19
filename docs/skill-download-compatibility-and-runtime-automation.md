# 下载 Skill 兼容与运行时自动化修正方案

> 状态：Proposed
>
> 本文档记录 2026-04-18 围绕 `stock-manager` 与 `stock-analysis` 两个实际 Skill 包展开的讨论结论。
> 目标不是推翻现有“标准 Skill 包”方案，而是在保留标准路径的前提下，为网上下载的非标准 Skill 包补上自动兼容与自动运行能力。

## 1. 文档目的

本次讨论聚焦两个现实问题：

1. `stock-manager` 是网上下载的 Skill 包，目录结构不符合当前仓库假定的“标准 Skill 包”结构，但它本质上是可运行的 Python Skill，当前实现未能兼容。
2. `stock-analysis` 会被系统判定为“该 Skill 需要人工确认运行方式”，这种状态对实际使用没有帮助；对于这类多脚本工作流 Skill，系统应当自动完成识别与运行，而不是把问题退回给用户。

本文档的目标是整理：

- 当前实现的真实行为与约束
- 现有方案的缺陷
- 为什么这两个问题本质上是同一个兼容性问题
- 推荐的修正方向与落地方案

本文档不包含代码修改，仅作为后续实现依据。

## 2. 讨论上下文

当前仓库已经实现了一套“标准 Skill 包 + 精简运行时检测”的机制，核心假设见 [standard-skill-runtime-design.md](./standard-skill-runtime-design.md)。

现有方案的主假设是：

- Skill 目录以 `SKILL.md` 为中心
- 可执行 Skill 的脚本应放在 `scripts/`
- 参考资料应放在 `references/`
- 运行时识别优先依赖 `SKILL.md` 中的安装代码块与 `scripts/` 中的入口脚本 import

这套假设对标准 Skill 包是成立的，但对真实下载生态并不总成立(/Users/mac/Documents/workspace/DBAA/easy-clawbot-agent/data/skills/user)。讨论中暴露出的两个例子说明：

- 标准包路径需要保留
- 但“只支持标准包”不足以覆盖真实下载来源
- 需要在标准路径之外补上一层兼容逻辑

## 3. 当前实现摘要

### 3.1 加载与安装

当前 Skill 安装与重建流程由以下模块负责：

- `packages/agent/src/skills/loader.ts`
- `packages/agent/src/skills/installer.ts`
- `packages/server/src/api/routes/skills.ts`

当前行为：

- Loader 只扫描 `.../<skill-name>/SKILL.md`
- Installer 在 `rebuild()` 中加载 builtin/user Skill，再调用：
  - `scanSkillPackage()`
  - `detectSkillRuntime()`
- 结果进入 `InstalledSkill`，再写入 `SkillSnapshot`

### 3.2 包扫描

当前 `scanSkillPackage()` 的扫描对象非常窄，只看：

- `SKILL.md`
- `_meta.json`
- `references/**`
- `scripts/**`

这意味着如下文件默认不会进入主检测路径：

- 根目录下的 `main.py`
- 根目录下的 `openclaw_entry.py`
- 根目录下的 `requirements.txt`
- frontmatter 中的 `dependency.python`

### 3.3 运行时检测

当前 `detectSkillRuntime()` 的判断逻辑是：

1. 没有 `scripts/` 或 `scripts/` 下没有脚本
   - 判定为 `knowledge-only`
2. `scripts/` 下存在可识别脚本
   - 推断 `python-script` 或 `node-script`
3. 多脚本但无法选出唯一入口
   - 判定为 `manual-needed`

这套模型隐含了一个强约束：

- “可运行 Skill”必须最终收敛为“带默认入口的单入口脚本 Skill”

### 3.4 运行工具

当前运行相关能力由：

- `read_skill_file`
- `prepare_skill_runtime`
- `run_skill_script`

组成。

现状问题：

- `prepare_skill_runtime` 依赖 `detectedRuntime` 具备明确可 provision 的 runtime 形态
- `run_skill_script` 默认要求 `detected.entrypoint` 存在
- 可读文件路径仅允许：
  - `SKILL.md`
  - `_meta.json`
  - `references/**`
  - `scripts/**`

因此，即使某个下载包真实可运行，只要它的可执行脚本放在根目录，现有工具链也无法正常处理。

## 4. 两个实际问题

### 4.1 问题一：`stock-manager` 下载包未被兼容

`stock-manager` 当前目录结构的关键特征是：

- `SKILL.md`
- `_meta.json`
- `main.py`
- `openclaw_entry.py`
- `requirements.txt`
- 其他若干 Python 模块都放在根目录

它不符合当前“`scripts/` 子目录承载脚本”的标准包结构，但它显然不是纯知识型 Skill。

从运行语义上看：

- `main.py` 更像人类 CLI
- `openclaw_entry.py` 更像机器调用入口
- `requirements.txt` 明确给出了依赖

当前实现的问题是：

- 因为没有 `scripts/`，它大概率会被视为 `knowledge-only`
- 即使正文里写了大量命令，也不会自动把根目录脚本纳入可执行路径
- `read_skill_file` 与 `run_skill_script` 也无法自然访问根目录脚本

结果是：

- 用户安装了一个真实可运行的下载包
- 系统却把它降级成“只有提示词说明的 Skill”

这不符合“兼容下载 Skill 包”的目标。

### 4.2 问题二：`stock-analysis` 被判定为“人工确认运行方式”

`stock-analysis` 的特征是：

- 有 `SKILL.md`
- 有 `references/`
- 有 `scripts/fetch_stock_data.py`
- 有 `scripts/analyze_stock.py`
- frontmatter 里还带有 `dependency.python`

它的问题不是“完全无法识别”，而是它属于“多脚本工作流 Skill”，不是“单入口脚本 Skill”。

当前实现把“多脚本但无唯一入口”处理为 `manual-needed`。这个状态的问题是：

- 用户并没有得到任何自动化收益
- 前端只能展示“需要人工确认”
- 但实际上这类 Skill 往往完全可以自动 provision，并按脚本路径逐步执行

对于 `stock-analysis` 这种包，真正需要的是：

- 自动识别 Python runtime
- 自动识别依赖
- 允许“不存在默认入口”
- 允许在后续执行阶段显式指定 `script_path`

因此，“人工确认运行方式”对这类包没有实际意义。

## 5. 现有方案的缺陷

### 5.1 标准路径过窄

当前方案把“标准 Skill 包”当成了“唯一有效 Skill 包”。

问题不在于标准路径本身错误，而在于：

- 系统没有为真实下载生态提供兼容层

结果是：

- 标准包工作正常
- 非标准下载包即使质量不错，也会被误降级或误判

### 5.2 `manual-needed` 不是可用状态

当前 `manual-needed` 更像一种“系统认输”的内部状态，而不是用户可执行的产品能力。

它的问题包括：

- 没有把问题转化为可自动继续的流程
- 没有给出稳定的 fallback
- 对前端与用户都没有实际帮助

因此：

- `manual-needed` 不应该继续作为主路径上的常见结果
- 它只能保留给真正异常、损坏或混合运行时的少数包

### 5.3 运行时模型过度绑定“单默认入口”

当前系统默认认为：

- 能运行 = 能推断唯一 `entrypoint`

这个假设对多脚本工作流 Skill 不成立。

现实里存在至少两类合法 Skill：

1. 单入口 Skill
2. 多脚本工作流 Skill

现有模型只支持第一类。

### 5.4 依赖检测来源过少

当前依赖识别主要依赖：

- `SKILL.md` 中的安装代码块
- 入口脚本 import

但下载包里经常还会出现：

- `requirements.txt`
- 根目录 `package.json`
- frontmatter 里的结构化依赖字段

这些都可能提供稳定信息。全部忽略会降低自动化成功率。

### 5.5 路径访问限制与兼容目标冲突

如果系统要兼容下载 Skill 包，那么它不能只允许访问：

- `scripts/**`
- `references/**`

否则像 `stock-manager` 这种根目录脚本布局，即使识别成功，后续也难以执行。

## 6. 设计目标

新的修正方案应满足以下目标：

1. 保留现有标准 Skill 包路径，不破坏已实现能力
2. 为下载 Skill 包增加一层自动兼容逻辑
3. `manual-needed` 不再作为常见结果
4. 支持“多脚本工作流 Skill”
5. 让 `stock-manager` 与 `stock-analysis` 都能进入自动化链路
6. 不要求下载 Skill 作者修改包结构或补私有字段

## 7. 推荐方案

推荐方案是：

**标准路径保留 + 兼容扫描层兜底 + 运行时模型升级为“支持单入口与多脚本工作流”**

这不是推翻现有方案，而是对现有方案做一次必要的外延扩展。

## 8. 方案细节

### 8.1 双阶段检测

运行时检测分为两层：

#### 第一层：标准检测

继续沿用现有逻辑：

- `SKILL.md`
- `scripts/**`
- `references/**`
- `_meta.json`

如果这一层已经得到清晰结果：

- `knowledge-only`
- `python-script`
- `node-script`

则直接沿用，不进入兼容层。

#### 第二层：兼容检测

仅当标准检测结果为以下情况时触发：

- `knowledge-only`，但包内存在明显脚本工件
- `manual-needed`

兼容层额外扫描：

- 根目录常见入口脚本
- `requirements.txt`
- frontmatter 的结构化依赖字段
- Markdown 中的示例命令
- 根目录下的 Python / Node 文件

这层的目标不是“完全自由猜测”，而是为常见下载包格式补上确定性兼容。

### 8.2 兼容入口选择规则

兼容层需要支持“根目录脚本”的入口推断。

对于 Python Skill，建议优先级如下：

1. `openclaw_entry.py`
2. `*_entry.py`
3. `*_cli.py`
4. `main.py`
5. `cli.py`
6. `run.py`

原因：

- `openclaw_entry.py` 往往是为程序调用准备的结构化入口
- `main.py` 往往偏向面向人类的 CLI

对 `stock-manager` 而言，推荐默认入口应是：

- `openclaw_entry.py`

而不是：

- `main.py`

### 8.3 兼容依赖识别规则

依赖来源建议改为多源合并：

1. `SKILL.md` 中的安装代码块
2. 入口脚本 import
3. `requirements.txt`
4. frontmatter 中的依赖字段

其中：

- 标准来源仍然优先
- 兼容来源只在标准来源不足时补充

对 Python 包：

- `requirements.txt` 是高价值兼容信息，不应再被完全忽略

对 `stock-analysis`：

- frontmatter 里的 `dependency.python`
- 脚本 import

都应纳入合并结果。

### 8.4 运行时模型升级

当前模型只有：

- `knowledge-only`
- `python-script`
- `node-script`
- `manual-needed`

这个模型过于依赖“唯一入口”。

建议改为：

- `knowledge-only`
- `python-script`
- `node-script`
- `python-script-set`
- `node-script-set`
- `unsupported`

其中：

- `python-script` / `node-script`
  - 表示存在默认入口
- `python-script-set` / `node-script-set`
  - 表示 runtime 和依赖都可确定，但不要求存在唯一默认入口
- `unsupported`
  - 只保留给真正无法自动化的情况

这样可以覆盖：

- `stock-manager` -> `python-script`
- `stock-analysis` -> `python-script-set`

### 8.5 `manual-needed` 的处理原则

建议将 `manual-needed` 从主状态中移除或大幅边缘化。

它只应保留给少数情况：

- 一个包同时混用多种运行时
- 没有任何稳定脚本工件
- 包内容损坏
- 入口和依赖都无法推断

对正常下载包而言，系统应给出：

- 可自动运行
- 可自动运行，但执行时需要指定脚本
- 仅知识型 Skill

而不是：

- 需要人工确认运行方式

### 8.6 `prepare_skill_runtime` 的前置条件修正

当前隐含逻辑是：

- 能 prepare runtime，通常就得先有默认入口

这不适合多脚本工作流 Skill。

建议改为：

- `prepare_skill_runtime` 只依赖：
  - runtime 类型
  - 依赖集合
- 不强制依赖默认入口

这样：

- `stock-analysis` 即使没有默认入口，也可以先自动准备 `.venv`

### 8.7 `run_skill_script` 的语义修正

建议保留一个统一执行工具，但允许两种模式：

1. 有默认入口
   - `script_path` 可省略
2. 无默认入口，但有脚本集合
   - `script_path` 必填

这意味着：

- 单入口 Skill 使用更简单
- 多脚本 Skill 仍然可以自动执行

对 `stock-analysis` 来说，后续执行流程可以是：

1. `prepare_skill_runtime("stock-analysis")`
2. `run_skill_script("stock-analysis", "scripts/fetch_stock_data.py", ...)`
3. `run_skill_script("stock-analysis", "scripts/analyze_stock.py", ...)`

而无需任何人工确认。

### 8.8 文件读取白名单修正

为了兼容下载包，建议扩展 Skill 文件可读范围。

当前允许：

- `SKILL.md`
- `_meta.json`
- `references/**`
- `scripts/**`

建议兼容层额外允许：

- 兼容模式下被识别为脚本的根目录文件
- `requirements.txt`
- 未来必要时的少量 manifest 文件

前提是：

- 仍然保持路径不可越出 Skill 根目录
- 仍然维持受控读取范围，而不是完全开放

## 9. 两个案例的目标结果

### 9.1 `stock-manager`

目标识别结果：

- `runtimeKind = python-script`
- `entrypoint = openclaw_entry.py`
- 依赖来自：
  - `requirements.txt`
  - import 扫描
- 可自动 provision
- 可自动运行

### 9.2 `stock-analysis`

目标识别结果：

- `runtimeKind = python-script-set`
- `entrypoint = none`
- `scripts = [fetch_stock_data.py, analyze_stock.py]`
- 依赖来自：
  - frontmatter `dependency.python`
  - import 扫描
  - 若正文存在安装命令也一并纳入
- 可自动 provision
- 执行时需显式指定脚本

## 10. 对现有设计文档的修正关系

当前 [standard-skill-runtime-design.md](./standard-skill-runtime-design.md) 的价值仍然成立：

- 标准 Skill 包是正确主路径
- 不能要求外部生态迁就私有 DSL
- `_meta.json` 不应作为 runtime 主数据源

但这份设计文档有一个现实不足：

- 它把“标准路径”近似等同于“唯一路径”

本次讨论的结论是：

- 标准路径继续保留
- 但必须补充“下载包兼容层”

也就是说，本方案应被视为：

- 对标准方案的补充，而不是对其否定

## 11. 需要修改的模块范围

若后续进入实现，预计需要涉及以下模块：

- `packages/agent/src/skills/types.ts`
- `packages/agent/src/skills/package-scanner.ts`
- `packages/agent/src/skills/runtime-detector.ts`
- `packages/agent/src/skills/runtime-tools.ts`
- `packages/agent/src/skills/runtime-provisioner.ts`
- `packages/server/src/api/routes/skills.ts`

其中：

- `types.ts`
  - 扩展 runtime kind 与脚本集合建模
- `package-scanner.ts`
  - 增加兼容层可见工件扫描
- `runtime-detector.ts`
  - 增加 fallback compat 检测
- `runtime-tools.ts`
  - 放宽无默认入口时的运行规则
- `runtime-provisioner.ts`
  - 去除对默认入口的过强依赖
- `skills.ts`
  - 调整前端/API 展示文案与状态解释

## 12. 推荐实施顺序

建议按以下顺序推进：

1. 增加兼容扫描层，但只在标准检测失败时触发
2. 扩展 runtime 类型，支持 script-set
3. 调整 runtime provision 逻辑，使其不再绑定默认入口
4. 调整 `run_skill_script`，允许无默认入口但显式指定脚本
5. 修改 API 展示，去掉“人工确认运行方式”作为常见结果
6. 为 `stock-manager` 与 `stock-analysis` 增加回归测试

## 13. 最终结论

本次讨论的核心结论是：

- `stock-manager` 与 `stock-analysis` 暴露的不是两个独立 bug
- 而是当前 Skill runtime 设计对真实下载生态兼容不足

应对方式不是继续增加“人工确认”分支，而是把系统升级为：

- 标准 Skill 包优先
- 下载包自动兼容兜底
- 支持单入口 Skill
- 也支持多脚本工作流 Skill

只有这样，系统才能同时满足：

- 不破坏现有标准包能力
- 对外部下载 Skill 实现真正可用的自动化处理
