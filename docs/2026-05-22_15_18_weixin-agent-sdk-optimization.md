# weixin-agent-sdk 优化方案

## 概述

`@clawbot/weixin-agent-sdk` 当前承担微信协议接入职责：登录、long polling、消息解析、微信 CDN 媒体下载解密、消息发送。该包历史上来源于 OpenClaw 使用场景，因此仍保留了一些 OpenClaw 命名和文件状态逻辑。

完整去 OpenClaw 化会牵涉 routeTag、allowFrom、debug mode、logger、slash command 等多个边界，改动面较大。当前采用渐进式优化：**Phase 1 只做必需改动**，不一次性重构全部 SDK。

Phase 1 必做：

1. sync buf 去文件 fallback，统一由 server DB 管理。
2. 调整 SDK media 机制，把微信媒体下载产物收敛到 SDK 包内工作目录，便于维护和查看。

Phase 1 不做：

1. 不迁移 routeTag。
2. 不迁移 allowFrom。
3. 不迁移 debug mode。
4. 不重构 logger。
5. 不让 SDK 依赖 Asset 层。

---

## 1. 目标与非目标

### 1.1 目标

1. 移除 `getSyncBufFilePath()` 及 sync buf 文件 fallback。
2. 让 `monitorWeixinProvider()` 只使用 server 传入的 sync buf 初始值和更新回调。
3. 将 SDK 的媒体临时目录从 `/tmp/weixin-agent/media` 调整到 `packages/weixin-agent-sdk/.openclaw/media`。
4. 明确 SDK media 文件只是临时工作文件，不是长期资产。
5. 为后续 server 在 chat 前创建 Asset 留出稳定边界。

### 1.2 非目标

1. 不在 SDK 中实现 AssetService。
2. 不让 SDK 依赖 Prisma、Hono、`@clawbot/server` 或 `@clawbot/asset`。
3. 不在 Phase 1 中重构 routeTag、allowFrom、debug mode、logger。
4. 不在 Phase 1 中把 SDK 改造成完全无状态包。
5. 不把 `packages/weixin-agent-sdk/.openclaw/media` 当作长期资产目录。

---

## 2. Phase 1 包边界

Phase 1 后的职责边界：

```text
packages/weixin-agent-sdk
  负责：
    - 微信登录流程
    - getUpdates long polling
    - 微信消息结构解析
    - 微信 CDN 媒体下载、AES 解密、SILK 转码
    - 微信 CDN 上传
    - 发送文本、图片、视频、文件消息
    - 把临时媒体文件写入 SDK 包内工作目录

  不负责：
    - sync buf 文件 fallback
    - 账号凭据存储
    - 长期媒体资产存储
    - Web 访问 URL
```

server 侧职责：

```text
packages/server
  负责：
    - 从 DB 读取/写入 weixin_sync_state
    - 从 DB 读取/写入账号凭据
    - 调用 monitorWeixinProvider 时传入 sync buf
    - 后续收到 ChatRequest.media.filePath 后，在 chat 前创建 Asset
```

说明：routeTag、allowFrom、debug mode 目前可以暂时保留既有实现，不进入 Phase 1 必做范围。

---

## 3. SDK 本地工作目录

历史实现会把部分状态写到用户 home 下的 `.openclaw`，或把媒体临时文件写到 `/tmp/weixin-agent/media`。这对本项目维护不直观。

Phase 1 后，SDK 本地工作目录统一为：

```text
packages/weixin-agent-sdk/.openclaw/
  media/
    inbound/
    outbound/
```

目录定位：

- `packages/weixin-agent-sdk/.openclaw` 是 SDK 工作目录。
- `media/inbound` 存放微信入站媒体下载、解密、转码后的临时文件。
- `media/outbound` 存放发送前从远程 URL 下载的临时文件。
- sync buf 不进入该目录，必须由 server DB 管理。
- 该目录不作为长期资产目录。长期资产仍归 `data/assets` 或对象存储。

重要限制：

- 包根目录写入适合当前 monorepo 内运行和开发排障。
- 如果未来把 SDK 作为通用 npm 包发布并在 `node_modules` 中运行，包目录可能不可写。
- 届时应改成调用方显式传入 `workDir`，或者默认写入调用方应用目录。

推荐接口预留：

```typescript
export type WeixinSdkWorkDirs = {
  root: string;
  mediaInboundDir: string;
  mediaOutboundDir: string;
};
```

---

## 4. 当前问题清单

### 4.1 sync buf 文件 fallback

当前相关文件：

```text
packages/weixin-agent-sdk/src/storage/sync-buf.ts
packages/weixin-agent-sdk/src/storage/state-dir.ts
packages/weixin-agent-sdk/src/monitor/monitor.ts
```

问题：

- `monitorWeixinProvider()` 在未传 `syncBufInitial` / `onSyncBufUpdate` 时，会 fallback 到本地文件。
- `sync-buf.ts` 依赖 `resolveStateDir()`，默认写入 `~/.openclaw/openclaw-weixin/accounts/*.sync.json`。
- 还存在旧单账号路径 fallback：`.openclaw-weixin-sync/default.json`。

结论：

- 删除 sync buf 文件 fallback。
- `weixin_sync_state` 表是唯一 sync buf 权威来源。
- `monitorWeixinProvider()` 缺少 `onSyncBufUpdate` 时应直接抛错。

### 4.2 SDK media 机制

当前相关文件：

```text
packages/weixin-agent-sdk/src/media/media-download.ts
packages/weixin-agent-sdk/src/messaging/process-message.ts
packages/weixin-agent-sdk/src/cdn/upload.ts
```

问题：

- 入站媒体下载后写入 `/tmp/weixin-agent/media/inbound`。
- 出站远程媒体下载后写入 `/tmp/weixin-agent/media/outbound`。
- 路径分散在 SDK 代码中，不便于开发查看，也不利于统一清理。
- 这些文件只是临时文件，不应被误认为长期资产。

结论：

- Phase 1 将 SDK 媒体临时文件目录调整为 `packages/weixin-agent-sdk/.openclaw/media`。
- 继续保留 `ChatRequest.media.filePath` 输出。
- server 后续在 chat 前用该 filePath 创建 Asset。

### 4.3 routeTag、allowFrom、debug、logger

这些都是后续优化项，不进入 Phase 1。

当前建议：

- routeTag 暂时保留既有读取逻辑。
- allowFrom 暂时保留既有逻辑。
- debug mode 暂时保留既有逻辑。
- logger 暂时保留既有逻辑。

后续如继续保留文件状态，应优先迁移到 `packages/weixin-agent-sdk/.openclaw`，再评估是否彻底下沉到 server/DB。

---

## 5. Phase 1 接口设计

### 5.1 monitorWeixinProvider

当前接口允许文件 fallback：

```typescript
export type MonitorWeixinOpts = {
  syncBufInitial?: string;
  onSyncBufUpdate?: (buf: string) => void;
};
```

Phase 1 目标接口不引入复杂 store，只把当前 server 已经提供的两个参数改成唯一来源：

```typescript
export type MonitorWeixinOpts = {
  baseUrl: string;
  cdnBaseUrl: string;
  token?: string;
  accountId: string;
  agent: Agent;
  abortSignal?: AbortSignal;
  longPollTimeoutMs?: number;
  log?: (msg: string) => void;
  syncBufInitial: string | undefined;
  onSyncBufUpdate: (buf: string) => void;
  workDir?: string;
};
```

运行逻辑：

```text
monitorWeixinProvider()
  ↓
getUpdatesBuf = opts.syncBufInitial ?? ""
  ↓
getUpdates(get_updates_buf)
  ↓
opts.onSyncBufUpdate(resp.get_updates_buf)
```

要求：

- 没有 `onSyncBufUpdate` 时直接抛错。
- 不读取本地 sync json。
- 不提供 legacy fallback。

### 5.2 media 保存策略

SDK 下载微信 CDN 媒体后仍输出临时文件，但文件目录调整到 SDK 包内工作目录。

默认目录：

```text
packages/weixin-agent-sdk/.openclaw/media/
  inbound/
  outbound/
```

目录解析规则：

```text
opts.workDir
  ↓ fallback
packages/weixin-agent-sdk/.openclaw
```

保留当前 ChatRequest 边界：

```typescript
export interface ChatRequest {
  media?: {
    type: "image" | "audio" | "video" | "file";
    filePath: string;   // 临时文件，已下载解密
    mimeType: string;
    fileName?: string;
  };
}
```

server adapter 后续在调用 `chat()` 前执行：

```text
ChatRequest.media.filePath
  ↓
AssetService.createFromFile()
  ↓
assetId
  ↓
chat() / messages.payload / reports
```

Phase 1 不让 SDK 直接返回 `assetId`，避免 SDK 依赖 Asset 层。

---

## 6. 推荐目录结构

Phase 1 后 SDK 目录：

```text
packages/weixin-agent-sdk/
  .openclaw/
    media/
      inbound/
      outbound/
  src/
    agent/
      interface.ts
    api/
      api.ts
      types.ts
      config-cache.ts
      session-guard.ts
    auth/
      accounts.ts
      login-qr.ts
      pairing.ts              # Phase 1 暂不迁移
    cdn/
      aes-ecb.ts
      cdn-upload.ts
      cdn-url.ts
      pic-decrypt.ts
      upload.ts
    media/
      media-download.ts
      mime.ts
      silk-transcode.ts
    messaging/
      debug-mode.ts           # Phase 1 暂不迁移
      error-notice.ts
      inbound.ts
      process-message.ts
      send-media.ts
      send.ts
      slash-commands.ts
    monitor/
      monitor.ts
    storage/
      work-dir.ts             # 新增，解析 SDK 工作目录
    util/
      logger.ts
      random.ts
      redact.ts
```

Phase 1 应删除：

```text
src/storage/sync-buf.ts
```

`src/storage/state-dir.ts` 是否删除取决于 Phase 1 是否同步迁移 debug-mode / pairing。如果它们暂时仍依赖 `state-dir.ts`，则先保留，但内部默认目录应从用户 home `.openclaw` 改为 SDK 包根 `.openclaw`。

---

## 7. 迁移计划

### Phase 1：必做，sync buf 去 fallback + media 机制调整

1. 删除 `storage/sync-buf.ts`。
2. 修改 `monitorWeixinProvider()`：`syncBufInitial` 和 `onSyncBufUpdate` 是唯一 sync buf 来源。
3. 修改 server runtime，继续从 `weixin_sync_state` 读取并保存 sync buf。
4. 新增 SDK work dir 解析，默认 `packages/weixin-agent-sdk/.openclaw`。
5. 修改入站媒体目录：`/tmp/weixin-agent/media/inbound` → `packages/weixin-agent-sdk/.openclaw/media/inbound`。
6. 修改出站远程媒体目录：`/tmp/weixin-agent/media/outbound` → `packages/weixin-agent-sdk/.openclaw/media/outbound`。
7. 保持 `ChatRequest.media.filePath` 不变，server 后续在 chat 前创建 Asset。

验收标准：

- `rg "getSyncBufFilePath|loadGetUpdatesBuf|saveGetUpdatesBuf" packages/weixin-agent-sdk` 无结果。
- 重启服务后 sync buf 仍从 `weixin_sync_state` 恢复。
- 新收到的微信图片、视频、文件临时文件写入 `packages/weixin-agent-sdk/.openclaw/media/inbound`。
- 远程回复媒体临时文件写入 `packages/weixin-agent-sdk/.openclaw/media/outbound`。
- SDK 不把 `.openclaw/media` 当作长期资产目录。

### Phase 2：可选，routeTag 显式化

1. 删除 `loadConfigRouteTag()`。
2. API options 增加 `routeTag?: string`。
3. `buildCommonHeaders()` 只使用显式 `routeTag`。
4. server runtime 从 DB/config 传入 routeTag。

验收标准：

- SDK 不读取 `OPENCLAW_CONFIG`。
- SDK 不读取 `openclaw.json`。
- 所有 `SKRouteTag` 来源可追踪到 server 配置。

### Phase 3：可选，文件型 allowFrom / debug mode 收敛

1. 若暂时保留文件型 allowFrom/debug，先移动到 `packages/weixin-agent-sdk/.openclaw`。
2. 后续再考虑删除 `auth/pairing.ts` 文件型授权逻辑。
3. 后续再考虑删除 `messaging/debug-mode.ts`。
4. slash command 是否迁移到 server/agent 层单独评估。

验收标准：

- 不再写用户 home 下的 `.openclaw`。
- 如果仍有文件状态，只存在 `packages/weixin-agent-sdk/.openclaw`。

### Phase 4：可选，日志和命名清理

1. 文件日志如保留，先移动到 `packages/weixin-agent-sdk/.openclaw/logs`。
2. 长期再改成注入式 logger。
3. 评估 `OPENCLAW_LOG_LEVEL` 是否保留。
4. 评估 `openclaw-weixin` 字符串是否改为 `clawbot-weixin` 或 `weixin`。

验收标准：

- SDK 不创建 `/tmp/openclaw`。
- 新增 OpenClaw 命名禁止继续扩散。

### Phase 5：可选，Asset 接入点

1. SDK 继续输出临时 `ChatRequest.media.filePath`。
2. server agent adapter 收到 media 后，chat 前创建 Asset。
3. message payload 保存 `assetId`。
4. 不让 SDK 依赖 `@clawbot/asset`。

验收标准：

- SDK 只负责临时下载解密。
- 长期媒体保存全部由 server AssetService 管理。
- `messages.payload` 新写入不再保存本地长期路径。

---

## 8. 风险与处理

| 风险 | 影响 | 处理 |
| ---- | ---- | ---- |
| 删除 sync buf fallback 后调用方未传更新回调 | monitor 无法可靠续拉 | `onSyncBufUpdate` 必填，缺失直接抛错 |
| 包根 `.openclaw` 在 npm/node_modules 场景不可写 | 通用包使用失败 | 当前服务优先 monorepo；未来发布时改成显式 `workDir` |
| 媒体从 `/tmp` 改到包目录后磁盘增长 | 长期运行占空间 | 后续增加临时文件清理任务 |
| `.openclaw/media` 被误当长期资产 | 报告引用失效 | 文档和代码命名明确 temporary/work dir，长期资产走 AssetService |
| routeTag/allowFrom/debug 暂不迁移 | OpenClaw 遗留仍存在 | 标记为 Phase 2/3/4，可独立处理 |

---

## 9. Phase 1 后的数据流

Phase 1 完成后的数据流：

```text
server runtime
  ↓ DB load sync buf / credential
monitorWeixinProvider()
  ↓ getUpdates
  ↓ DB save sync buf
processOneMessage()
  ↓ download/decrypt media to packages/weixin-agent-sdk/.openclaw/media/inbound
server agent adapter
  ↓ chat()
MessageStore
  ↓ current message persistence behavior
```

后续 Asset 接入后的数据流：

```text
processOneMessage()
  ↓ ChatRequest.media.filePath
server agent adapter
  ↓ AssetService.createFromFile(temp file)
  ↓ chat(assetId)
MessageStore
  ↓ messages.payload(assetId)
reports/web
  ↓ Asset API(assetId)
```

最终判断：

- Phase 1 只做必需改动：sync buf 去 fallback，media 临时目录收敛。
- `packages/weixin-agent-sdk/.openclaw` 是 SDK 工作目录，不是长期资产目录。
- 媒体长期资产由 Asset 层管理，SDK 只输出已解密临时文件。

