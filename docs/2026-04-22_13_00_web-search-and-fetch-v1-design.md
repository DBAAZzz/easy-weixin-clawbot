# Web Search / Web Fetch V1 设计

## 背景

当前项目需要内置两类对外能力：

- `web_search`：用于从外部网页检索信息
- `web_fetch`：用于读取指定网页内容

V1 的目标不是做复杂的搜索策略平台，而是先把统一能力和最小配置打通，保证 Agent 可以稳定使用，用户可以配置主流搜索服务的密钥，并在主服务不可用时自动回退。

## V1 决策

### Tool 暴露方式

对 Agent 只暴露两个全局可用的工具：

- `web_search`
- `web_fetch`

Agent 只需要理解“搜索网页”和“读取网页”这两个动作，不需要理解 Brave、Tavily、DuckDuckGo 等供应商差异。

### Provider 策略

`web_search` 底层支持多个 provider，但 provider 选择不交给 Agent，而由系统在代码中固定路由。

V1 采用固定优先级：

1. Brave
2. Tavily
3. DuckDuckGo fallback

说明：

- Brave、Tavily 属于需要用户配置密钥的主 provider
- DuckDuckGo 仅作为最终兜底策略，不作为主路径
- fallback 逻辑写在代码里，不做数据库策略配置
- fallback 仅在 provider 不可用时触发，例如认证失败、限流、超时、5xx 或网络异常
- “0 结果”不视为 provider 故障，不触发 fallback

V1 支持的搜索 provider：

- `brave`
- `tavily`

DuckDuckGo 不作为正式配置 provider 暴露，只保留为代码内置的最终 fallback。

### 旧实现处理

现有基于 DuckDuckGo HTML 抓取的旧版 `web-search` 实现不再作为正式主方案继续演进。

V1 中：

- 统一收敛到新的 `web_search` 能力入口
- 旧实现退出现有主流程
- DuckDuckGo 仅保留为内部 fallback 能力

## 数据库设计

V1 只保留一张与 Web Search provider 相关的配置表，用于保存全局 provider 配置。

建议表名：

- `web_search_providers`

### 表职责

这张表只负责保存静态配置事实：

- 当前系统配置了哪些搜索 provider
- 这些 provider 是否启用
- 这些 provider 的密钥是什么

这张表不负责保存：

- 路由策略
- fallback 顺序
- 运行时错误
- 健康检查状态

这些行为统一由代码和 observability 处理。

### 建议字段

| 字段名 | 说明 |
| --- | --- |
| `id` | 主键 |
| `provider_type` | provider 类型，如 `brave`、`tavily` |
| `api_key_ciphertext` | 加密后的 API Key |
| `enabled` | 是否启用 |
| `created_at` | 创建时间 |
| `updated_at` | 更新时间 |

### 约束

- `provider_type` 唯一

### 设计说明

- V1 只保存需要用户提供密钥的 provider 配置
- DuckDuckGo 不作为配置主体入库，直接作为代码内置的最终 fallback
- 如果未来需要控制 DuckDuckGo 是否启用，可在后续版本再扩展，不放入当前 V1 范围
- Provider 优先级保持代码内固定，不在数据库中增加 `is_primary` 之类的策略字段
- 当前方案按全局配置设计，不引入 `tenant_id` 等多租户字段；如后续产品形态演进为 SaaS，再单独扩展

### 推荐落库约束

- `provider_type` 仅允许 `brave`、`tavily`
- `api_key_ciphertext` 对两个 provider 均为必填
- `enabled` 默认 `true`
- 每种 provider 全局最多一条配置

### 密钥加密方案

V1 采用服务端代码内置加密密钥，对 provider API Key 做对称加密后再入库。

说明：

- 数据库存储的是密文，不存明文
- 解密逻辑仅在服务端运行时使用
- 该方案满足 V1 快速落地目标
- 该方案不属于长期最佳实践，后续应迁移到环境变量或专门的 Secret Manager

## Provider 配置入口

V1 只提供服务端 API，不开发独立的 Web 配置页面。

也就是说：

- Web 端后续可以接入配置界面
- 当前阶段先以 API 作为唯一配置入口

建议暴露的能力包括：

- 列出当前已配置 provider
- 新增 provider 配置
- 更新 provider 配置
- 启用 provider
- 禁用 provider

V1 的重点是先打通服务端配置、Agent 工具调用和 fallback 链路，而不是优先建设前端管理界面。

## Web Fetch 设计边界

`web_fetch` 在 V1 中作为全局内置工具提供，不单独设计数据库配置。

原因：

- 当前核心问题是先完成网页抓取能力本身
- `web_fetch` 暂时不需要 provider 路由
- 先避免为了抽象统一而引入不必要的复杂度

后续如果出现专门的 fetch/extract provider，再考虑扩展配置模型。

### 抓取策略要求

`web_fetch` 不应采用“简单 HTTP GET + 原始 HTML 直接喂给 Agent”的方式作为主要实现。

原因：

- 大量网页依赖前端渲染，原始 HTML 不包含有效正文
- 部分站点存在 Cloudflare 等拦截，直接抓取容易拿到无效页面
- 原始 HTML 噪音极大，直接传给 Agent 会放大 token 消耗并增加幻觉风险

V1 直接采用 Jina Reader 作为正文获取的主方案。

说明：

- `web_fetch` 优先返回可读文本，而不是原始 HTML
- 若 Jina Reader 返回正文，则直接对其结果做清洗和裁剪后返回给 Agent
- 本地 Readability 或其他正文提取方案不纳入当前 V1 范围

目标不是完整还原网页，而是尽量稳定地向 Agent 提供精简后的可读文本内容。

### 安全边界

`web_fetch` 需要在 V1 明确加入严格的网络白名单/黑名单拦截。

最低要求：

- URL Scheme 仅允许 `http` 和 `https`
- 明确禁止 `file://`、`ftp://`、`gopher://` 等其他 Scheme
- 请求前必须解析目标地址
- 若目标地址解析到内网或保留地址，必须拒绝访问
- 若发生重定向，重定向目标也必须重复校验

至少禁止访问：

- 内网地址
- 本机回环地址
- 链路本地地址
- 云厂商元数据地址

典型包括但不限于：

- `127.0.0.0/8`
- `10.0.0.0/8`
- `192.168.0.0/16`
- `172.16.0.0/12`

`web_fetch` 的定位是读取外部网页内容，不应成为访问内部网络资源的通道。

## Tool 契约

### `web_search`

`web_search` 采用尽量克制的入参设计，避免让 Agent 承担不必要的 provider 控制复杂度。

V1 入参：

- `query`：必填，搜索关键词
- `maxResults`：选填，默认 5

设计原则：

- 不向 Agent 暴露 provider 选择参数
- 不向 Agent 暴露 fallback 控制参数
- 不在 V1 暴露站点过滤、地区过滤等高级搜索参数

返回形式：

- 以文本结果优先返回
- 内部可先标准化为统一结果结构
- 对 Agent 输出时优先给出精简后的编号列表
- 每条结果至少包含标题、链接、摘要

### `web_fetch`

`web_fetch` 采用极简入参。

V1 入参：

- `url`：必填，绝对 URL

设计原则：

- URL 必须是外部可访问的 `http/https` 地址
- 不向 Agent 暴露底层抓取 provider 选择
- 不允许传入本地路径、文件协议或内部地址

返回形式：

- 以清洗后的可读文本为主
- 优先返回标题、来源 URL 和正文摘要/正文片段
- 不返回原始 HTML
- 返回内容需要做长度控制，避免 token 爆炸

## 路由与可观测性

### 路由原则

- Provider 优先级固定写在代码中
- 没有配置、未启用、密钥缺失的 provider 会被跳过
- 主 provider 失败后，依次尝试后续 provider
- fallback 只针对网络或服务异常，不针对正常的空结果
- 最终失败原因通过可观测性查看

### 可观测性原则

运行时状态不入配置表，统一进入现有 LLM / Tools 可观测性链路，包括：

- 调用了哪个 provider
- 失败原因
- 超时/限流/认证失败
- fallback 是否发生
- 主 provider 失败与 DuckDuckGo fallback 失败需要能被明确区分

数据库只保存配置，不保存运行态。

### DuckDuckGo 风险说明

DuckDuckGo HTML 抓取方案仅作为最终 fallback 使用，不应被视为稳定主能力。

需要明确认识到：

- 该类方案受反爬虫和频率限制影响较大
- 在高频请求下存在失败率升高或被限制的风险
- 因此 observability 中必须能区分“主 provider 失败”和“DDG fallback 也失败”的情况，避免排查困难

## 非目标

以下内容不属于 V1 范围：

- 多张策略表，如 `web_tool_policies`、`web_tool_fallbacks`
- 在数据库中增加 `is_primary` 之类的策略字段
- 账号级、会话级 provider 配置覆盖
- 多租户字段设计，如 `tenant_id`
- 让 Agent 直接选择 Brave / Tavily / DuckDuckGo
- 为 `web_fetch` 单独设计 provider 配置体系
- 在数据库中保存运行时错误、最近检查时间等状态字段

## 总结

V1 采用“统一 Tool、单表配置、代码内路由、观测承接运行态”的收敛方案：

- 对 Agent：只暴露 `web_search` 和 `web_fetch`
- 对数据库：只保留 `web_search_providers` 一张表
- 对系统路由：固定优先级，DuckDuckGo 作为最终 fallback
- 对运行态：全部交给 observability，不写入配置表

这套方案足够支撑前期上线，也为后续扩展留下空间，但不会在当前阶段引入不必要的复杂度。
