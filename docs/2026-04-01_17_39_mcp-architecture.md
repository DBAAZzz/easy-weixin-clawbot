# MCP Tools 接入架构（已实现版）

> 当前项目已经支持以全局共享方式接入外部 `stdio` MCP Server，把远端 tools 暴露给微信 Agent，并通过 Web 后台管理。

## 目标

MCP 接入解决的是三件事：

1. 让 server 进程可以常驻连接多个外部 `stdio` MCP Server
2. 把远端发现到的 tools 映射成当前 Agent 可执行的本地虚拟 tool
3. 让 Web 后台可以查看、创建、编辑、启停和刷新这些 MCP 配置

当前实现明确只覆盖：

- `stdio` transport
- `tools` 能力
- 全局共享配置
- 单管理员信任模型

不覆盖：

- per-account MCP 配置
- resources / prompts
- HTTP / SSE transport
- 多租户隔离

---

## 包结构

```text
packages/
├── agent/
│   └── src/
│       ├── tools/
│       │   └── composite-registry.ts -- 组合本地 tools + MCP tools
│       └── mcp/
│           ├── types.ts              -- 通用 MCP types
│           ├── stdio-client.ts       -- stdio MCP client
│           └── tool-adapter.ts       -- 远端 tool -> ToolSnapshotItem
├── server/
│   └── src/
│       ├── db/
│       │   └── mcp.ts                -- MCP 配置/目录持久化
│       ├── mcp/
│       │   └── manager.ts            -- 生命周期、连接、目录刷新
│       └── api/routes/
│           └── mcp.ts                -- MCP REST API
├── shared/
│   └── src/types.ts                  -- McpServerInfo / McpToolInfo
└── web/
    └── src/
        ├── lib/mcp-form.ts           -- 标准 mcpServers JSON 解析/序列化
        ├── hooks/useMcp.ts           -- MCP 页面数据访问
        └── pages/McpPage.tsx         -- MCP 配置与目录管理页
```

---

## 总体设计

### 1. 双 registry 模型

当前 Agent 并没有把 MCP tools 直接塞进已有本地 tool 安装体系，而是保留两套来源：

- `localToolRegistry`：Markdown / builtin tools
- `mcpToolRegistry`：运行时从 MCP Server 动态发现的 tools

然后通过 [packages/agent/src/tools/composite-registry.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/agent/src/tools/composite-registry.ts) 合并为一个统一的 `toolRegistry`，供 `createAgentRunner()` 使用。

这样做的结果是：

- 本地 tool 系统保持不动
- MCP tools 可以独立热更新
- 远端连接断开时，只移除 MCP 那部分 snapshot

### 2. 分层原则

当前实现已经按下面的边界拆开：

- `agent` 负责通用 MCP 执行层
  - MCP 协议 client
  - 远端 tool 元数据类型
  - 远端 tool 到 `ToolSnapshotItem` 的适配
- `server` 负责宿主编排层
  - 配置持久化
  - runtime 生命周期管理
  - API 与 Web 管理台
  - 启停、刷新、状态回写

这样做的原因是：MCP 协议执行本身是 agent 能力，配置管理和进程调度才是具体应用宿主职责。

### 3. server 进程内共享连接

[packages/server/src/index.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/server/src/index.ts) 启动时会创建 `mcpManager` 并执行 `bootstrap()`。每个已启用的 MCP Server 在主进程里只维护 1 个共享 runtime，不按账号、不按会话重复拉起。

### 4. 远端 tools 映射为本地虚拟 tools

MCP Server 返回的远端 tool 会被持久化到 `mcp_tools` 表，并在运行时转换成 `ToolSnapshotItem`。

映射规则：

- `remote_name`：远端 tool 原名
- `local_name`：本地唯一虚拟名
- `input_schema`：远端 JSON schema，直接作为 Agent tool 参数 schema

当前 `local_name` 的真实实现不是纯 `mcp__<slug>__<name>`，而是：

```text
mcp__<server_slug>__<remote_tool_name>_<hash>
```

这样可以在远端名字过长或冲突时仍然保证唯一性。

---

## 数据模型

Prisma schema 在 [packages/server/prisma/schema.prisma](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/server/prisma/schema.prisma)。

### 1. `McpServer`

用于持久化配置和连接状态：

- `id`
- `name`
- `slug`
- `transport`
- `command`
- `argsJson`
- `envJson`
- `cwd`
- `enabled`
- `status`
- `lastError`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

`enabled` 默认 `true`，`status` 默认 `disconnected`。

### 2. `McpTool`

用于缓存工具目录和保留 tool 级开关：

- `id`
- `serverId`
- `remoteName`
- `localName`
- `summary`
- `inputSchema`
- `enabled`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

约束：

- `(serverId, remoteName)` 唯一
- `localName` 唯一

### 3. shared 类型

[packages/shared/src/types.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/shared/src/types.ts) 暴露了：

- `McpTransport`
- `McpServerStatus`
- `McpServerInfo`
- `McpToolInfo`

这些类型只描述 MCP 域本身，不和现有 `ToolInfo` 混用。

---

## Agent 侧 MCP 执行层

### 1. `stdio-client`

[packages/agent/src/mcp/stdio-client.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/agent/src/mcp/stdio-client.ts) 负责：

- 拉起外部 `stdio` 进程
- 完成 MCP 初始化
- `listTools()`
- `callTool()`
- 监听进程关闭和 tools 目录变化

当前返回内容首版只落到现有 Agent 能消费的 `text/image`。

### 2. `tool-adapter`

[packages/agent/src/mcp/tool-adapter.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/agent/src/mcp/tool-adapter.ts) 负责把 MCP 远端 tool 绑定转换成 Agent 可执行的 `ToolSnapshotItem`。

它不依赖 server 的 DB 层类型，只依赖一组通用的 MCP binding 字段。

如果 MCP 返回 `isError`，adapter 会把内容合并成错误文本后抛出，让 Agent 按现有 tool error 路径处理。

---

## Server 侧宿主编排层

### 1. `manager`

[packages/server/src/mcp/manager.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/server/src/mcp/manager.ts) 是 MCP 域的宿主协调器。

职责：

- 启动时连接所有 enabled servers
- 把远端 tools 同步到 DB
- 维护 `serverId -> runtime client` 映射
- 根据运行时状态重建 `mcpToolRegistry`
- 暴露 Web/API 需要的 CRUD、enable/disable、refresh 能力

### 2. 并发控制

同一个 server 的所有操作都经由 `runServerExclusive()` 串行化，避免多账号或多请求并发时打乱 stdio 帧、重复刷新或交叉关闭连接。

### 3. 故障恢复

当 MCP Server 异常退出时：

- runtime 从内存 map 中移除
- DB 中 `status` 更新为 `error`
- `lastError` 回写
- `mcpToolRegistry` 重新构建，把该 server 对应的 MCP tools 从 Agent 暴露目录中移除

数据库中的 server/tool 记录不会被清掉，方便后台观察和手动恢复。

---

## Agent 侧执行链路

当前接入点在 [packages/server/src/ai.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/server/src/ai.ts)。

链路如下：

```text
localToolRegistry
      +
mcpToolRegistry
      ↓
createCompositeToolRegistry(...)
      ↓
toolRegistry
      ↓
createAgentRunner(..., toolRegistry, skillRegistry)
```

MCP tool 真正执行时会经过 [packages/agent/src/mcp/tool-adapter.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/agent/src/mcp/tool-adapter.ts)：

1. 取到本地虚拟 tool 名
2. 反查其绑定的 `remote_name`
3. 调用对应 runtime client 的 `callTool()`
4. 把返回结果转换成 Agent 期望的 tool content

真正的 stdio 调用由 [packages/agent/src/mcp/stdio-client.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/agent/src/mcp/stdio-client.ts) 完成。

---

## API 设计

路由在 [packages/server/src/api/routes/mcp.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/server/src/api/routes/mcp.ts)。

当前提供：

- `GET /api/mcp/servers`
- `POST /api/mcp/servers`
- `GET /api/mcp/servers/:id`
- `PATCH /api/mcp/servers/:id`
- `DELETE /api/mcp/servers/:id`
- `POST /api/mcp/servers/:id/refresh`
- `POST /api/mcp/servers/:id/enable`
- `POST /api/mcp/servers/:id/disable`
- `GET /api/mcp/tools`
- `POST /api/mcp/tools/:id/enable`
- `POST /api/mcp/tools/:id/disable`

### 创建/更新 payload

当前后端同时支持两种写法：

#### 1. 扁平字段写法

```json
{
  "name": "filesystem",
  "slug": "filesystem",
  "transport": "stdio",
  "command": "npx",
  "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  "env": {},
  "cwd": null
}
```

#### 2. 标准 `mcpServers` 文档

```json
{
  "mcpServers": {
    "mcp-server-tapd": {
      "command": "uvx",
      "args": ["mcp-server-tapd"],
      "env": {
        "TAPD_API_BASE_URL": "https://api.tapd.cn"
      }
    }
  }
}
```

当前标准文档模式下有两个约束：

- 一次只能导入 1 个 server
- `mcpServers` 的 key 会作为 `name`
- `slug` 由 key 自动派生

---

## Web 管理台

当前页面在 [packages/web/src/pages/McpPage.tsx](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/web/src/pages/McpPage.tsx)。

### 页面模型

MCP 页已经对齐 `ToolsPage` 的交互骨架：

- 列表优先
- 点击 server 卡片打开详情弹窗
- 新建/编辑走独立 modal
- 列表层保留启停和快速浏览

### JSON 输入模式

创建和编辑不再拆成 `name / slug / command / args / env / cwd` 多字段表单，而是直接粘贴标准 MCP JSON。

辅助逻辑在 [packages/web/src/lib/mcp-form.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/web/src/lib/mcp-form.ts)：

- `TAPD_MCP_JSON_EXAMPLE`：页面内置示例
- `parseMcpServerJsonText()`：解析标准文档
- `stringifyMcpServerJsonDocument()`：把已存配置重新输出为标准文档

因此 Web 详情页和编辑器展示的是同一套格式，不再出现“后台要求一套字段，文档示例又是另一套格式”的分裂。

---

## 数据流

```text
Web McpPage
  → POST/PATCH /api/mcp/servers
  → McpManager.createServer/updateServer
  → DB 持久化 McpServer
  → 建立/重建 stdio runtime
  → listTools()
  → syncMcpTools()
  → rebuildRegistry()
  → mcpToolRegistry.swap(...)
  → CompositeToolRegistry 合并
  → AgentRunner 后续可直接调用
```

tool 调用流：

```text
LLM 选中 local_name
  → CompositeToolRegistry.execute()
  → mcpToolRegistry.execute()
  → agent/mcp/tool-adapter
  → agent/mcp/stdio-client.callTool(remote_name, args)
  → MCP result
  → ToolResultMessage
```

---

## 已覆盖测试

当前至少覆盖了以下 MCP 相关测试：

- [packages/agent/src/tools/composite-registry.test.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/agent/src/tools/composite-registry.test.ts)
- [packages/agent/src/mcp/stdio-client.test.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/agent/src/mcp/stdio-client.test.ts)
- [packages/agent/src/mcp/tool-adapter.test.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/agent/src/mcp/tool-adapter.test.ts)
- [packages/server/src/api/routes/mcp.test.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/server/src/api/routes/mcp.test.ts)
- [packages/web/src/lib/mcp-form.test.ts](/Users/mac/Documents/workspace/DBAA/微信clawbot-agent/packages/web/src/lib/mcp-form.test.ts)

这些测试覆盖了：

- 组合 registry 的合并和执行
- stdio client 的基本行为
- MCP tool adapter 的映射逻辑
- API 路由读取和标准 JSON 创建
- Web JSON helper 的解析与序列化

---

## 当前限制与后续演进

### 当前限制

- 仅支持 `stdio`
- 仅支持 `tools`
- Web 标准 JSON 一次只导入一个 server
- 未做 secrets 专用存储，`env` 直接持久化在数据库
- 仍然是全局共享 MCP，不区分账号或会话

### 可演进方向

1. 增加 HTTP / SSE transport
2. 支持 `resources` / `prompts`
3. 引入 secrets 管理，避免明文环境变量持久化
4. 支持批量导入多个 `mcpServers`
5. 支持按账号或按 workspace 的 MCP 暴露策略

---

## 实施结论

当前 MCP 实现采用的是“独立 MCP 域 + ToolRegistry 合并层”的方案：

- 数据与连接管理留在 `server`
- tool 暴露边界留在 `agent`
- 后台配置与观察留在 `web`

这个分层已经能满足当前项目的核心诉求：MCP Server 故障不会拖垮本地 tools，MCP tools 又能像普通 tool 一样被 Agent 透明调用。
