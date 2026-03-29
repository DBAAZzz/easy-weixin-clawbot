---
name: opencli
version: 1.0.0
type: tool
author: clawbot
summary: 通过 opencli 访问网站、桌面应用和外部 CLI 工具，获取热榜、搜索、下载、发布等操作
handler: cli
handlerConfig:
  binary: opencli
  defaultArgs: []
  maxOutputChars: 4000
  timeout: 30000
inputSchema:
  command:
    type: string
    description: >
      子命令和参数（不需要 "opencli" 前缀）。
      示例: "bilibili hot --limit 5"
    required: true
---

# OpenCLI — 万能网站/应用命令行工具

将任何网站、Electron 桌面应用、本地 CLI 工具变成命令行接口。复用 Chrome 登录态，零 LLM 成本，确定性输出。

## 核心用法

**命令格式**: `<site> <command> [--options]`

**发现所有可用命令**: `list`

**诊断连接问题**: `doctor`

## 常用网站命令速查

### 中文平台
| 平台 | 命令 | 示例 |
|------|------|------|
| **bilibili** | `hot` `search` `history` `feed` `ranking` `download` `comments` `dynamic` `favorite` `following` `me` `subtitle` `user-videos` | `bilibili hot --limit 10` / `bilibili search "关键词" --limit 5` / `bilibili download BV1xxx --output ./videos` |
| **xiaohongshu** | `search` `feed` `user` `download` `publish` `comments` `notifications` `creator-notes` `creator-notes-summary` `creator-note-detail` `creator-profile` `creator-stats` | `xiaohongshu search "关键词" --limit 5` / `xiaohongshu feed --limit 10` |
| **zhihu** | `hot` `search` `download` | `zhihu hot --limit 10` / `zhihu search "关键词"` |
| **weibo** | `hot` `search` | `weibo hot --limit 10` |
| **douban** | `search` `top250` | `douban top250 --limit 10` |
| **jike** | `feed` `search` | `jike feed --limit 10` |
| **weread** | `shelf` `search` `highlights` | `weread shelf --limit 10` |
| **xueqiu** | `hot-stock` `search` | `xueqiu hot-stock --limit 10` |
| **weixin** | 文章下载（Markdown） | `weixin download <url>` |

### 国际平台
| 平台 | 命令 | 示例 |
|------|------|------|
| **twitter** | `trending` `search` `timeline` `bookmarks` `post` `download` `profile` `article` `like` `likes` `notifications` `reply` `reply-dm` `thread` `follow` `unfollow` `followers` `following` `block` `unblock` `bookmark` `unbookmark` `delete` `hide-reply` `accept` | `twitter trending --limit 10` / `twitter search "keyword" --limit 5` / `twitter post "Hello!"` |
| **reddit** | `hot` `frontpage` `popular` `search` `subreddit` `user` `user-posts` `user-comments` `read` `save` `saved` `subscribe` `upvote` `upvoted` `comment` | `reddit hot --limit 10` / `reddit search "keyword"` |
| **hackernews** | `top` `search` | `hackernews top --limit 10`（无需浏览器） |
| **youtube** | `search` `transcript` | `youtube search "keyword" --limit 5` |

### 外部 CLI Hub（透传已安装工具）
| 工具 | 示例 |
|------|------|
| **gh** | `gh pr list --limit 5` / `gh issue list` |
| **docker** | `docker ps` |
| **vercel** | `vercel deploy --prod` |
| **obsidian** | `obsidian search query="AI"` |
| **lark-cli** | `lark-cli calendar +agenda` |

### 桌面应用控制（Electron App）
| 应用 | 说明 |
|------|------|
| **cursor** | 控制 Cursor IDE |
| **chatgpt** | 控制 ChatGPT 桌面版 |
| **notion** | 搜索、读写 Notion 页面 |
| **discord** | Discord 消息、频道 |
| **doubao** | 控制豆包 AI 桌面版 |

## 输出格式

所有命令支持 `--format` / `-f` 参数：
- `table`（默认，人类可读）
- **`json`（推荐 AI 使用，结构化输出，可 pipe 处理）**
- `yaml` / `md` / `csv`

示例: `bilibili hot --limit 5 -f json`

## 下载并发送给用户（重要！）

当用户要求下载并发送内容时，**必须遵循以下完整流程**：

1. **下载**: 使用 `--output` 指定下载目录，**必须加 `-f json`** 获取结构化输出
2. **提取路径**: 从 JSON 输出中找到 `path`（或 `filePath`、`file`）字段的**原始值**，**禁止自己拼接或猜测路径**
3. **发送**: 在回复文本末尾加上 `[send_file:类型:文件路径]` 标记

> ⚠️ **路径必须直接来自 JSON 输出**，不要根据 ID 或文件名自行构造。不同平台的下载目录结构不同（例如 pixiv 会在 output 下建 `{id}/` 子目录），自行构造会导致路径错误。

示例完整流程（pixiv）：
```
调用: pixiv download 142785958 --output /data/downloads -f json
JSON 输出中找到: { "path": "/data/downloads/142785958/142785958_p0.jpg" }
回复: 图片已下载！[send_file:image:/data/downloads/142785958/142785958_p0.jpg]
```

### 各平台下载命令
- `xiaohongshu download <note_id> --output <dir>`（图片/视频）
- `bilibili download <BV号> --output <dir>`（视频，需要 yt-dlp）
- `twitter download <username> --limit 20 --output <dir>`（图片/视频）
- `zhihu download <url>`（导出 Markdown）
- `pixiv download <id> --output <dir>`（原始画质插画，支持多页）
- `douban download <id>`（海报/剧照）
- `weixin download <url>`（公众号文章导出 Markdown）

## 常用选项

- `--limit <N>`: 限制返回数量
- `--format / -f <format>`: 输出格式（json/table/yaml/md/csv）
- `--output <dir>`: 下载输出目录（下载时必须指定！）
- `-v`: 显示详细调试信息

## AI Agent 开发命令

- `explore <url> --site <name>`: 发现网站 API 和能力
- `synthesize <site>`: 自动生成 YAML 适配器
- `generate <url> --goal "hot"`: 一键探索 → 生成 → 注册
- `cascade <api_url>`: 自动探测认证策略

## 退出码

- `0` 成功 / `2` 参数错误 / `66` 无数据 / `69` 浏览器未连接 / `75` 超时可重试 / `77` 需要登录

## 重要注意事项

1. **浏览器命令需要 Chrome 处于运行状态并已登录对应网站**。如果返回空数据或报错，先检查登录状态。
2. **hackernews 等公共 API 命令不需要浏览器**。
3. AI 应优先使用 `-f json` 获取结构化数据。
4. 遇到 "Extension not connected" 错误时，运行 `doctor` 诊断。
5. 总共 66+ 个适配器，不确定时先运行 `list` 查看所有可用命令。
