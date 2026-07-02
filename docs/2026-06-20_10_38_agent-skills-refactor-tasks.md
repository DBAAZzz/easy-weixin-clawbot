# @clawbot/agent `skills/` 子系统重构清单（可直接实现）

> 日期：2026-06-20
> 范围：针对代码层 CR 发现的 **`skills/` 子系统结构性坏味道**——Python/Node 全量复制、四路 kind 判别式散落、重复工具函数、god function。
> 每个任务独立成 PR、可单独发布；建议按顺序做（任务 1、2 互相咬合，先做收益最大）。

## 背景：一句话定位

agent 包的编排核心（runner/chat）已在上一轮收拾过。**剩下的债集中在 `skills/`**：它缺一层 runtime 抽象，导致 Python 和 Node「两套几乎一样的代码」被复制到多个文件，并衍生出一个到处出现的四联 kind 判别式。本清单的主线就是补上这层抽象，把复制收敛掉。

硬指标（grep 实测，作为验收基线）：

- 四路 kind 判别式 / `isPython` 变体：**7 处**，散落 5 个文件。
- `fileExists` 重复定义：**4 份**（语义还不一致）。
- `execFile` promise 化：**3 处**。
- `runtime-provisioner.ts`：**614 行**，python/node 逐函数对称复制。

---

## 任务 1：抽 `skills/types.ts` 的 runtime-kind 类型守卫（先做，低风险）

**为什么先做**：它是任务 2 的地基，且独立可发，零行为变更。

**现状**：下面这坨判别式（及变体）出现 7 次，散落 `runtime-tools.ts` / `installer.ts` / `runtime-detector.ts` / `runtime-provisioner.ts`：

```ts
kind !== "python-script" && kind !== "python-script-set" &&
kind !== "node-script"   && kind !== "node-script-set"
```

**改动**：在 `skills/types.ts` 末尾新增（`DetectedSkillKind` 已定义在此文件）：

```ts
export type ProvisionableKind =
  | "python-script" | "python-script-set"
  | "node-script"   | "node-script-set";

const PROVISIONABLE_KINDS: ReadonlySet<DetectedSkillKind> = new Set([
  "python-script", "python-script-set", "node-script", "node-script-set",
]);

export function isProvisionableKind(kind?: DetectedSkillKind): kind is ProvisionableKind {
  return kind !== undefined && PROVISIONABLE_KINDS.has(kind);
}

export function runtimeOfKind(kind: ProvisionableKind): SkillRuntime {
  return kind.startsWith("python") ? "python" : "node";
}

export function isPythonKind(kind?: DetectedSkillKind): boolean {
  return kind === "python-script" || kind === "python-script-set";
}
```

然后把 7 处手写判别式逐一替换为 `isProvisionableKind(kind)` / `isPythonKind(kind)`。涉及文件：

- `runtime-tools.ts:199`（`ensureReadyRuntime`）、`:296`（`run_skill_script`）、`:331`（`isPython` 赋值）
- `runtime-provisioner.ts:480`、`:520-526`、`:550-555`、`:573`、`:593` 等
- `installer.ts`、`runtime-detector.ts` 中的同款判别

**验收**
- 全包 `grep -c 'node-script" && '` 之类的手写四联判别归零（除 types.ts 内部实现）。
- `pnpm -F @clawbot/agent test` + `tsc --noEmit` 通过（已有 skills 测试兜底：`compiler.test.ts` / `runtime-detector.test.ts` / `runtime-tools.test.ts`）。

---

## 任务 2：`runtime-provisioner.ts` 抽 `RuntimeAdapter` 策略（核心、收益最高）

**现状**：python/node 逐函数对称复制——

| Python 版 | Node 版 | 实际差异 |
|-----------|---------|---------|
| `provisionPython` / `provisionNode` | | venv 创建、installer 选择 |
| `reprovisionPython` / `reprovisionNode` | | 清理目录（`.venv` vs `node_modules`）|
| `validatePythonEntrypoint` / `validateNodeEntrypoint` | | **逐字一样**，仅错误文案 |
| `verifyPythonEntrypoint` / `verifyNodeEntrypoint` | | `py_compile` vs `node --check` |
| `requirePythonSkill` / `requireNodeSkill` | | **逐字一样**，仅 kind 字面量 |
| `ensurePythonAvailable` / `ensureNodeAvailable` | | 仅二进制名 |

且 4 个公开方法（`preflight` / `provision` / `provisionStream` / `reprovision`）各自重抄一遍 `python? : node? : throw` 三元派发（`:515` `:521` `:538` `:550`）。

**改动**：定义策略接口，python/node 各一个实现，主流程只写一遍。

```ts
interface RuntimeAdapter {
  readonly runtime: SkillRuntime;
  /** 工具链是否可用，不可用则 throw（python3 --version / node --version）。 */
  ensureToolchain(skillName: string): Promise<void>;
  /** 入口存在性校验（script-set 无入口时直接返回）。 */
  validateEntrypoint(skill: InstalledSkill, skillDir: string): Promise<void>;
  /** 入口可编译校验（py_compile / node --check）。 */
  verifyEntrypoint(skill: InstalledSkill, skillDir: string): Promise<void>;
  /** 构建安装计划：installer 名 + 预览命令 + 实际安装闭包。 */
  buildInstall(skill: InstalledSkill): Promise<{
    installer: SkillProvisionInstaller;
    commands: string[];
    runInstall(skillDir: string, deps: string[]): Promise<void>;
  }>;
  /** reprovision 时清理的产物目录（.venv / node_modules）。 */
  cleanArtifacts(skillDir: string): Promise<void>;
  /** healthCheck 的 runtime 特定部分。 */
  healthCheck(skill: InstalledSkill, skillDir: string): Promise<boolean>;
}

function selectAdapter(kind: DetectedSkillKind): RuntimeAdapter {
  if (isPythonKind(kind)) return pythonAdapter;
  if (kind === "node-script" || kind === "node-script-set") return nodeAdapter;
  throw new Error(`No runtime adapter for kind: ${kind}`);
}
```

主流程统一成一份（伪代码）：

```ts
async function* provision(skill: InstalledSkill): AsyncGenerator<ProvisionLog> {
  const kind = skill.skill.detectedRuntime?.kind;
  if (!isProvisionableKind(kind)) throw new Error(...);
  const adapter = selectAdapter(kind);
  const skillDir = getSkillDir(skill);
  try {
    await adapter.ensureToolchain(skill.skill.source.name);
    await adapter.validateEntrypoint(skill, skillDir);
    const plan = await adapter.buildInstall(skill);
    // ... 统一的 emit / runInstall / verifyEntrypoint / writeManagedMeta(ready)
  } catch (e) {
    // ... 统一的 writeManagedMeta(failed) + emit(error) + rethrow
  }
}
```

`preflight` / `provision` / `provisionStream` / `reprovision` 都改成「选 adapter → 跑统一流程」，四元派发消失。`buildInstallCommands`（python）和 `buildNodeInstallCommands`（node）的差异内容搬进各自 adapter 的 `buildInstall`。

**注意**：
- 这是**行为保持**重构——installer 选择逻辑（uv-pip 回退 pip、pnpm/yarn 回退 npm）、各 timeout、managed_meta 写入时机全部保持原样，只换组织方式。
- `.managed_meta.json` 的 schema 不变（`schemaVersion: 1`）。

**验收**
- `runtime-provisioner.ts` 行数显著下降（预期 614 → ~350）。
- 不再有 `provisionPython`/`provisionNode` 这类成对函数；新增 runtime 只需加一个 adapter、不动主流程。
- 现有 provisioner 相关测试通过；若覆盖不足，补一个「python adapter buildInstall 在 uv 不可用时回退 pip」的纯函数级用例。

---

## 任务 3：收敛重复工具函数 `fileExists` / `execPromise`

**现状**：
- `fileExists` 定义 **4 份**：`package-scanner.ts:9`、`installer.ts:40`、`runtime-tools.ts:142`、`runtime-provisioner.ts:46`。**语义不一致**——runtime-tools 版是 `stat().isFile()`（只认文件），其余三版 `stat` 成功即 true（目录也算）。
- `execFile` promise 化抄 **3 处**：`cli.ts:63`、`runtime-tools.ts:345`、`runtime-provisioner.ts:61`，各带不同 maxBuffer/timeout。

**改动**：新增 `skills/fs-utils.ts`：

```ts
/** 路径存在且为文件。 */
export async function isFile(path: string): Promise<boolean> { /* stat().isFile() */ }
/** 路径存在（文件或目录）。 */
export async function pathExists(path: string): Promise<boolean> { /* stat() 成功即 true */ }
/** execFile 的 Promise 封装（统一 maxBuffer / 错误信息）。 */
export function execPromise(bin: string, args: string[], opts: {...}): Promise<{stdout; stderr}>;
```

逐个替换 4 处 `fileExists`——**关键：先判断每个调用点要的是"文件"还是"存在"**，分别用 `isFile` / `pathExists`，别盲目合并成一个语义。`execPromise` 合并时保留各调用点原有的 timeout 值（它们是有意不同的）。

`cli.ts` 的 execFile 有额外的 shell 元字符拒绝逻辑，**不要并入** `execPromise`——那是 cli 工具特有的安全策略，保持独立。

**验收**
- `grep -rn 'function fileExists' src` 归零。
- 各调用点语义不变（尤其 runtime-tools 仍要求"是文件"）。
- 测试通过。

---

## 任务 4：拆 `run_skill_script` 的 ~90 行 execute（god function）

**现状**：`runtime-tools.ts:288-378` 一个 handler 串了：参数校验 → script-set 特判 → healthCheck → 路径白名单校验 → timeout 计算 → python/node executable 分支 → shim 创建 → child_process 启动 → abort 监听 → 输出截断 → shim 清理。

**改动**：拆成可独立测试的小函数：

```ts
function validateRunRequest(args, installed): { requestedScript; timeoutMs; scriptArgs };
function resolveExecutable(detected, rootDir): { executable; needsShim };  // 可复用任务2的 adapter
async function runChildProcess(executable, commandArgs, opts, signal): Promise<string>;
```

executable 选择（python `.venv/bin/python` vs node `process.execPath`）若任务 2 已落地，直接交给 `RuntimeAdapter`，消掉这里第 8 处 `isPython`。

**验收**
- execute handler 主体缩到 ~25 行装配。
- `runtime-tools.test.ts` 能对 `validateRunRequest` 做纯函数单测（路径逃逸、script-set 必填 script_path、timeout 钳制）。
- 行为不变：abort、shim 清理、输出截断与原先一致。

---

## 任务 5（P3，可选）：`ports/` set/get 样板工厂化

**现状**：9 个 port 模块各重复 `let store=null; setX; getX(){ if(!store) throw "... not initialized" }` 同款 10 行样板。

**改动**：新增 `ports/slot.ts`：

```ts
export function createPortSlot<T>(name: string): {
  set(impl: T): void;
  get(): T;
} {
  let impl: T | null = null;
  return {
    set(next) { impl = next; },
    get() {
      if (!impl) throw new Error(`${name} not initialized — call set${name}() at startup`);
      return impl;
    },
  };
}
```

每个 port 文件只留**类型定义** + 一行 `export const { set: setMessageStore, get: getMessageStore } = createPortSlot<MessageStore>("MessageStore");`。

**判断**：收益低、纯整理，**不必单独立项**；顺手做就做，赶进度可跳过。

---

## 不在本清单（与 skills 无关或已决策）

- runner/chat 编排：上一轮 `2026-06-20_10_27_agent-pragmatic-refactor-tasks.md` 已处理。
- 模块级单例 / AgentContext / reset 基建：已否决（见 `agent-module-state-refactor-plan.md`）。
- scheduler/heartbeat 裸 `console` → logger：真实但属另一个子系统，单独立项，别夹带进 skills 重构。

## 建议顺序与性价比

| 顺序 | 任务 | 性价比 | 风险 |
|------|------|--------|------|
| 1 | 类型守卫收敛四路判别 | 高 | 低 |
| 2 | `RuntimeAdapter` 策略（核心） | **最高** | 中（有测试兜底） |
| 3 | 收敛 `fileExists`/`execPromise` | 中 | 低（注意语义） |
| 4 | 拆 `run_skill_script` god fn | 中 | 中 |
| 5 | ports 样板工厂化 | 低 | 低 |

任务 1+2 是主菜，做完 `skills/` 能瘦一大圈、扩展新 runtime 不再改散落各处的判别式。3/4 是顺势清理，5 可有可无。
