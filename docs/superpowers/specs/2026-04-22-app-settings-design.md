# App Settings 设计

## 背景

`packages/server/src/observability/service.ts` 当前在决定是否持久化普通 trace 时，将 `normalRate` 硬编码为 `0.1`。

这会带来两个产品层面的问题：

1. 采样率无法通过配置修改，只能改代码并重新部署。
2. 目前没有一个稳定的位置承载未来的全局运行时设置，例如代理相关配置。

用户已经确认本次迭代的边界：

- 设置是全局的，不区分账号或会话
- 当前只有 `normalRate` 在范围内
- 后续像代理配置这样的全局设置，也应该放在同一处管理

## 目标

- 将 observability 的 `normalRate` 从代码默认值迁移为数据库驱动的全局设置。
- 引入一张可随未来需求扩展的全局设置表。
- 保持 trace 持久化路径足够轻，不在每次采样时访问数据库。
- 提供简单直接的全局设置读取和更新 API。
- 保留现有错误、慢请求、达到最大轮数、高成本 trace 的强制保留行为。

## 非目标

- 不支持按账号或按会话覆写设置。
- 本次不引入通用 key-value 设置表。
- 本次不实现代理配置。
- 不调整 `defaultSamplingConfig` 中现有的强制保留阈值。
- 本次不实现前端设置页面。

## 推荐方案

使用强类型的单例表 `app_settings`。

这个方案和当前已确认的产品边界最匹配：全局设置数量少，但都属于运行时核心配置。强类型表可以让契约更清晰、校验更集中，也方便后续继续加字段。未来如果要增加代理配置，可以直接扩展 typed columns，而不需要把校验逻辑下放到 JSON 或动态 key 解析里。

备选方案 `system_settings(key, value_json)` 这种通用 KV 表本次不推荐，因为它会弱化类型约束，也会让这类核心运行时配置更容易出现错误输入或不一致语义。

## 数据模型

新增一张 Prisma 模型：

```text
app_settings
- id int primary key
- normal_rate double precision not null default 0.1
- created_at timestamptz not null default now()
- updated_at timestamptz not null default now()
```

建议的 Prisma 结构如下：

```prisma
model AppSettings {
  id         Int      @id @default(1)
  normalRate Float    @default(0.1) @map("normal_rate")
  createdAt  DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt  DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@map("app_settings")
}
```

说明：

- 这张表在应用层面被视为单例行，固定使用 `id = 1`。
- 后端必须通过 `upsert` 或 `findUnique + create` 保证默认行始终存在。
- `normal_rate` 保持为原生数值列，而不是 JSON 字段，这样更利于类型校验、查询和排障。

## 后端组件

### Store

在 `packages/server/src/db/app-settings-store.ts` 新增 store。

职责：

- 读取单例设置行
- 在行不存在时按默认值创建
- 更新允许修改的字段

建议接口：

```ts
interface AppSettingsRow {
  id: number;
  normalRate: number;
  createdAt: Date;
  updatedAt: Date;
}

interface UpdateAppSettingsInput {
  normalRate?: number;
}

interface AppSettingsStore {
  get(): Promise<AppSettingsRow>;
  update(input: UpdateAppSettingsInput): Promise<AppSettingsRow>;
}
```

实现规则：

- `get()` 必须保证一定返回一行；如果缺失则自动创建默认行。
- `update()` 只更新调用方显式提供的字段。
- 不允许将未知字段静默持久化。

### Settings Service

新增一个轻量的 server 层 settings service，负责校验和运行时传播。

职责：

- 校验传入的设置 payload
- 调用 store 读写数据库
- 将相关设置同步到依赖它的内存运行时组件

建议接口：

```ts
interface AppSettingsService {
  get(): Promise<AppSettingsRow>;
  update(input: UpdateAppSettingsInput): Promise<AppSettingsRow>;
  bootstrap(): Promise<void>;
}
```

引入这一层的原因：

- 避免在 bootstrap 和 API route 中重复校验逻辑
- 避免让 API 层直接耦合 observability 的运行时刷新方式
- 为未来其他全局设置影响不同子系统时保留清晰的扩展点

## API 契约

新增 route 模块：`packages/server/src/api/routes/settings.ts`。

### `GET /api/settings`

返回全局单例设置。

响应示例：

```json
{
  "data": {
    "normal_rate": 0.1,
    "updated_at": "2026-04-22T00:00:00.000Z"
  }
}
```

### `PATCH /api/settings`

更新一个或多个已支持的全局设置。

本次迭代的请求体：

```json
{
  "normal_rate": 0.2
}
```

校验规则：

- `normal_rate` 对 patch 语义来说是可选字段
- 请求体里至少要提供一个受支持字段
- `normal_rate` 必须是有限数值
- `normal_rate` 必须满足 `0 <= normal_rate <= 1`
- 未知字段直接返回 `400`，而不是静默忽略

响应示例：

```json
{
  "data": {
    "normal_rate": 0.2,
    "updated_at": "2026-04-22T00:00:00.000Z"
  }
}
```

错误场景：

- `400`：请求体不合法或值超出范围
- `500`：持久化或运行时刷新出现意外失败

## Observability 运行时行为

采样热路径上不能查数据库。

建议的运行时形态：

1. `observabilityService` 持有一份可变的内存采样配置。
2. 服务启动时，从数据库加载一次 app settings。
3. 读取到的 `normalRate` 会合并到内存采样配置中，然后再开始对外提供服务。
4. `queuePersistTrace()` 只读取内存中的采样配置。
5. `PATCH /api/settings` 成功后，新的 `normalRate` 立即同步到 `observabilityService`。

这样可以同时满足性能和动态配置更新的要求。

建议对 observability 做的改动：

- 去掉 `queuePersistTrace()` 内部的本地硬编码采样配置
- 增加一个 setter，例如 `setSamplingNormalRate(normalRate: number): void`

行为规则：

- 如果启动阶段无法加载 settings，应明确失败，而不是静默退回到一个不透明的旧配置
- 如果数据库更新成功，但运行时应用失败，API 应返回错误，让不一致状态立即可见
- 强制保留相关配置本次仍继续来自代码中的 `defaultSamplingConfig`

## 启动流程

调整 server 启动顺序，确保全局设置在正常流量进入前已经可用。

建议顺序：

1. 初始化 Prisma client
2. 执行 app settings bootstrap
3. 启动 observability cleanup timer
4. 启动账号 runtime、scheduler 和 HTTP server

这样可以保证 observability 从一开始就使用数据库中的采样率，而不是代码里的回退值。

## DTO 结构

为新 API 契约新增 shared DTO：

```ts
interface AppSettingsDto {
  normal_rate: number;
  updated_at: string;
}
```

如果后续需要，也可以返回 `created_at`，但当前产品场景下不是必需字段。

## 错误处理

- `NaN`、`Infinity`、字符串、超出范围的值，都应返回 `400`
- 单例行缺失不视为错误，后端应自动按默认值补齐
- 数据库或运行时刷新失败必须记录日志并显式暴露，不能静默吞掉

## 测试

### Store 测试

- `get()` 在表为空时创建并返回默认行
- `get()` 在已有数据时返回现存单例行
- `update()` 能正确修改 `normalRate`，且不会影响其他字段

### Route 测试

- `GET /api/settings` 在之前没有行时仍返回默认值
- `PATCH /api/settings` 能接受合法的 `normal_rate`
- `PATCH /api/settings` 会拒绝缺失字段的请求
- `PATCH /api/settings` 会拒绝未知字段
- `PATCH /api/settings` 会拒绝小于 `0` 或大于 `1` 的值
- `PATCH /api/settings` 会拒绝非数值输入

### Runtime 测试

- bootstrap 能将数据库中的 `normalRate` 加载进 observability 运行时状态
- patch 成功后，内存采样配置会立即更新
- `queuePersistTrace()` 使用的是当前内存采样率，而不是硬编码常量

## 上线说明

- 因为这是新增表，所以除了 schema 更新和 Prisma client 重新生成外，没有额外迁移复杂度
- 对从未修改过设置的用户，行为保持不变，因为数据库默认值仍然是 `0.1`
- 未来像代理配置这样的全局设置，可以继续作为 typed columns 加进 `app_settings`，并通过同一个 `/api/settings` 契约暴露
