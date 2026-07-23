# 外部进程执行统一出口：`@clawbot/exec` 设计与实施方案（2026-07-23）

> **本文是 [2026-07-23 进程执行与环境隔离问题清单](./2026-07-23_20_57_process-execution-isolation-problems.md) 的对应方案文档，且是可直接执行的实施规格。**
> 阅读对象：负责实施的 AI 编程智能体。文中所有接口签名、文件路径、迁移步骤、验收命令均为**规范性内容**，除非标注「可选」，一律照做，不要自行发挥。
>
> 实施前必读：问题清单原文（了解动机）+ 本文全文（了解边界）。遇到本文与实际代码冲突（行号漂移等），以「本文描述的语义」为准，行号仅作定位参考。

---

## 0. 方案裁决总表

| 问题 | 裁决 | 对应章节 |
|---|---|---|
| P1 env 全量继承 | **修**：白名单构造 env，废除黑名单 | §3、§4 |
| P2 远程决定 spawn 命令 | **修**：解析结果落库固化，重启不再信任远程 | §6 |
| P3 MCP 无依赖隔离 | **不建机制**：配置写入时校验 + 提示，推荐自隔离 runner | §7 |
| P4 无资源上限 | **部分修**：统一超时/maxBuffer/进程组清杀；可选 RSS 看门狗；不做 cgroup | §4.5、§4.6 |
| P5 无单一出口 | **修**：新包 `@clawbot/exec` + lint/脚本封锁 `child_process` | §4、§5 |
| P6 启动即全量常驻 | **本期不做**（理由见 §1） | — |
| P7 零测试覆盖 | **修**：exec 包自带完整测试；纯函数化后可测性大幅提升 | §8 |

### 0.1 对问题清单「待决问题」的正式回答

1. **隔离目标**：防「第三方包默认就能拿到全部凭据」（被动/懒惰泄露），**不防**「同 UID 恶意代码主动翻文件系统」。后者在不引入容器的前提下无解（子进程与 server 同 UID，本来就能读 `.env` 文件），假装能防是虚假安全。想要更强隔离的管理员，出路是把 MCP server 命令配成 `docker run ...`，平台透传即可。
2. **隔离等级**：全局统一一套 env 策略（safe 白名单），server 级差异通过已有的 per-server `env` 配置表达，不引入「隔离等级」概念。
3. **依赖隔离归属**：管理员的配置责任，平台提供校验与提示（§7）。
4. **skill `.venv` 与 MCP 是否统一**：**不统一**。`npx -y`/`uvx` 本身就是自带隔离的一次性 runner，MCP 生态主流分发方式已解决依赖隔离；两套生命周期强行统一是过度设计。
5/6. **常驻内存与按需启动**：缺实测数据，且冷启动 30s 与微信消息延迟预算的矛盾未定，**本期不做**。前置条件（用 `mcp_tools.input_schema` 作工具可见性快照）留作后续独立产品线。
7. **单一出口边界**：只管「怎么起进程」（spawn/env/超时/清杀），**不管**依赖供给（provisioner 逻辑留在 agent）、不管「何时起/何时收」（调度留在 `manager.ts`）。
8. **独立成包**：是，`@clawbot/exec`，零运行时依赖，位置见 §2。不新增 Port——它比 Port 更底层，是基础设施而非领域 IO 抽象。
9. **安全线与工程线**：拆开推进，但安全线借工程线的壳落地（迁移顺序见 §9）。
10. **与 H1/H2/H3 排序**：本方案不阻塞也不依赖它们；H2（账号级工具权限）与本文正交，做 H2 时 exec 包已是现成地基。

### 0.2 明确不做的事（Non-goals）

实施者**禁止**顺手实现以下内容：

- ❌ 容器/microVM/seccomp/cgroup 沙箱
- ❌ MCP 版 `.venv` 依赖供给机制
- ❌ CPU/PID 硬限额（跨 macOS/Linux 做不到可移植）
- ❌ MCP 按需启动/空闲回收（P6）
- ❌ 多租户/多实例相关的任何抽象
- ❌ 把 provisioner 的 `RuntimeAdapter` 泛化搬进 exec 包

### 0.3 问题清单的两处事实补充

逐仓核查发现问题清单 §1 的「四处执行点」实际是**六处**，补充如下（本方案已覆盖）：

| # | 位置 | 用途 | 现状 | 处理 |
|---|---|---|---|---|
| 5 | `packages/server/src/api/routes/skills.ts:68,71,118` | skill 上传流程中执行 `python3 --version` / `node --version` / `unzip`（解压**用户上传的 zip**） | `promisify(execFile)`，全量继承 env，`unzip` **无超时** | 迁入 exec（§5.5） |
| 6 | `packages/server/src/prisma-cli.ts:8` | 开发期 prisma CLI 包装（`stdio: "inherit"`，显式注入 `DATABASE_URL`） | 全量继承 env | **豁免**：它运行在管理员自己的终端里，本来就是管理员权限上下文，纳入封锁白名单（§5.6） |

---

## 1. 威胁模型与设计原则（实施时的判断依据）

既有约束（问题清单 §3，不重复展开）：自托管、单进程、单租户、管理员即使用者；命令配置来自管理员，不来自模型；开发机 macOS，需可移植；Node ≥ 22 纯 ESM。

由此推出三条设计原则，遇到本文未覆盖的细节时按此判断：

1. **env 只能白名单构造，永远不存在「继承全部」的选项。** 需要额外变量必须显式点名（`passthrough`）或显式注入（`env`），让泄露面在代码评审时一眼可见。
2. **`node:child_process` 只允许在 exec 包内 import。** 收敛不靠自觉，靠 lint 规则和 CI 脚本封死。
3. **可移植优先于强度。** 任何依赖 Linux 特性的手段（cgroup 等）不采用；进程组信号、RSS 轮询这类 POSIX 通用手段可采用。

---

## 2. 新包 `@clawbot/exec`：位置与骨架

### 2.1 依赖图位置

```
server → agent → exec          ← 新增
server → exec                  ← 新增（skills.ts 路由用）
server → agent → observability → shared
```

- **零运行时依赖**：只用 `node:child_process`、`node:stream`、`node:path`。不依赖 `shared`、不依赖 `observability`（需要日志时通过 `logger` 回调注入）。
- 与 `observability` 同层级、同构型（package.json/tsconfig 直接照抄它的模式）。

### 2.2 目录结构

```
packages/exec/
  package.json
  tsconfig.json
  src/
    index.ts          # re-export 全部公开 API
    types.ts          # 全部公开类型
    env-policy.ts     # buildChildEnv() + SAFE_KEYS 常量 —— 整个包的核心
    env-policy.test.ts
    run.ts            # run() 一次性进程
    run.test.ts
    service.ts        # spawnService() 长驻进程
    service.test.ts
    kill.ts           # killProcessGroup() 内部工具（service/run 共用）
```

### 2.3 `packages/exec/package.json`（照此创建）

```json
{
  "name": "@clawbot/exec",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.js",
  "types": "./src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "development": "./src/index.ts",
      "default": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc -w",
    "test": "tsx --conditions development --test 'src/**/*.test.ts'"
  },
  "devDependencies": {
    "@types/node": "^22.19.15",
    "tsx": "^4.19.3",
    "typescript": "^7.0.2"
  }
}
```

### 2.4 `packages/exec/tsconfig.json`（复制 `packages/observability/tsconfig.json`，内容一致）

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "types": ["node"],
    "declaration": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"],
  "exclude": ["src/**/*.test.ts"]
}
```

> 注意：测试文件与源码同目录（`src/*.test.ts`，与 observability 一致），因此 tsconfig 需 `exclude` 测试文件避免打进 dist；若 observability 未这么做而能通过构建，则去掉 exclude 保持一致即可，以实际构建通过为准。

### 2.5 接线改动

1. **根 `package.json` 的 `build` 脚本**：在 `pnpm -F @clawbot/observability build` **之前**（或之后、`@clawbot/agent` 之前，任选，只要在 agent 前）插入 `pnpm -F @clawbot/exec build &&`。
2. **根 `package.json` 的 `dev` 脚本**：插入 `pnpm -F @clawbot/exec dev &`（与 observability 并列）。
3. **`packages/agent/package.json`**：`dependencies` 增加 `"@clawbot/exec": "workspace:*"`。
4. **`packages/server/package.json`**：`dependencies` 增加 `"@clawbot/exec": "workspace:*"`。
5. `pnpm-workspace.yaml` 已含 `packages/*`，无需改。
6. 执行 `pnpm install` 使 workspace 链接生效。

---

## 3. env 策略：`buildChildEnv()`（本方案的核心）

文件：`packages/exec/src/env-policy.ts`。**纯函数，不读全局状态**（`hostEnv` 作为参数注入，默认 `process.env`），100% 可单测。

### 3.1 公开类型（`types.ts`）

```ts
export type EnvInherit = "safe" | "none";

export interface EnvSpec {
  /**
   * "safe"（默认）：只继承 SAFE 白名单（PATH/HOME/代理等，见 env-policy.ts）。
   * "none"：完全空白起步。
   * 注意：不存在 "all"。需要额外变量用 passthrough 或 env 显式声明。
   */
  inherit?: EnvInherit;
  /** 额外继承的宿主变量名；尾部 "*" 表示前缀通配，如 "NPM_CONFIG_*"。 */
  passthrough?: readonly string[];
  /** 显式注入/覆盖，优先级最高；值为 undefined 表示删除该键。 */
  env?: Record<string, string | undefined>;
}
```

### 3.2 白名单常量（精确定义，不得增删——增删需改本文档）

```ts
/** 精确匹配的安全键。 */
const SAFE_KEYS = new Set([
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "TERM", "LANG", "TZ",
  // 代理与出网配置（大小写两种写法都是生态惯例）
  "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY",
  "http_proxy", "https_proxy", "no_proxy", "all_proxy",
  // 企业自签 CA 场景需要；本身不是秘密
  "NODE_EXTRA_CA_CERTS",
]);

/** 前缀匹配的安全键。 */
const SAFE_PREFIXES = ["LC_"];

/** win32 额外白名单（保持可移植；darwin/linux 下不生效）。 */
const WIN32_SAFE_KEYS = new Set([
  "SYSTEMROOT", "WINDIR", "COMSPEC", "PATHEXT",
  "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "USERPROFILE",
]);

/** 面向包管理器（pip/uv/npm/pnpm/yarn）的推荐 passthrough，供 provisioner 使用。 */
export const INSTALLER_ENV_PASSTHROUGH: readonly string[] = [
  "NPM_CONFIG_*", "PNPM_*", "YARN_*", "COREPACK_*",
  "PIP_*", "UV_*", "PYTHONPATH", "VIRTUAL_ENV",
];
```

**明确排除且不得加入白名单**（在 env-policy.ts 顶部注释里写明理由）：

- `NODE_OPTIONS` / `NODE_REPL_*`：对 Node 子进程（npx 系 MCP server）是代码注入向量。
- `NODE_ENV`：行为分歧源，需要的进程自行显式配置。
- 一切形如 `*_KEY` / `*_SECRET` / `*_TOKEN` / `DATABASE_URL` 的变量：这正是本方案要挡的东西，靠「白名单默认不含」而非「黑名单枚举」。

### 3.3 算法（严格按序实现）

```ts
export function buildChildEnv(
  spec: EnvSpec,
  hostEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  // 1. 基底
  const result: Record<string, string> = {};
  if ((spec.inherit ?? "safe") === "safe") {
    for (const [key, value] of Object.entries(hostEnv)) {
      if (value === undefined) continue;
      const safe =
        SAFE_KEYS.has(key) ||
        SAFE_PREFIXES.some((p) => key.startsWith(p)) ||
        (process.platform === "win32" && WIN32_SAFE_KEYS.has(key.toUpperCase()));
      if (safe) result[key] = value;
    }
  }
  // 2. passthrough（精确名或尾部 * 前缀通配，区分大小写）
  for (const pattern of spec.passthrough ?? []) {
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      for (const [key, value] of Object.entries(hostEnv)) {
        if (value !== undefined && key.startsWith(prefix)) result[key] = value;
      }
    } else {
      const value = hostEnv[pattern];
      if (value !== undefined) result[pattern] = value;
    }
  }
  // 3. 显式注入，优先级最高；undefined 删除
  for (const [key, value] of Object.entries(spec.env ?? {})) {
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result;
}
```

---

## 4. 两个执行原语

仓库中的进程只有两种形态，包只提供两个入口，全部经过 `buildChildEnv()`。**包内不提供任何绕过 env 策略的参数。**

### 4.1 公开类型（`types.ts` 续）

```ts
import type { Readable, Writable } from "node:stream";

export type RejectOnError = "always" | "when-empty-output" | "never";

export interface RunSpec extends EnvSpec {
  binary: string;
  args: readonly string[];
  cwd?: string;
  /** 默认 30_000。必须为正整数；不允许「无超时」。 */
  timeoutMs?: number;
  /** stdout 与 stderr 各自的字节上限，默认 4 * 1024 * 1024。超限即杀并 reject。 */
  maxBuffer?: number;
  signal?: AbortSignal;
  /**
   * "always"（默认）：退出码非 0 或被信号杀死即 reject。
   * "when-empty-output"：仅当失败且 stdout、stderr 均为空时 reject。
   * "never"：只要进程退出就 resolve（超时/中止/maxBuffer 仍然 reject）。
   */
  rejectOnError?: RejectOnError;
}

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface ServiceExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  /** spawn 本身失败（如 ENOENT）时携带原始错误，此时 code/signal 均为 null。 */
  spawnError?: Error;
}

export interface ServiceSpec extends EnvSpec {
  command: string;
  args?: readonly string[];
  cwd?: string;
  /** stop() 的 SIGTERM→SIGKILL 宽限期，默认 5_000。 */
  gracefulTimeoutMs?: number;
  /** 注入的日志回调；不注入则静默。 */
  logger?: (level: "warn" | "error", message: string) => void;
  /** 可选 RSS 看门狗（§4.6）；不设置则关闭。 */
  memoryLimitMb?: number;
  /** RSS 采样间隔，默认 30_000。 */
  memoryPollIntervalMs?: number;
}

export interface ServiceHandle {
  readonly pid: number | undefined;
  readonly stdin: Writable;
  readonly stdout: Readable;
  readonly stderr: Readable;
  /** 进程结束（含 spawn 失败）时 resolve，永不 reject，只 settle 一次。 */
  readonly exited: Promise<ServiceExit>;
  /** 立即向整个进程组发信号，默认 SIGTERM。 */
  kill(signal?: NodeJS.Signals): void;
  /** SIGTERM → 等待 gracefulTimeoutMs → SIGKILL，resolve 于进程真正退出。幂等。 */
  stop(): Promise<ServiceExit>;
}
```

### 4.2 进程组清杀（`kill.ts`，内部模块）

**动机**：现状 `stdio-client.ts` 只 kill 直接子进程，而 `npx foo` 的真身是 npx 的孙进程——SIGTERM npx 会留下孤儿 server。这是问题清单未点名的真实缺陷，统一修掉。

```ts
export function killProcessGroup(pid: number | undefined, signal: NodeJS.Signals): void {
  if (pid === undefined) return;
  if (process.platform !== "win32") {
    try {
      process.kill(-pid, signal);   // 负 pid = 整个进程组
      return;
    } catch {
      // 进程组不存在（已退出）或权限问题，回退到单进程
    }
  }
  try {
    process.kill(pid, signal);
  } catch {
    // 已退出，忽略
  }
}
```

配套要求：**所有 spawn 一律 `detached: process.platform !== "win32"`**，让子进程自成进程组，组杀才有意义。`detached` 下必须保证退出路径可靠（`exited` promise + stop/kill），不调用 `unref()`。

### 4.3 `run()` 语义（`run.ts`）

**不用 `execFile`**，用 `spawn` 自行实现，理由：需要 `detached` + 组杀 + 统一错误形状，`execFile` 的 timeout/killSignal 只作用于直接子进程。

实现要点（按序）：

1. `spawn(binary, args, { cwd, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32", env: buildChildEnv(spec) })`。
2. stdout/stderr 设 `utf8` 编码累积成字符串，各自统计字节数；任一超过 `maxBuffer` → `killProcessGroup(pid, "SIGKILL")`，进程退出后 reject `Error("<binary> output exceeded maxBuffer (<n> bytes)")`。
3. 超时：`setTimeout(timeoutMs)` 到期 → 标记 `timedOut`，`killProcessGroup(pid, "SIGTERM")`，再 `setTimeout(2_000)` 若仍未退出 → SIGKILL。进程退出后 reject `Error("<binary> timed out after <timeoutMs>ms")`。所有 timer 在退出时清理（`clearTimeout`）。
4. `signal`：已 aborted 则直接 reject AbortError（`name = "AbortError"`）且不 spawn；运行中 abort → 与超时相同的杀进程流程，退出后 reject AbortError。记得 `removeEventListener`。
5. spawn 错误（`error` 事件先于 `exit`）：reject `Error("<binary> failed to start: <原始 message>")`。
6. 正常退出：按 `rejectOnError` 决定 resolve/reject。reject 错误消息格式与现 `fs-utils.execPromise` 保持一致：`` `${binary} ${args.join(" ")} failed: ${stderr || `exit code ${code}`}` ``（provisioner 的日志与测试依赖这个形状）。
7. resolve 值：`{ stdout, stderr, code, signal }`。
8. 防多次 settle：用一个 `settled` 标志；`exit` 与 `error` 都可能触发收尾，只第一次生效。

### 4.4 `spawnService()` 语义（`service.ts`）

1. spawn 参数同 §4.3 第 1 条（stdio 为 `"pipe"` 三通道）。
2. `exited`：`new Promise` 中挂 `once("exit")` 与 `once("error")`，先到者 settle（error → `{ code: null, signal: null, spawnError }`）。
3. `stop()`：若已退出，直接返回已 settle 的 `exited`；否则 `killProcessGroup(pid, "SIGTERM")` → race(`exited`, 宽限 timer) → 超期则 `killProcessGroup(pid, "SIGKILL")` → return `exited`。重复调用返回同一个 promise。
4. `kill(signal = "SIGTERM")`：直接 `killProcessGroup`。
5. 看门狗（§4.6）在 `exited` settle 时必须清理 interval。
6. **不暴露原始 `ChildProcess`**，防止调用方绕过 stop/kill 语义。

### 4.5 资源边界现状 → 目标对照

| 边界 | 现状 | 目标（本方案后） |
|---|---|---|
| 一次性进程超时 | cli 有、skill 有、provisioner 有、skills 路由 unzip **无** | `run()` 强制默认 30s，无「无超时」选项 |
| 输出上限 | 各自 maxBuffer | `run()` 统一默认 4MiB，超限杀进程 |
| 长驻进程退出 | SIGTERM 单进程，npx 场景留孤儿 | 进程组 SIGTERM→SIGKILL 阶梯 |
| 内存 | 无 | 可选 RSS 看门狗（默认关） |
| CPU / PID 数 | 无 | **不做**（不可移植），在包 README 注释中如实声明 |

### 4.6 RSS 看门狗（可选实现，允许放到最后做）

`memoryLimitMb` 设置时启用：每 `memoryPollIntervalMs` 执行 `ps -o rss= -p <pid>`（macOS/Linux 通用；注意**这里允许包内使用 child_process**，它本身就在豁免区内），解析出 KiB；连续两次超限 → `logger("warn", ...)` + `stop()`。只监控直接子进程，不含孙进程——此局限写进注释。win32 下静默不启用。

---

## 5. 迁移：六个调用点逐一处理

> 完成 §5 后，全仓 `node:child_process` 的 import 只剩：`packages/exec/src/`、`packages/server/src/prisma-cli.ts`、测试文件。

### 5.1 `packages/agent/src/mcp/stdio-client.ts`（MCP 长驻进程）

- 删除 `import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"`，改为 `import { spawnService, type ServiceHandle } from "@clawbot/exec"`。
- `let child: ChildProcessWithoutNullStreams | null` → `let child: ServiceHandle | null`。
- `connect()` 中 `spawn(...)`（现 337-344 行）替换为：

```ts
const handle = spawnService({
  command: options.command,
  args: options.args ?? [],
  cwd: options.cwd ?? undefined,
  inherit: "safe",
  env: options.env ?? {},
  gracefulTimeoutMs: 5_000,
});
```

- `bindProcess()`：stdout/stderr 的流处理逻辑不变（handle 直接暴露流）；`once("error")` / `once("exit")` 两个监听替换为：

```ts
void handle.exited.then((exit) => {
  if (exit.spawnError) {
    handleClose(toError(exit.spawnError));
    return;
  }
  const reason = exit.signal
    ? `MCP server exited with signal ${exit.signal}`
    : `MCP server exited with code ${String(exit.code ?? 0)}`;
  handleClose(new Error(stderrBuffer.trim() || reason));
});
```

- 握手超时（现 349-351 行）`processHandle.kill("SIGTERM")` → `void processHandle.stop()`。
- `close()`（文件尾部）`processHandle.kill("SIGTERM")` → `await processHandle.stop()`（接口本就返回 Promise，语义从「发信号就返回」增强为「等到真正退出」，这是刻意改进）。
- `request()` 内 `processHandle.stdout.resume()` / `processHandle.stdin.write(...)` 不变（handle 同名属性）。
- **行为变化（必须写进 PR 描述）**：MCP 子进程不再继承宿主完整 env。个别 server 若依赖某个宿主变量（如自定义 API key），管理员需在该 server 的 `env` 配置里显式添加。配合 §5.7 的提示日志。

### 5.2 `packages/agent/src/tools/handlers/cli.ts`（CLI 工具）

- 删除 `import { execFile } from "node:child_process"` 与整个 `runCommand()` 函数。
- `execute()` 中调用点改为：

```ts
import { run } from "@clawbot/exec";
// ...
const { stdout, stderr } = await run({
  binary,
  args: fullArgs,
  timeoutMs,
  maxBuffer: 1024 * 1024,
  signal: ctx.signal,
  inherit: "safe",
  rejectOnError: "when-empty-output",
});
```

- 其余（allowlist、FORBIDDEN_SHELL_PATTERN、截断逻辑）**不动**。
- 已知微小行为差异（可接受，写进 PR 描述）：原实现「有 error 且无 stdout」即抛错；新实现只要 stderr 有内容就 resolve，随后既有的 `stdout.trim() || stderr.trim()` 会把 stderr 作为输出返回给模型。对用户可见结果等价。

### 5.3 `packages/agent/src/skills/fs-utils.ts`（provisioner 的底层封装）

`execPromise` 保留签名、改为 `run()` 的薄包装（约 20 个调用点零改动迁移）：

```ts
import { run, INSTALLER_ENV_PASSTHROUGH } from "@clawbot/exec";

export function execPromise(
  binary: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    maxBuffer?: number;
    signal?: AbortSignal;
    rejectOnError?: "always" | "when-empty-output";
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  // 面向包管理器的封装：safe 基底 + 安装器配置变量透传，不再接受调用方自定义 env。
  return run({
    binary,
    args,
    cwd: options.cwd,
    timeoutMs: options.timeout ?? 30_000,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    signal: options.signal,
    rejectOnError: options.rejectOnError ?? "always",
    inherit: "safe",
    passthrough: INSTALLER_ENV_PASSTHROUGH,
  });
}
```

- **删除签名中的 `env?: NodeJS.ProcessEnv` 参数**（唯一使用方是 runtime-tools 的 `sanitizeEnv()`，见 §5.4）。
- 删除文件顶部 `import { execFile } from "node:child_process"`。
- `runtime-provisioner.ts` 的全部 `execPromise` 调用点**不改**——自动获得 safe env + 安装器透传。provisioner 缺 AbortSignal 的问题（问题清单 §1 表）本期**保持现状**，不扩 scope。

### 5.4 `packages/agent/src/skills/runtime-tools.ts`（Skill 脚本）

- **整体删除** `SENSITIVE_PREFIXES` 常量与 `sanitizeEnv()` 函数（现 80-103 行）——黑名单机制废止。
- `runChildProcess()`（现 262-284 行）改为直接调 `run()`（skill 脚本不应获得安装器透传，所以不走 execPromise）：

```ts
import { run } from "@clawbot/exec";

async function runChildProcess(
  executable: string,
  commandArgs: string[],
  options: { cwd: string; timeoutMs: number },
  signal: AbortSignal,
): Promise<string> {
  try {
    const { stdout, stderr } = await run({
      binary: executable,
      args: commandArgs,
      cwd: options.cwd,
      timeoutMs: options.timeoutMs,
      maxBuffer: 1024 * 1024,
      signal,
      inherit: "safe",
      rejectOnError: "when-empty-output",
    });
    return (stdout || stderr || "(no output)").trim();
  } catch (error) {
    if (signal.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    throw error;
  }
}
```

- 检查 `packages/agent/test/skills/runtime-tools.test.ts`：若存在针对 `sanitizeEnv` 的用例，删除之（该职责移交 `env-policy.test.ts`）；`validateRunRequest` 相关用例保留。

### 5.5 `packages/server/src/api/routes/skills.ts`（skill 上传路由）

- 删除 `import { execFile } from "node:child_process"`、`import { promisify } from "node:util"`、`const execFileAsync = promisify(execFile)`。
- 三个调用点替换：

```ts
import { run } from "@clawbot/exec";

// 版本探测（原 68/71 行）
await run({ binary: "python3", args: ["--version"], timeoutMs: 10_000, inherit: "safe" });
await run({ binary: "node", args: ["--version"], timeoutMs: 10_000, inherit: "safe" });

// 解压用户上传的 zip（原 118 行）——新增 60s 超时，修复恶意 zip 可挂死请求的问题
await run({
  binary: "unzip",
  args: ["-o", "-q", zipPath, "-d", extractDir],
  timeoutMs: 60_000,
  inherit: "safe",
});
```

### 5.6 `packages/server/src/prisma-cli.ts` —— 豁免

不迁移。理由：开发期 CLI 包装，`stdio: "inherit"` 运行在管理员自己的终端会话里，显式注入 `DATABASE_URL` 是其功能本身。将它列入 §5.7 封锁机制的白名单，并在文件顶部加一行注释：

```ts
// 豁免于 @clawbot/exec 封锁：开发期 CLI，运行于管理员终端，见 docs/2026-07-23_21_30_exec-package-design.md §5.6
```

### 5.7 连接失败提示（配合 5.1 的行为变化）

`packages/server/src/mcp/manager.ts` 的 `connectServer()` catch 分支（现 187-194 行），在 `updateMcpServerConnectionState` 之前追加一条日志：

```ts
mcpLogger.warn(
  { serverId: server.id, serverSlug: server.slug },
  "MCP 连接失败。提示：子进程已不再继承宿主完整环境变量，若该 server 依赖某个环境变量，请在其 env 配置中显式声明",
);
```

---

## 6. P2 修复：hub 解析结果落库固化

**目标**：把「每次重启都信任一次远程注册表 + 正则宽松解析」变成「解析一次、落库、管理员可见；只有配置变更才重新解析」。`hubResolver.ts` 的解析逻辑本身不改。

### 6.1 Prisma schema（`packages/server/prisma/schema.prisma` 的 `McpServer` model 追加字段）

```prisma
  resolvedCommand  String?   @map("resolved_command") @db.Text
  resolvedArgsJson Json?     @map("resolved_args_json")
  resolvedEnvJson  Json?     @map("resolved_env_json")
  resolvedFrom     String?   @map("resolved_from") @db.Text
  resolvedAt       DateTime? @map("resolved_at") @db.Timestamptz(6)
```

改完执行：`pnpm -F @clawbot/server prisma:generate && pnpm -F @clawbot/server prisma:push`。

### 6.2 `packages/server/src/db/mcp.ts`

1. `McpServerRuntimeConfig` 增加字段：`resolvedCommand: string | null`、`resolvedArgs: string[] | null`、`resolvedEnv: Record<string, string> | null`（从上述列映射；JSON 列解析失败按 null 处理并 `console.warn`）。
2. 新增函数：

```ts
export async function saveResolvedLaunchSpec(id: string, spec: {
  command: string; args: string[]; env: Record<string, string>; rewrittenFrom: string;
}): Promise<void>;
// 写入 resolved_command / resolved_args_json / resolved_env_json / resolved_from / resolved_at = now()
```

3. **`updateMcpServer()`：当入参包含 `command`、`args` 或 `env` 任一变更时，将全部 `resolved_*` 列清空（null）**——配置一变，缓存作废，下次连接重新解析。这是本机制的关键不变量。
4. `McpServerInfo`（`packages/shared` 中的类型）增加只读字段 `resolved_command: string | null`、`resolved_from: string | null`、`resolved_at: string | null`（snake_case，与该类型既有字段 `created_at`/`tool_count` 的 API 约定一致），`db/mcp.ts` 的映射函数带出，供 Web 端展示「实际执行的命令」（Web UI 展示本身可后续做，类型与 API 先带上）。

### 6.3 `packages/server/src/mcp/manager.ts` 的 `connectServer()`

现 117 行 `const launch = await resolveLaunchSpec(server);` 替换为：

```ts
let launch: { command: string; args: string[]; env: Record<string, string>; rewrittenFrom?: string };
if (server.resolvedCommand) {
  // 已有固化结果：不再访问远程注册表
  launch = {
    command: server.resolvedCommand,
    args: server.resolvedArgs ?? [],
    env: { ...(server.resolvedEnv ?? {}), ...server.env },
  };
} else {
  launch = await resolveLaunchSpec(server);
  if (launch.rewrittenFrom) {
    await saveResolvedLaunchSpec(server.id, {
      command: launch.command,
      args: launch.args,
      env: launch.env,
      rewrittenFrom: launch.rewrittenFrom,
    });
  }
}
```

注意：非 hub 形式的配置（`rewrittenFrom` 为空）**不落库**，`resolved_*` 保持 null，行为与现状一致。

### 6.4 强制重新解析的途径

管理员重新保存 command/args（触发 §6.2-3 的清空）即可。**不新增**专用 re-resolve 端点（可选项，本期不做）。

---

## 7. P3/P4 轻量项：配置写入时的校验与提示

位置：`packages/server/src/api/routes/mcp.ts` 的解析函数（现 80-120 行附近）。

1. **cwd 校验收紧**：在现有「必须是 string」的基础上，增加「必须是绝对路径」：

```ts
import { isAbsolute } from "node:path";
if (typeof cwdValue === "string" && cwdValue.trim() && !isAbsolute(cwdValue)) {
  throw new ValidationError("cwd must be an absolute path");
}
```

2. **共享解释器提示**（可选，建议做）：解析出 `command` 后，若其 basename ∈ {`python`, `python3`, `node`} 且 args 不含 `-m venv` 类隔离形式，则在 create/update 的响应 JSON 中附加：

```json
{ "warnings": ["该命令直接使用共享解释器，多个 MCP Server 的依赖可能互相冲突；建议使用 npx -y / uvx / docker 等自带隔离的 runner"] }
```

只提示不拦截（依赖隔离是管理员的配置责任，见 §0.1 第 3 条）。同时 `mcpLogger.warn` 记录一份。

---

## 8. 封锁机制：让「第五个执行点」写不出来

两层，**脚本层为权威**（不依赖工具版本），lint 层为开发期即时反馈。

### 8.1 权威脚本 `scripts/check-child-process-fence.sh`（新建，`chmod +x`）

```bash
#!/usr/bin/env bash
# 封锁 node:child_process：仓库内只允许 @clawbot/exec 及豁免清单使用。
# 见 docs/2026-07-23_21_30_exec-package-design.md §8
set -euo pipefail
cd "$(dirname "$0")/.."

allowed_pattern='^packages/exec/src/|^packages/server/src/prisma-cli\.ts$|\.test\.ts$|/test/'

violations=$(grep -rln --include='*.ts' \
  -e 'node:child_process' -e '"child_process"' -e "'child_process'" \
  packages 2>/dev/null \
  | grep -v node_modules \
  | grep -vE "$allowed_pattern" || true)

if [ -n "$violations" ]; then
  echo "❌ 以下文件绕过 @clawbot/exec 直接使用 child_process："
  echo "$violations"
  echo "请改用 @clawbot/exec 的 run()/spawnService()。豁免需修改本脚本并更新设计文档。"
  exit 1
fi
echo "✅ child_process fence OK"
```

根 `package.json` 增加脚本：`"check:fence": "bash scripts/check-child-process-fence.sh"`，并追加到 `test:agent`/`test:server` 之外单独存在；若仓库有 CI 工作流，将其加入（没有则仅保留脚本 + 提交前检查清单，见 §11）。

### 8.2 oxlint 规则（开发期反馈）

根目录新建 `.oxlintrc.json`：

```json
{
  "rules": {
    "no-restricted-imports": ["error", {
      "paths": [
        { "name": "node:child_process", "message": "请通过 @clawbot/exec 的 run()/spawnService() 起进程" },
        { "name": "child_process", "message": "请通过 @clawbot/exec 的 run()/spawnService() 起进程" }
      ]
    }]
  },
  "overrides": [
    {
      "files": ["packages/exec/src/**", "packages/server/src/prisma-cli.ts", "**/*.test.ts", "packages/agent/test/**"],
      "rules": { "no-restricted-imports": "off" }
    }
  ]
}
```

- `packages/agent` 与 `packages/server` 目前**没有** oxlint：各自 `devDependencies` 加 `"oxlint": "^1.59.0"`（对齐 `packages/ui` 的版本），`scripts` 加 `"lint": "oxlint"`。
- 注意：`packages/ui`、`packages/web` 的既有 `lint` 会开始读取根配置——它们不 import child_process，预期无新增报错；若该 oxlint 版本不支持 `no-restricted-imports`，删掉 `.oxlintrc.json` 中该规则并在本文档此处标注，以 §8.1 脚本为唯一防线。

### 8.3 AGENTS.md「禁止事项」追加

在根 `AGENTS.md` 的禁止事项列表加一条：

```
- ❌ 在 @clawbot/exec 之外直接使用 `node:child_process`（唯一豁免：`server/src/prisma-cli.ts` 与测试文件）
```

---

## 9. 测试计划（P7 的偿还）

### 9.1 `packages/exec/src/env-policy.test.ts`（纯函数，必须全绿）

| 用例 | 断言 |
|---|---|
| 默认 safe 基底 | 传入含 `CLAWBOT_CREDENTIAL_KEY`、`DATABASE_URL`、`AUTH_JWT_SECRET`、`NODE_OPTIONS` 的 hostEnv，结果**不含**这四个键 |
| safe 保留项 | `PATH`、`HOME`、`TMPDIR`、`LANG`、`HTTPS_PROXY`、`NODE_EXTRA_CA_CERTS` 被保留 |
| LC_ 前缀 | `LC_ALL`、`LC_CTYPE` 被保留 |
| inherit none | 结果为空对象（不含 PATH） |
| passthrough 精确名 | `passthrough: ["MY_VAR"]` 时 `MY_VAR` 被带上；hostEnv 无该键时结果也无 |
| passthrough 通配 | `passthrough: ["NPM_CONFIG_*"]` 带上 `NPM_CONFIG_REGISTRY`，不带 `NPMX_FOO` |
| env 覆盖 | `env: { PATH: "/custom" }` 覆盖继承值 |
| env 删除 | `env: { PATH: undefined }` 后结果不含 PATH |
| 不读全局 | 传入自定义 hostEnv 时结果与 `process.env` 无关 |

### 9.2 `packages/exec/src/run.test.ts`（用 `node -e` 作 fixture，无外部依赖）

| 用例 | 做法 |
|---|---|
| 正常输出 | `run({ binary: process.execPath, args: ["-e", "console.log('hi')"] })` → stdout 含 `hi`，code 0 |
| env 隔离端到端 | 设 `process.env.TEST_LEAK_CHECK = "secret"`，子进程打印 `process.env.TEST_LEAK_CHECK` → 输出为 `undefined`（记得测试收尾 delete） |
| env 显式注入 | `env: { FOO: "bar" }`，子进程打印 `FOO` → `bar` |
| 非零退出 always | `-e "process.exit(3)"` → reject，消息含 `failed` |
| 非零退出 when-empty-output | `-e "console.log('x');process.exit(3)"` → resolve，stdout 为 `x` |
| 非零退出 never | reject 不发生，`code === 3` |
| 超时 | `-e "setInterval(()=>{},1000)"`、`timeoutMs: 500` → reject 消息含 `timed out`；用例总耗时 < 5s |
| abort | 已 aborted 的 signal → 立即 reject `AbortError`；运行中 abort → reject `AbortError` |
| maxBuffer | 子进程循环打印大量数据、`maxBuffer: 1024` → reject 消息含 `maxBuffer` |
| spawn 失败 | `binary: "definitely-not-a-binary-xyz"` → reject 消息含 `failed to start` |

### 9.3 `packages/exec/src/service.test.ts`

| 用例 | 做法 |
|---|---|
| stdin/stdout 往返 | fixture：`process.stdin.on("data", d => process.stdout.write(d))`；写入一行，读回同一行 |
| 优雅退出 | fixture 挂 `process.on("SIGTERM", () => process.exit(0))`；`stop()` → exited `{ code: 0 }`，耗时远小于宽限期 |
| SIGKILL 升级 | fixture 忽略 SIGTERM（`process.on("SIGTERM", ()=>{})` + setInterval 保活）、`gracefulTimeoutMs: 500` → `stop()` 后 exited `signal === "SIGKILL"` |
| 进程组清杀 | fixture 父进程 spawn 一个 `sleep 60` 孙进程并把孙 pid 打到 stdout；`stop()` 后对孙 pid `process.kill(pid, 0)` 应抛 ESRCH |
| spawn 失败 | 不存在的 command → `exited` resolve 且 `spawnError` 非空 |
| stop 幂等 | 连续两次 `stop()` 返回同一结果，不抛错 |

### 9.4 回归

- `pnpm test:agent`、`pnpm test:server` 全绿（`runtime-tools.test.ts` 按 §5.4 调整后）。
- `stdio-client` / `manager` / `hubResolver` 本期**不补**单测（它们的可测性问题由收敛到 exec 缓解，剩余部分是独立工作量，不扩 scope）。

---

## 10. 实施顺序（6 个阶段，每阶段一个可独立提交的单元）

> 按序执行，每阶段末尾跑「验收」，不过不进下一阶段。

**阶段 0 — 包骨架 + env 策略**
建 `packages/exec`（§2），实现 `types.ts`、`env-policy.ts` 及其测试，`index.ts` 导出。接线根 build/dev 脚本、`pnpm install`。
验收：`pnpm -F @clawbot/exec test`、`pnpm -F @clawbot/exec exec tsc --noEmit`、`pnpm build`。

**阶段 1 — run() + spawnService()**
实现 `kill.ts`、`run.ts`、`service.ts` 及测试（§4、§9.2、§9.3）。
验收：同上。

**阶段 2 — agent 侧四处迁移**
按 §5.1–§5.4 迁移 stdio-client、cli.ts、fs-utils、runtime-tools；agent 加依赖。
验收：`pnpm -F @clawbot/agent exec tsc --noEmit`、`pnpm test:agent`、手工冒烟：启动 dev server，连接一个已配置的 MCP server 成功、调用一次 skill 脚本成功。

**阶段 3 — server 侧迁移 + 封锁**
按 §5.5 迁移 skills.ts；server 加依赖；建 §8.1 脚本与 §8.2 lint 配置；§8.3 改 AGENTS.md；§5.6 加豁免注释；§5.7 加提示日志。
验收：`pnpm -F @clawbot/server exec tsc --noEmit`、`pnpm test:server`、`pnpm check:fence` 输出 OK。

**阶段 4 — P2 落库 + 配置校验**
按 §6 全部、§7 全部实施。
验收：`prisma:generate`/`prisma:push` 成功；`tsc --noEmit`（server、shared、web 三包）；手工验证：配置一个 `@mcp_hub_org/cli` 形式的 server → 连接后 `mcp_servers.resolved_command` 有值 → 重启服务不再请求注册表（观察日志无「已将 @mcp_hub_org/cli 配置解析…」）→ 修改该 server 的 command → `resolved_*` 被清空。

**阶段 5 — 文档收尾 +（可选）RSS 看门狗**
按 §12 更新 AGENTS.md 与文档索引；可选实现 §4.6。
验收：文档链接可点、`pnpm build` 全绿、§11 清单逐项通过。

---

## 11. 最终验收清单（全部完成后逐项核对）

- [ ] `grep -rln --include='*.ts' "child_process" packages | grep -v node_modules` 的输出仅剩：`packages/exec/src/*`、`packages/server/src/prisma-cli.ts`、`*.test.ts`/`test/` 文件
- [ ] `agent`、`server`、`exec`、`shared`、`web` 五包 `tsc --noEmit` 通过
- [ ] `pnpm -F @clawbot/exec test`、`pnpm test:agent`、`pnpm test:server` 全绿
- [ ] `pnpm check:fence` 通过
- [ ] `pnpm build` 全绿（含新包，顺序在 agent 之前）
- [ ] `SENSITIVE_PREFIXES` / `sanitizeEnv` 在仓库中已不存在（`grep -rn "SENSITIVE_PREFIXES\|sanitizeEnv" packages` 无结果）
- [ ] 冒烟：MCP server 连接成功、工具调用成功；skill 脚本运行成功；CLI 工具（opencli）调用成功；skill zip 上传解压成功
- [ ] 冒烟（env 隔离）：临时配置一个 MCP server 指向 `node -e 'console.log(JSON.stringify(process.env))'` 类的回显脚本（或用测试覆盖），确认输出不含 `CLAWBOT_CREDENTIAL_KEY`、`DATABASE_URL`
- [ ] hub 固化流程按阶段 4 验收步骤复验通过
- [ ] `agent` 包未引入对 `server` 的依赖；`exec` 包 `dependencies` 为空

## 12. 文档同步更新点

1. **根 `AGENTS.md`**：
   - Monorepo 结构表加一行：`exec/ ← @clawbot/exec 子进程执行统一出口（env 白名单、超时、进程组清杀）`
   - 依赖方向图改为：`server → agent → exec` 与 `server → exec`（顺带按问题清单 §3.3 的备注把已存在的 `asset` 包补进图里）
   - 禁止事项追加 §8.3 那条
   - 关键文档索引表加一行：`进程执行统一出口 | docs/2026-07-23_21_30_exec-package-design.md`
2. **问题清单文档** `2026-07-23_20_57_process-execution-isolation-problems.md`：在顶部引言区追加一行：`> 对应方案与实施规格见 [exec 包设计](./2026-07-23_21_30_exec-package-design.md)。`（只加链接，不改动正文事实）
3. **`packages/exec/src/index.ts` 顶部注释**：一段话说明包的职责边界与非目标（照抄 §0.2 精神），并声明「本包是仓库内 child_process 的唯一合法入口」。

## 13. 风险与回滚

| 风险 | 概率 | 处置 |
|---|---|---|
| 某 MCP server 因缺宿主 env 变量连接失败 | 中 | §5.7 的提示日志指引管理员在 server env 配置补齐；这是预期内的显式化，不是回归 |
| npm/pip 安装因缺某配置变量失败 | 低 | `INSTALLER_ENV_PASSTHROUGH` 已覆盖主流配置前缀；个案通过在该常量追加前缀解决（改动需同步本文档 §3.2） |
| oxlint 版本不支持 `no-restricted-imports` | 低 | 删除该规则，脚本 §8.1 为唯一防线（已设计为权威层） |
| `detached: true` 引入平台差异 | 低 | win32 下 detached 关闭、组杀退化为单杀（§4.2 已处理）；目标平台 darwin/linux 行为一致 |
| 回滚 | — | 各阶段独立提交；任一阶段回滚即 `git revert` 该阶段提交。阶段 4 涉及 DB 列新增（可空列），revert 代码后残留列无害，可留待下次清理 |
