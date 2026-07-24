# MCP 运行时链路详解（2026-07-23）

> 本文按**运行时视角**梳理 MCP 从「进程启动」到「模型调用工具」的完整链路，所有结论基于当前代码逐行阅读，带 `文件:行号` 锚点。
>
> 设计意图与选型理由见 [2026-04-01_17_39_mcp-architecture.md](./2026-04-01_17_39_mcp-architecture.md)（4 月的设计文档，其中「已覆盖测试」一节列举的测试文件现已不存在，且未包含后来新增的 `hubResolver`）。

---

## 1. 一句话总览

每个 MCP Server 是 server 进程 spawn 出来的**一个子进程**，通过 stdin/stdout 上的 JSON-RPC 2.0 通信；它暴露的远端工具被拍平成「本地虚拟工具」，注入 agent 的工具注册表，模型看到的和调用本地工具没有区别。

## 2. 三层职责边界

```
packages/agent/src/mcp/      协议层    不知道数据库、不知道 Hono
  stdio-client.ts   437 行   spawn + JSON-RPC 帧解析 + 请求/响应配对
  tool-adapter.ts    38 行   McpToolBinding → ToolSnapshotItem
  types.ts           43 行   接口定义

packages/server/src/mcp/     宿主层    进程生命周期 + 状态持久化
  manager.ts        338 行   连接编排、并发串行化、注册表重建
  hubResolver.ts    136 行   @mcp_hub_org/cli 配置改写（特例，见 §9）

packages/server/src/db/mcp.ts   434 行   Prisma 读写 + local_name 生成
packages/server/src/api/routes/mcp.ts 285 行   12 个管理端点
```

依赖方向符合仓库约束：`agent` 包对 MCP 只提供「怎么说协议」，`server` 包决定「什么时候连、连谁、状态存哪」。`stdio-client.ts` 全文没有 Prisma / Hono 引用。

## 3. 数据模型

`schema.prisma:83-122`，两张表：

| 表 | 关键字段 | 约束 |
|---|---|---|
| `mcp_servers` | `slug` 唯一、`command`/`args_json`/`env_json`/`cwd`、`enabled`、`status`、`last_error`、`last_seen_at` | `@@index([enabled])` |
| `mcp_tools` | `server_id`、`remote_name`、`local_name`、`input_schema`、`enabled`、`last_seen_at` | `[serverId, remoteName]` 唯一、`localName` **全局唯一**、`onDelete: Cascade` |

两处值得注意：

- **`localName` 全局唯一**：跨 server 的工具名冲突在数据库层就被拦住，不依赖应用层去重。
- **`onDelete: Cascade`**：删 server 自动删它的 tools，`deleteMcpServer` 不需要手动清理。

`status` 只有四个取值，全部由 `updateMcpServerConnectionState()` 写入：

```
disconnected ──enable──> connecting ──握手成功──> connected
                             │                        │
                             └──握手失败──> error <────┘ 子进程退出
```

## 4. 五条核心链路

### 4.1 启动连接

```
index.ts:31    createMcpManager(mcpToolRegistry)
index.ts:32    await mcpManager.bootstrap()
                 └─ listEnabledMcpServerConfigs()        只取 enabled = true
                 └─ Promise.all(每个 server 并发)
                      └─ runServerExclusive(id, () => connectServer(server))
```

`bootstrap()`（`manager.ts:242`）对单个 server 的失败只 `logger.warn`，不 rethrow——一个 MCP server 起不来不能阻断整个服务启动。

`connectServer()`（`manager.ts:110`）的顺序很重要：

```
1. ensureSupportedTransport(transport)        非 stdio 直接抛错
2. 写 DB: status = "connecting"
3. resolveLaunchSpec(server)                  可能改写 command/args（§9）
4. createStdioMcpClient({...})                ← 只造对象，不 spawn
5. await client.connect()                     ← 这里才 spawn 子进程
6. await client.listTools()
7. await syncMcpTools(...)                    落库
8. runtimes.set(id, { client, config })       ← 全部成功后才登记
9. 写 DB: status = "connected" + last_seen_at
10. await rebuildRegistry()
```

第 4 步和第 5 步分离是刻意的：`createStdioMcpClient` 是纯工厂，只闭包住参数和回调。**任何一步抛错都走 catch**（`manager.ts:187`）：`client.close()` → 写 `status: "error"` + `last_error` → rethrow，**不会进 `runtimes`**。

由此得到一条不变式：

> `runtimes` 里的每个 client 都已完成握手、可以直接 `callTool`。不存在半初始化状态。

这就是 `rebuildRegistry` 里只需判断 `runtimes.get()` 存不存在、不用再查连接状态的原因。

### 4.2 工具发现与持久化

`client.listTools()`（`stdio-client.ts:399`）会**自动翻页**——循环发 `tools/list`，直到响应里没有 `nextCursor`。

`normalizeDiscoveredTools()`（`manager.ts:64`）把远端工具映射成入库结构，核心是 `local_name` 的生成（`db/mcp.ts:195`）：

```
mcp__kimtaeyoon83__get_transcript_53e6d9
└──┘ └──────────┘  └────────────┘ └────┘
 前缀  slug(≤12)     remote_name    sha1(slug:remote) 前 6 位
```

哈希后缀不是装饰：slug 截断到 12 字符、remote_name 也可能被截断（`maxRemoteLength = max(6, 49 - 前缀长度 - 7)`），截断后可能撞名，哈希保证唯一。整体压在 49 字符内是为了迁就各家 LLM API 对 tool name 的长度限制。

`syncMcpTools()`（`db/mcp.ts:347`）在**一个事务**里做两件事：

1. 按 `[serverId, remoteName]` upsert 每个发现到的工具，刷新 `last_seen_at`
2. `deleteMany` 删掉本次没出现的工具（远端下线的工具会被清理）

注意第 2 步的语义：**远端删掉一个工具，本地记录就没了，用户之前对它设的 `enabled` 开关也一并丢失**。工具再上线会以 `enabled: true`（默认值）重新出现。

### 4.3 注册表重建

`rebuildRegistry()`（`manager.ts:80`）：

```
activeServerIds = [...runtimes.keys()]        内存里当前活着的
  ↓ 空则直接 swap({tools: []})
listEnabledMcpBindings(activeServerIds)       DB 查询
  条件: tool.enabled = true AND server.enabled = true
  ↓
逐条二次检查 runtimes.get(binding.server_id)   ← manager.ts:91
  ↓
createMcpToolSnapshotItem(binding, client)
  ↓
registry.swap({ tools })                      整体原子替换
```

**为什么要二次检查**：`listEnabledMcpBindings` 是一次异步 DB 查询，查询期间某个 server 可能刚好断开并从 `runtimes` 里删除。没有这个检查就会把已死进程的工具塞进快照，模型调用时才发现进程没了。

**为什么是整体 swap 而不是增删**：`ToolRegistry` 的快照语义（`tools/registry.ts:11`）——正在跑的对话读到的永远是某个完整快照，不会出现「遍历到一半工具列表变了」。

三个位置会触发重建：连接成功、`onClose` 回调、工具/服务的 enable/disable。

### 4.4 模型调用工具

```
LLM 返回 tool_call: "mcp__kimtaeyoon83__get_transcript_53e6d9"
  ↓
runner.ts executeToolCall → tools.execute(name, args, ctx)
  ↓
composite-registry.ts:47 findToolOwner()      线性扫描各子 registry 快照
  ↓
mcpToolRegistry.execute()
  ↓
tool-adapter.ts:31  client.callTool(remote_name, args, ctx.signal)
                    注意：这里用回 remote_name，local_name 只对模型可见
  ↓
stdio-client.ts:419 runExclusive → request("tools/call", {...}, signal)
  ↓
写子进程 stdin: {"jsonrpc":"2.0","id":N,"method":"tools/call",...}\n
  ↓
子进程 stdout 返回 → 行分帧 → handleMessage → 按 id 配对 resolve
  ↓
mapContentBlocks() 把 MCP content 转成 agent 的 TextContent/ImageContent
  ↓
isError === true → tool-adapter 抛错 → runner 把错误回灌给模型
```

`composite-registry` 的注册顺序即优先级（`ai.ts:132`）：

```
localToolRegistry → mcpToolRegistry → scheduler → heartbeat → skillRuntime
```

同名工具只保留第一个，所以 **MCP 工具无法覆盖内置工具**——这是有意的防护。

`mapContentBlocks()`（`stdio-client.ts:78`）只认 text 和 image 两种 block，`resource`/`resource_link` 降级成 `[resource: uri]` 文本，其余降级成 `[unsupported MCP content: type]`。空结果兜底为 `[empty MCP result]`，不会返回空数组。

### 4.5 断连、热更新与关停

**子进程意外退出** → `stdio-client.ts:266` 的 `exit` 监听 → `handleClose()` → 拒绝所有 pending 请求 → 回调 `options.onClose(error)` → `manager.ts:136`：

```
runServerExclusive(id, async () => {
  if (!runtimes.has(id)) return;          幂等保护
  runtimes.delete(id);
  写 DB: status = "error", last_error = <stderr 尾部或退出码>
  await rebuildRegistry();                该 server 的工具从模型视野里消失
})
```

错误信息优先取 stderr 的**最后 8000 字符**（`stdio-client.ts:259` 滚动截断），这是排查 MCP server 启动失败最有用的线索。

**远端工具列表变化** → MCP 通知 `notifications/tools/list_changed` → `handleMessage` 分支（`stdio-client.ts:222`）→ `onToolsListChanged` → `refreshServerInternal()`：先 `closeRuntime()` 再完整重连一次（重新发现 + 重新落库 + 重建注册表）。

**优雅关停**（`index.ts:161`，在 scheduler 之后、runtime 之前）：`shutdown()` 先 `registry.swap({tools: []})` 清空注册表，再逐个 `closeRuntime()` → `SIGTERM`。先清空注册表是为了避免关停过程中还有对话拿到即将被杀的 client。

## 5. 并发模型：三层串行化

这是整个子系统最容易看漏的部分，三层各管一件事：

| 层 | 位置 | 保护什么 |
|---|---|---|
| 每 server 操作队列 | `manager.ts:218` `runServerExclusive` | 同一 server 的 connect/refresh/disable/onClose 不交错 |
| 每 client 请求队列 | `stdio-client.ts:314` `runExclusive` | 同一子进程的 `listTools`/`callTool` 串行发送 |
| 注册表原子替换 | `tools/registry.ts:11` `swap` | 正在运行的对话读到完整快照 |

`runServerExclusive` 用 promise 链实现，且 `previous.then(operation, operation)` 前后都传了 `operation`——**前一个操作失败也要执行下一个**，不会因为一次连接失败就卡死该 server 的所有后续操作。

第二层还有一道防线：`connect()` 开头 `if (child) throw new Error("MCP client is already connecting")`。

**注意第二层的影响**：`callTool` 是全局串行的。同一个 MCP server 上的两个工具调用不能并行，即使 runner 侧是 `Promise.all` 并发发起的。工具耗时长时这是真实的吞吐瓶颈。

## 6. 协议细节

- **协议版本**：客户端声明支持 `2025-11-05` / `2025-06-18` / `2025-03-26` / `2024-11-05`（`stdio-client.ts:10`），握手时发第一个，服务端返回的版本不在列表里就报错断开。
- **分帧**：换行分隔的 JSON，`stdout` 按 `\n` 切分（`stdio-client.ts:234`）。**畸形行被静默跳过**，不关闭连接——很多 MCP server 会往 stdout 打印非协议日志，这个容错是必要的。
- **握手超时**：30 秒（`CONNECT_TIMEOUT_MS`），超时直接 `SIGTERM`。注意这个超时**只覆盖 `initialize`**，`listTools` 和 `callTool` 没有独立超时，靠调用方传 `AbortSignal`。
- **取消**：`request()` 支持 `AbortSignal`，abort 时从 `pending` 里摘除并 reject。但**不会给子进程发 JSON-RPC cancel 通知**——远端仍在执行，只是结果被丢弃。
- **请求配对**：自增 `nextId`，`pending: Map<id, {resolve, reject}>`。

## 7. API 与 Web 管理台

`api/routes/mcp.ts:202` 注册 12 个端点：

```
GET    /api/mcp/servers            POST   /api/mcp/servers
GET    /api/mcp/servers/:id        PATCH  /api/mcp/servers/:id
DELETE /api/mcp/servers/:id
POST   /api/mcp/servers/:id/refresh | /enable | /disable
GET    /api/mcp/tools
POST   /api/mcp/tools/:id/enable | /disable
```

全部走 `/api/*` 的 JWT 中间件（`api/index.ts:98` 在路由注册之前）。

写操作的共同模式是**先写 DB、再调和运行时**，且调和过程包在 `runServerExclusive` 里。`createServer` 的连接失败被 `.catch(() => undefined)` 吞掉（`manager.ts:280`）——创建本身成功，连接状态通过 `status`/`last_error` 字段回给前端，不让一个连不上的配置导致创建接口 500。

## 8. `runtimes` 是什么

`manager.ts:77` 的 `Map<serverId, { client, config }>`，是「当前哪些 MCP server 活着」的**唯一内存事实源**：

- **进入**：只在 `connectServer` 全部成功后（`manager.ts:180`）
- **移出**：`closeRuntime()`（主动）或 `onClose` 回调（被动）
- **读取**：`rebuildRegistry()` 决定哪些工具进注册表

数据库里的 `status` 字段是它的**投影**，给 Web 后台看的；真正决定模型能调用哪些工具的是 `runtimes` + `enabled` 两个条件的交集。两者理论上可能短暂不一致（比如进程刚死、DB 还没写完），`rebuildRegistry` 的二次检查就是为此存在。

## 9. hubResolver：一个必要的丑陋特例

`hubResolver.ts` 处理的是 mcp-cn.com 注册表的数据质量问题：它返回的 `connections` 字段是 **key/value 无引号的非法 JSON 字符串**，而 `@mcp_hub_org/cli` 自己没做容错，会在 `connections.filter()` 处崩溃。

`resolveLaunchSpec()`（`hubResolver.ts:116`）在 spawn 之前介入：

1. `detectHubRun()` 检测 args 里是否含 `@mcp_hub_org/cli` 且后面跟着 `run <qualifiedName>`（不限定 command，npx/pnpm dlx/bunx 都可能）
2. 命中则请求 `MCP_REGISTRY_ENDPOINT/servers/get_details`
3. `parseConnections()` 先试标准 `JSON.parse`，失败则用正则从损坏字符串里抠出 stdio 配置
4. `pickStdioConnection()` 镜像 hub CLI 的选取逻辑：优先 `npx`/`uvx`/`docker`，否则取第一个 stdio
5. 返回底层真实命令，**用户自定义的 env 覆盖解析得到的 env**

命中时日志会打「已将 @mcp_hub_org/cli 配置解析为底层真实命令」。不命中则原样透传，零开销。

这段代码的存在完全取决于上游数据质量，上游修好后可以整个删掉。

## 10. 已知边界与风险

| 问题 | 位置 | 说明 |
|---|---|---|
| **无账号维度权限** | `ai.ts:132` | `mcp_tools.enabled` 是**全局开关**。一个 MCP server 接进来，所有微信号的所有联系人都能通过 prompt injection 触发它。架构评审 H2。 |
| **单进程假设** | `manager.ts:77` | `runtimes` 是内存 Map。起两个 server 实例会各自 spawn 一份子进程，DB 里的 `status` 会互相覆盖。 |
| **只支持 stdio** | `manager.ts:58` | SSE / streamable HTTP 均未实现，`ensureSupportedTransport` 直接抛错。 |
| **composite 线性查找** | `composite-registry.ts:47` | 每次 `execute` 都要扫全部子 registry 的快照，MCP 工具多后是每次调用 O(N)。架构评审 M4。 |
| **同 server 工具调用串行** | `stdio-client.ts:314` | `runExclusive` 让同一子进程的调用排队，长耗时工具会阻塞同 server 的其它调用。 |
| **input_schema 直接透传模型** | `tool-adapter.ts:29` | 远端 schema 未经校验就 `jsonSchema()` 转换喂给 AI SDK，畸形 schema 的影响取决于 SDK 的容错。 |
| **远端下线即丢用户配置** | `db/mcp.ts:381` | `syncMcpTools` 的 `deleteMany` 会连同用户设的 `enabled` 状态一起删掉。 |
| **abort 不通知远端** | `stdio-client.ts:297` | 取消只在本地丢弃结果，子进程仍在执行。 |

## 11. 排查指引

**工具没出现在模型视野里**，按顺序查：

1. `mcp_servers.enabled` = true？
2. `mcp_servers.status` = `connected`？不是的话看 `last_error`
3. `mcp_tools.enabled` = true？
4. 上面都对但仍没有 → server 在 `runtimes` 里吗（进程可能刚死，日志搜 "MCP 连接关闭"）
5. 工具名是否和内置工具重名被 composite 跳过（日志搜 `tool name conflict`）

**连接失败**：`last_error` 存的是 stderr 尾部 8000 字符，通常直接给出原因（命令不存在、依赖缺失、鉴权失败）。

**工具调用报错**：`tool-adapter.ts:33` 的 `stringifyToolError` 会把 MCP 返回的 `isError` 内容拼成错误消息回灌给模型，trace span 里能看到。
