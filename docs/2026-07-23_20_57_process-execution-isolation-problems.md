# 外部进程执行与环境隔离：现状问题清单（2026-07-23）

> 对应方案与实施规格见 [exec 包设计](./2026-07-23_21_30_exec-package-design.md)。
>
> **本文只描述问题，不提供任何解决方案。** 目的是给参与讨论的人一份共同的事实基础，方案留待讨论产出。
>
> **范围**：本仓库中所有「起外部进程」的代码路径——MCP Server、Skill 脚本、CLI 工具、依赖供给。
>
> **不在范围内**：Agent 引擎并发正确性、消息持久化、记忆系统等问题，那些已记录在 [2026-07-02 架构评审](./2026-07-02_18_45_architecture-review-20260702.md)，本文不重复。MCP 的运行时链路细节见 [MCP 运行时链路详解](./2026-07-23_18_10_mcp-runtime-walkthrough.md)。
>
> 所有结论基于当前代码逐行阅读，带 `文件:行号` 锚点，可直接核对。

---

## 1. 现状事实：四处进程执行点

仓库中共有四处会启动外部进程，分属两个子系统，彼此独立演进：

| # | 位置 | 用途 | 进程形态 | env 策略 | 超时 | 取消 |
|---|---|---|---|---|---|---|
| 1 | `agent/src/mcp/stdio-client.ts:337` | MCP Server | 长驻子进程 | **全量继承**（显式 spread `...process.env`） | 仅握手 30s | 有 AbortSignal，但不通知远端 |
| 2 | `agent/src/skills/runtime-tools.ts:269` | Skill 脚本 | 一次性 | **前缀黑名单过滤**（`sanitizeEnv()`） | 调用方传入 | 有 |
| 3 | `agent/src/tools/handlers/cli.ts:63` | CLI 工具 | 一次性 | **未传 env**（Node 默认全量继承） | 30s，上限 120s | 有 |
| 4 | `agent/src/skills/runtime-provisioner.ts` 多处 | 依赖供给（venv/pip/uv） | 一次性 | 未传 env（全量继承） | 30–60s | 无 |

第 1、3、4 处继承完整环境；第 2 处做了过滤。**同一个仓库里同一件事有三种做法。**

底层封装也是分裂的：第 2、4 处走 `skills/fs-utils.ts:28` 的 `execPromise`，第 1 处直接 `spawn`，第 3 处直接 `execFile`。没有统一出口。

## 2. 问题清单

### P1 · 子进程继承完整的 `process.env`

**现象**：`stdio-client.ts:340` 显式写着 `env: { ...process.env, ...options.env }`；`cli.ts:63` 和 provisioner 未传 `env`，Node 默认继承。

**能拿到什么**（基于 `packages/server/src` 中实际读取的环境变量）：

| 变量 | 泄露后果 |
|---|---|
| `CLAWBOT_CREDENTIAL_KEY` | 解密全部微信账号凭据、全部 LLM Provider API Key、AppSettings 密钥 |
| `DATABASE_URL` / `DIRECT_URL` | 直连 Postgres，绕过全部应用层逻辑 |
| `AUTH_JWT_SECRET` | 伪造任意管理员 JWT |
| `AUTH_USERNAME` / `AUTH_PASSWORD` | 后台登录凭据 |
| `JINA_API_KEY`、S3 密钥等 | 各自对应的越权 |

**与已完成工作的关系**：2026-07 刚完成的 C4（密钥密文化，commit `903dbe2`）把 Provider API Key、AppSettings 密钥从明文列改成 AES-GCM 密文列。**该工作对本条路径完全无效**——密文的主密钥 `CLAWBOT_CREDENTIAL_KEY` 就在 env 里，任何子进程读一下就能解开全部密文。C4 防的是「DB dump 泄露」，防不了「同机子进程」。

**已有的不一致**：`runtime-tools.ts:80` 的 `SENSITIVE_PREFIXES` 说明团队已经意识到这个风险，但只应用在 Skill 一处。且该实现是**前缀黑名单**（`DATABASE_`、`JWT_`、`SECRET_` 等 11 个前缀），自定义命名的密钥不匹配任何前缀就会漏过——`CLAWBOT_CREDENTIAL_KEY` 恰好不在名单内。

### P2 · 远程 HTTP 响应决定 spawn 什么二进制

**现象**：`hubResolver.ts:99-113` 的 `resolveHubServer()` 请求 `MCP_REGISTRY_ENDPOINT`（默认 `https://www.mcp-cn.com/api`），把响应中的 `command` / `args` 交给 `spawn()`。

**放大因素**：该注册表返回的 `connections` 字段是 **key/value 无引号的非法 JSON**，标准 `JSON.parse` 失败后代码走正则宽松解析（`hubResolver.ts:64-79`）从损坏字符串里抠取命令。也就是说，最终被执行的命令来自一次**正则匹配的结果**。

**触发时机**：每次 `connectServer()` 都会重新解析（`manager.ts:117`），解析结果不落库、不固化。服务重启一次就重新信任一次远程响应。

**边界澄清**：MCP 的 `command` 配置本身由管理员经 JWT 保护的接口写入，不是模型选的，因此**不是** 「prompt injection → 任意命令执行」。本条的性质是供应链风险。

### P3 · MCP 侧无任何依赖隔离机制

**现象**：MCP Server 的启动完全由 `mcp_servers` 表的 `command`/`args`/`cwd` 决定，平台不提供也不保证任何依赖隔离。

**对比**：Skill 侧有机制——`runtime-provisioner.ts:145` 为每个 skill 建独立 `.venv`，优先 `uv pip install`，回退 `python3 -m venv` + pip。同一仓库内两个子系统，一个有、一个完全没有。

**具体表现**：两个 Python MCP Server 若需要同一依赖的不同版本，是否冲突完全取决于管理员在配置里写了什么命令。写 `python -m foo` 就共享系统 Python 并冲突；写成带隔离的形式才不冲突。平台层面**没有约束、没有校验、没有提示**。

**相关事实**：`hubResolver.ts:12` 的 `PREFERRED_RUNNERS = ["npx", "uvx", "docker"]` 表明代码对隔离型 runner 有预期，但那只用于解析 hub 配置，不构成平台保证。

### P4 · 无资源上限与故障隔离

**现象**：所有子进程与 server 主进程同 UID、同 cgroup（即无 cgroup）、无内存/CPU/PID 上限。

**表现**：

- 一个 MCP Server 内存泄漏或死循环，可以拖垮整个 bot 进程
- 子进程可读写 server 进程有权限的任何文件，包括 `.env`、`data/`、Prisma schema
- `mcp_servers.cwd` 是管理员填的任意字符串，`api/routes/mcp.ts:97` 只校验「是不是字符串」，不校验路径范围

### P5 · 执行策略无单一出口，四处各自演进

**现象**：见 §1 表格。三种 env 策略、两种底层封装、超时与错误处理各写各的。

**后果**：

- 任何一条安全策略的修订都要改四个地方，且极易漏掉其中之一（P1 就是这么形成的——`sanitizeEnv` 只落在一处）
- 无法回答「这个部署上所有子进程的权限边界是什么」这类问题，因为答案分散在四处
- 新增第五个执行点时，没有可参照的唯一标准

### P6 · 进程生命周期：启动即全量常驻

**现象**：`manager.ts:242` 的 `bootstrap()` 在服务启动时并发连接**所有** `enabled = true` 的 MCP Server，每个 spawn 一个长驻子进程，直到服务关停。

**表现**：

- 常驻内存与「配置了多少个 server」成正比，与「实际用不用得到」无关
- 无按需启动、无空闲回收机制
- `rebuildRegistry()`（`manager.ts:80`）用「server 是否在 `runtimes` 内存 Map 中」决定其工具是否对模型可见，因此**进程不在 = 工具不可见**。工具 schema 虽然全量存在 `mcp_tools` 表（`input_schema` 字段），但当前不作为快照来源。

**相关约束**：MCP Server 冷启动可能很慢（`npx`/`uvx`/`docker` 首次需下载依赖），`CONNECT_TIMEOUT_MS = 30_000` 的设定反映了这一预期。

### P7 · 关键路径零测试覆盖

**现象**：

| 文件 | 行数 | 测试 |
|---|---|---|
| `agent/src/mcp/stdio-client.ts` | 437 | 无 |
| `server/src/mcp/manager.ts` | 338 | 无 |
| `server/src/mcp/hubResolver.ts` | 136 | 无 |
| `agent/src/skills/runtime-provisioner.ts` | ~250 | 无 |
| `agent/src/tools/handlers/cli.ts` | ~120 | 无 |
| `agent/src/skills/runtime-tools.ts` | ~300 | 部分（`runtime-tools.test.ts` 覆盖 `validateRunRequest`） |

即安全边界最敏感、并发最复杂的代码，基本没有测试兜底。

## 3. 讨论时需要尊重的约束

以下是既有事实或已确认的决策，不是待议项：

1. **部署形态**：自托管、单进程、单租户。管理员即使用者。已确认不为多实例/水平扩展做重构（见架构评审 §F.1）。
2. **威胁模型**：MCP/Skill/CLI 的**命令配置**来自管理员（JWT 保护的接口或仓库内 markdown），不来自模型；模型只能决定**调用哪个已注册的工具**及其参数。因此核心风险是供应链与横向移动，不是直接 RCE。
3. **依赖方向**（`AGENTS.md`）：`server → agent → observability → shared`，严格单向。`shared` 是零运行时依赖的纯类型包。注：该图目前未包含已存在的 `asset` 包。
4. **跨平台**：开发机为 macOS（Darwin），生产部署形态未在本文核实。任何依赖 Linux 特性的方向都需要考虑 macOS 上的降级行为。
5. **运行时**：Node.js ≥ 22，纯 ESM，TypeScript 7。
6. **已有资产**：`skills/fs-utils.ts:28` 的 `execPromise` 已封装 cwd/timeout/maxBuffer/env/signal/rejectOnError；`runtime-provisioner.ts` 已有 `RuntimeAdapter` 接口（含 `ensureToolchain`/`prepareEnv`/`verifyEntrypoint`/`buildInstall`），但签名与 skill 领域耦合。

## 4. 待决问题

供讨论使用，本文不给答案：

**关于隔离强度**

1. 单租户前提下，隔离的目标究竟是「防止管理员误装的第三方包窃取凭据」，还是「防止恶意包主动攻击」？两者对应的方案成本相差很大。
2. 是否接受「不同 MCP Server 享有不同隔离等级」（按 server 配置），还是必须全局统一？

**关于依赖管理**

3. 依赖隔离应由平台强制保证，还是继续作为管理员的配置责任（平台只提供文档与校验）？
4. Skill 的 `.venv` 方案与 MCP 的需求是否应当统一到同一套机制？两者的生命周期不同（skill 随安装、MCP 随连接）。

**关于资源与生命周期**

5. 常驻内存是否已构成实际问题？当前生产部署配置了多少个 MCP Server、实测占用多少？（本文未取得该数据，建议讨论前补齐。）
6. 若引入按需启动，「工具对模型可见」与「进程存在」解耦后，首次调用的延迟预算是多少？微信消息场景可接受的上限是多少秒？

**关于工程结构**

7. 四处执行点是否应收敛到单一出口？若是，该出口的边界是「只管启动」还是「兼管依赖供给」？
8. 该能力是否值得独立成包？若是，它在依赖图中的位置如何安排、是否需要引入新的 Port？

**关于优先级**

9. P1（env 全量继承）与 P2（远程决定命令）都属于安全性质，但 P3–P6 属于工程质量。是否应当拆成两条独立推进的线？
10. 本文所列问题与架构评审中尚未完成的阶段 2/3 事项（H1 消息持久化、H2 账号级工具权限、H3 去全局化）如何排序？其中 **H2「工具/技能/MCP 没有账号级权限模型」与本文 P1/P4 存在直接关联**。

## 5. 证据索引

```
agent/src/mcp/stdio-client.ts:337-344      spawn，env 全量 spread
agent/src/mcp/stdio-client.ts:10-17        协议版本列表、CONNECT_TIMEOUT_MS
agent/src/skills/runtime-tools.ts:80-103   SENSITIVE_PREFIXES 前缀黑名单
agent/src/skills/runtime-tools.ts:269-276  execPromise 调用点，env: sanitizeEnv()
agent/src/skills/fs-utils.ts:28-50         execPromise 封装
agent/src/skills/runtime-provisioner.ts:145-230  venv/uv/pip 供给逻辑
agent/src/tools/handlers/cli.ts:5          BINARY_ALLOWLIST（阶段 1 已收缩为 ["opencli"]）
agent/src/tools/handlers/cli.ts:63-67      execFile，未传 env
server/src/mcp/hubResolver.ts:12           PREFERRED_RUNNERS
server/src/mcp/hubResolver.ts:64-79        损坏 JSON 的正则宽松解析
server/src/mcp/hubResolver.ts:99-113       远程 fetch → command/args
server/src/mcp/manager.ts:80-98            rebuildRegistry，runtimes 决定工具可见性
server/src/mcp/manager.ts:110-195          connectServer 完整流程
server/src/mcp/manager.ts:242-258          bootstrap 全量并发连接
server/src/api/routes/mcp.ts:97-99         cwd 仅校验类型
server/prisma/schema.prisma:83-122         McpServer / McpTool 数据模型
```
