# 记忆网络图可视化 — 设计方案

> 阶段目标：基于现有 Tape 数据（零数据模型改动），通过共现推导 + Key 前缀聚类生成记忆网络图，前端可视化展示。

## 1. 背景

当前 Tape 记忆系统中，用户的记忆以扁平 key-value 形式存储在 `TapeState`（facts / preferences / decisions）中。用户无法直观感知 agent 对自己了解了什么、这些信息之间有什么联系。

记忆网络图的目标是将这些离散的记忆条目以图（Graph）的形式可视化，帮助用户/运营快速理解记忆全貌。

### 与 Anchor DAG 的区别

| | Anchor DAG | 记忆网络图 |
|---|---|---|
| 节点 | Anchor（状态快照） | Fact / Preference / Decision |
| 边 | 继承/演化关系（predecessors） | 语义关联（共现 / 前缀聚类） |
| 受众 | 开发者 / 运维 | 终端用户 / 运营 |
| 已有 | 已有（`tape_anchors.predecessors`） | 需要新建 |

Anchor DAG 是基础设施层面的状态快照血缘图，不面向用户。记忆网络图是内容层面的语义关联图。

## 2. 数据来源 — 零改动方案

不修改 `tape_entries` / `tape_anchors` 表结构，不修改 `extractor.ts` 的提取 prompt。所有图数据在 API 层实时计算。

### 2.1 节点定义

每条 fold 后的记忆对应一个节点：

```typescript
interface GraphNode {
  id: string;           // key（fact/preference 的 key，或 decision 的 sourceEid）
  label: string;        // 显示文本
  category: "fact" | "preference" | "decision";
  value: unknown;       // 记忆值
  confidence?: number;  // fact 才有
  scope: "global" | "session";
  sourceEid: string;    // 溯源到原始 entry
  updatedAt: string;    // 最后更新时间
}
```

**节点数量预估**：单用户通常 20~200 个记忆条目，前端渲染无压力。

### 2.2 边定义 — 两种推导策略

#### 策略 A：共现关系（Co-occurrence）

同一次 `fireExtractAndRecord` 产生的多条记忆天然相关——它们来自同一轮对话。

**推导规则**：
- 查询 `tape_entries`，按 `(accountId, branch, createdAt)` 分组
- 同一秒（或 2 秒窗口内）创建的条目视为同一批提取
- 同批内的节点两两连边，边类型为 `co_occurrence`

```typescript
interface GraphEdge {
  source: string;       // 源节点 id
  target: string;       // 目标节点 id
  type: "co_occurrence" | "prefix_cluster";
  weight: number;       // 边权重（共现次数或相似度）
}
```

**权重计算**：如果两个 key 在多个批次中反复共现，权重累加。权重越高，关联越强。

**示例**：
```
用户说："我叫 Alice，在北京做数据科学家"
提取出：[姓名: Alice] [城市: 北京] [职业: 数据科学家]
→ 三者两两连边（共 3 条边），weight = 1

后续对话再次同时提到"北京"和"数据科学家"
→ [城市] ↔ [职业] 的 weight 增加到 2
```

#### 策略 B：Key 前缀聚类（Prefix Clustering）

如果 key 命名具有层级结构（如 `工作.公司`、`工作.职位`），可自动聚类。

**推导规则**：
- 以 `.` 或 `/` 作为分隔符解析 key
- 共享前缀的 key 之间建立 `prefix_cluster` 边
- 前缀本身成为一个虚拟的**组节点**（仅用于视觉聚合，不对应实际记忆）

```typescript
interface GroupNode {
  id: string;           // 前缀（如 "工作"）
  label: string;
  type: "group";        // 区别于记忆节点
  children: string[];   // 子节点 id 列表
}
```

**示例**：
```
Keys: ["工作.公司", "工作.职位", "工作.城市", "家庭.配偶", "家庭.子女"]
→ 生成 2 个 group: "工作"(3 children), "家庭"(2 children)
→ 组内节点之间自动连边
```

**注意**：当前的 extractor prompt 没有强制要求层级 key。实际效果取决于 LLM 的提取行为。前缀聚类作为**增强策略**，无匹配时静默退化。

### 2.3 合并策略

两种边可以共存于同一张图中。渲染时：
- `co_occurrence` 边用**实线**，颜色按 weight 深浅
- `prefix_cluster` 边用**虚线**，表示结构关系
- 孤立节点（无边）正常显示，不隐藏

## 3. API 设计

新增一个 API endpoint，实时计算并返回图数据。

### 3.1 接口定义

```
GET /api/tape/graph?accountId={accountId}&branch={branch}
```

**Query 参数**：

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| accountId | string | 是 | 账号 ID |
| branch | string | 否 | 分支，默认 `__global__`，传 `*` 合并所有分支 |

**Response**：

```typescript
interface TapeGraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
  groups: GroupNode[];       // 前缀聚类组（可能为空）
  meta: {
    accountId: string;
    branch: string;
    totalEntries: number;    // 原始 entry 总数
    generatedAt: string;     // ISO timestamp
  };
}
```

### 3.2 后端计算流程

```
GET /api/tape/graph?accountId=xxx
│
├─ 1. recall(accountId, branch) → TapeState
│     获取 fold 后的当前状态，生成 nodes[]
│
├─ 2. findEntries(accountId, branch) → TapeEntryRow[]
│     获取原始 entries（需要 createdAt 做共现分组）
│
├─ 3. 共现分组
│     按 createdAt 的 2 秒窗口分组
│     同组内 entries 的 key 两两配对 → co_occurrence edges
│     相同 pair 多次出现 → weight 累加
│
├─ 4. 前缀聚类
│     扫描所有 node.id，按 `.` 分割
│     共享前缀的 key 归入同一 group
│     组内节点两两配对 → prefix_cluster edges
│
└─ 5. 返回 { nodes, edges, groups, meta }
```

### 3.3 性能考量

| 因素 | 分析 |
|------|------|
| 节点数 | 单用户 20~200，O(n) 遍历无压力 |
| 边数 | 共现：O(batch × C(k,2))，k 为批次内条目数（通常 1~5）；前缀：O(groups × C(g,2)) |
| Entry 查询 | 已有索引 `idx_tape_branch_created`，毫秒级 |
| 缓存 | 第一版不做缓存；如果后续有性能问题，可对 graph 结果做短时缓存（TTL 60s） |

## 4. 前端可视化技术选型

### 4.1 当前前端技术栈

- React 19 + Vite 8 + TailwindCSS 4
- 无现有图表/可视化依赖
- 页面结构：SPA，sidebar 导航 + 内容区

### 4.2 候选方案对比

| 方案 | 包大小(gzip) | 学习成本 | 交互能力 | React 集成 | 适合场景 |
|------|-------------|----------|----------|-----------|---------|
| **@antv/g6** | ~150KB | 中 | 强（布局算法丰富） | 一般（需封装） | 复杂图分析 |
| **react-force-graph-2d** | ~40KB | 低 | 中（力导向） | 原生 React | 简单力导向图 |
| **reactflow** | ~60KB | 低 | 强（拖拽/缩放） | 原生 React | 流程图/节点编辑器 |
| **D3 force** (手写) | ~30KB(d3子包) | 高 | 完全自定义 | 需手动桥接 | 极致定制 |
| **@sigma/react** | ~50KB | 中 | 强（大图优化） | React binding | 大规模图（1000+） |

### 4.3 推荐：react-force-graph-2d

**理由**：

1. **包体小**（~40KB gzip），不显著增加 bundle size
2. **零配置力导向布局**，天然适合记忆网络的"松散关联"展示
3. **原生 React 组件**，与现有技术栈无缝集成
4. **交互能力足够**：节点悬停、点击、拖拽、缩放
5. **节点数量匹配**：20~200 个节点是其最佳范围

```bash
npm install react-force-graph-2d
```

**备选**：如果后续需要更复杂的布局（树形、环形、分层等），可升级为 `@antv/g6`。

### 4.4 交互设计

```
┌─────────────────────────────────────────────────┐
│  Memory Graph              [Global ▾] [Refresh] │
│─────────────────────────────────────────────────│
│                                                 │
│        ● 姓名:Alice                             │
│       / \                                       │
│      /   \                                      │
│  ● 城市:北京 ─── ● 职业:数据科学家              │
│                    |                             │
│                    |                             │
│               ● 偏好:Python                      │
│                                                 │
│─────────────────────────────────────────────────│
│  Hover: 职业 = "数据科学家"                      │
│  Confidence: 0.95 | Source: chat | Global       │
│  Updated: 2026-04-05 14:30                      │
└─────────────────────────────────────────────────┘
```

**交互功能清单**：

| 功能 | 优先级 | 说明 |
|------|--------|------|
| 力导向自动布局 | P0 | 节点自动排布，边长反映关联强度 |
| 节点颜色区分 category | P0 | fact=蓝色，preference=绿色，decision=橙色 |
| 节点大小映射 | P1 | fact 按 confidence 映射大小；preference/decision 固定大小 |
| 悬停 tooltip | P0 | 显示完整 value、confidence、scope、更新时间 |
| 点击节点高亮关联 | P1 | 点击一个节点，高亮其所有邻居和连边 |
| 拖拽 & 缩放 | P0 | react-force-graph-2d 内置 |
| 前缀组折叠 | P2 | 组节点可展开/折叠其子节点 |
| 分支切换 | P1 | 下拉切换 `__global__` / 特定会话分支 |
| 搜索/过滤 | P2 | 按 key 或 value 模糊搜索，过滤显示 |

### 4.5 节点渲染规则

```typescript
// 颜色映射
const CATEGORY_COLORS = {
  fact: "#3B82F6",        // blue-500
  preference: "#10B981",  // emerald-500
  decision: "#F59E0B",    // amber-500
  group: "#6B7280",       // gray-500（前缀聚类组）
};

// 节点大小
function getNodeSize(node: GraphNode): number {
  if (node.category === "fact") {
    return 4 + (node.confidence ?? 1) * 8; // 4~12px
  }
  return 8; // preference / decision 固定
}

// 边样式
function getLinkStyle(edge: GraphEdge) {
  return {
    color: edge.type === "co_occurrence"
      ? `rgba(99,102,241,${0.2 + edge.weight * 0.15})`  // 实线，按 weight 透明度
      : "rgba(107,114,128,0.3)",                          // 虚线
    dashArray: edge.type === "prefix_cluster" ? [4, 2] : [],
    width: Math.min(1 + edge.weight * 0.5, 4),
  };
}
```

### 4.6 组件结构

```
packages/web/src/pages/MemoryGraphPage.tsx     ← 页面入口（路由注册）
packages/web/src/components/memory/
  ├── MemoryGraph.tsx       ← ForceGraph2D 封装，核心渲染组件
  ├── MemoryTooltip.tsx     ← 悬停提示框
  ├── MemoryLegend.tsx      ← 图例（颜色-类别对应关系）
  └── MemoryFilters.tsx     ← 分支切换 + 搜索/过滤控件
```

## 5. 数据流总览

```
┌──────────┐    GET /api/tape/graph     ┌──────────────┐
│  前端     │ ────────────────────────→  │  Server API  │
│  React    │                            │              │
│           │  ← { nodes, edges, ... }   │  1. recall() │
│  ForceGraph2D                          │  2. findEntries()
│  渲染节点+边                            │  3. 共现分组  │
└──────────┘                             │  4. 前缀聚类  │
                                         └──────────────┘
                                               ↓
                                         ┌──────────────┐
                                         │  PostgreSQL   │
                                         │  tape_entries │
                                         │  tape_anchors │
                                         └──────────────┘
```

## 6. 实施步骤

### Phase 1：后端 API（~2h）

1. 在 `packages/agent/src/tape/` 新增 `graph.ts`
   - 实现共现分组算法（2 秒窗口）
   - 实现前缀聚类算法
   - 组装 `TapeGraphResponse`
2. 在 `TapeStore` 接口中新增 `findAllEntries(accountId, branch)` 方法（不过滤 `afterDate`，返回包含 `createdAt` 的完整 entry 列表）
3. 在 server 注册 `GET /api/tape/graph` 路由

### Phase 2：前端页面（~3h）

1. `npm install react-force-graph-2d`
2. 实现 `MemoryGraphPage.tsx` + 组件
3. 在 Sidebar 添加导航入口
4. 实现节点着色、大小映射、tooltip

### Phase 3：交互增强（~2h）

1. 点击高亮邻居
2. 分支切换下拉
3. 搜索/过滤
4. 前缀组折叠（如果有前缀 key 的话）

## 7. 后续扩展方向（本期不做）

- **LLM 显式关系提取**：修改 extractor prompt，输出 `relations` 字段，生成因果/矛盾/补充等语义边
- **时间轴模式**：按 `updatedAt` 排列节点，展示记忆演化过程
- **记忆管理联动**：在图上右键删除/编辑记忆（依赖记忆管理界面的实现）
- **多账号对比视图**：并排展示两个账号的记忆图谱
