# MCP 工具注册流程

## 核心思路

MCP 的本质是：**把外部进程暴露的 tools，映射成 Agent 可以直接调用的本地虚拟 tool**。

整个系统分三层：
- `agent` 层：MCP 协议执行（stdio 通信、tool 绑定）
- `server` 层：生命周期管理、持久化、API
- `web` 层：配置管理 UI

---

## 注册流程

```
MCP Server 进程（外部）
    │
    │  stdio  JSON-RPC 2.0
    ▼
StdioMcpClient.connect()
    │  发送 initialize 握手，协商协议版本
    │  30s 超时，失败则 SIGTERM
    ▼
StdioMcpClient.listTools()
    │  发送 tools/list 请求
    │  返回 [{ name, description, inputSchema }]
    ▼
normalizeDiscoveredTools()
    │  生成 local_name = mcp__<slug>__<remote_name>_<6位hash>
    │  hash 防止不同 server 同名 tool 冲突
    ▼
syncMcpTools()  →  DB mcp_tools 表
    │  upsert 每条 tool（以 serverId + remoteName 为唯一键）
    │  删除本次未见到的旧 tool
    ▼
rebuildRegistry()
    │  从 DB 读取所有 enabled 的 binding
    │  二次校验 runtime 仍存在（防竞态）
    ▼
createMcpToolSnapshotItem(binding, client)
    │  构造 ToolSnapshotItem：
    │    name        = binding.local_name
    │    description = binding.summary
    │    parameters  = binding.input_schema  （直接用远端 JSON Schema）
    │    execute     = (args, ctx) => client.callTool(binding.remote_name, args, ctx.signal)
    ▼
mcpToolRegistry.swap({ tools })
    │  原子替换快照，Agent 下次执行时自动拿到新列表
    ▼
CompositeToolRegistry.current()
    │  合并 localToolRegistry + mcpToolRegistry
    │  同名时本地优先，冲突会打印 warn
    ▼
AgentRunner
    执行时调用 CompositeToolRegistry.execute(local_name, args, ctx)
        → 找到所属 registry（mcp）
        → tool-adapter 调 client.callTool(remote_name, args)
        → stdio 发送 tools/call 请求
        → 返回 content 给 LLM
```

---

## 关键设计

### local_name 命名规则

```
mcp__<server_slug>__<remote_tool_name>_<sha1前6位>
```

例：`mcp__filesystem__read_file_a3b2c1`

slug 最长 21 字符，由 server name 自动派生（转小写、去特殊字符）。

### swap 模型

`ToolRegistry` 持有一个快照对象，`swap()` 原子替换它。
Agent 每次执行前调 `current()` 拿最新快照，所以 MCP server 断线/重连/工具变更后，无需重启 Agent 即可生效。

### 串行队列（runServerExclusive）

同一个 server 的所有操作（connect、refresh、enable/disable）都经过串行队列，
防止并发操作交叉写 stdio 帧或重复刷新。

### 故障处理

| 事件 | 处理 |
|------|------|
| connect 超时 | SIGTERM 进程，status → error |
| connect 失败 | status → error，不影响其他 server |
| 运行中进程退出 | 从 runtimes 移除，status → error，rebuildRegistry 移除对应 tool |
| JSON 解析失败 | 跳过畸形行，不关闭连接 |
| shutdown | 先清空 registry（Agent 立即停止调用），再逐个关闭进程 |

---

## 文件索引

| 文件 | 职责 |
|------|------|
| `packages/agent/src/mcp/stdio-client.ts` | stdio 进程管理、JSON-RPC 通信 |
| `packages/agent/src/mcp/tool-adapter.ts` | 远端 tool → ToolSnapshotItem |
| `packages/agent/src/mcp/types.ts` | MCP 相关类型定义 |
| `packages/agent/src/tools/composite-registry.ts` | 合并多个 ToolRegistry |
| `packages/server/src/mcp/manager.ts` | 生命周期、连接、刷新、registry 重建 |
| `packages/server/src/db/mcp.ts` | DB 持久化（McpServer / McpTool） |
| `packages/server/src/api/routes/mcp.ts` | REST API |
| `packages/server/prisma/schema.prisma` | McpServer / McpTool 数据模型 |
| `packages/shared/src/types.ts` | McpServerInfo / McpToolInfo 共享类型 |
| `packages/web/src/pages/McpPage.tsx` | Web 管理页面 |
| `packages/web/src/lib/mcp-form.ts` | 标准 mcpServers JSON 解析/序列化 |
| `packages/web/src/hooks/useMcp.ts` | Web 数据访问 hook |
