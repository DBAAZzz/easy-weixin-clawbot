# App Settings Server/API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为全局 `app_settings` 提供数据库存储、server 运行时热更新和对外 API，先支持 `normalRate`

**Architecture:** 在 `packages/server` 内新增 `AppSettingsStore` 与 `AppSettingsService`，由 service 负责校验、持久化和向 `observabilityService` 同步内存采样配置；通过 `GET/PATCH /api/settings` 暴露。`observabilityService` 保持热路径只读内存，不直接查库。

**Tech Stack:** Prisma 6、Hono 4、TypeScript 5、Node.js test runner

---

### Task 1: 扩展数据模型和共享 DTO

**Files:**
- Modify: `packages/server/prisma/schema.prisma`
- Modify: `packages/shared/src/types.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] 增加 `AppSettings` Prisma model，固定单例 `id = 1`，字段含 `normalRate/createdAt/updatedAt`
- [ ] 在 `@clawbot/shared` 中新增 `AppSettingsDto`
- [ ] 重新导出新 DTO，供 API route 使用

### Task 2: 实现 settings store 和 service

**Files:**
- Create: `packages/server/src/db/app-settings-store.ts`
- Create: `packages/server/src/settings/service.ts`

- [ ] 实现 `AppSettingsStore.get()`，保证缺失单例行时自动创建默认值
- [ ] 实现 `AppSettingsStore.update()`，只更新允许字段
- [ ] 在 `AppSettingsService` 中集中处理 payload 校验、数据库更新和 observability 运行时同步
- [ ] 暴露默认单例 service，供启动流程和 API route 复用

### Task 3: 改造 observability 热更新路径

**Files:**
- Modify: `packages/server/src/observability/service.ts`
- Modify: `packages/server/src/index.ts`

- [ ] 为 `observabilityService` 增加可变内存采样配置和 `setSamplingNormalRate()`
- [ ] 移除 `queuePersistTrace()` 里的硬编码采样值，改为读取当前内存配置
- [ ] 在 server bootstrap 早期加载 app settings，并把 `normalRate` 注入 observability

### Task 4: 暴露 settings API

**Files:**
- Create: `packages/server/src/api/routes/settings.ts`
- Modify: `packages/server/src/api/index.ts`

- [ ] 新增 `GET /api/settings`
- [ ] 新增 `PATCH /api/settings`
- [ ] route 层只做 HTTP 适配，校验和热更新逻辑下沉到 settings service
- [ ] 将新 route 注册进 API app

### Task 5: 测试与验证

**Files:**
- Create: `packages/server/src/api/routes/settings.test.ts`
- Create: `packages/server/src/settings/service.test.ts`

- [ ] 覆盖 route 的成功和失败分支
- [ ] 覆盖 service 的数值校验和 observability 同步行为
- [ ] 运行相关测试、Prisma generate、以及 server/shared 的类型检查
