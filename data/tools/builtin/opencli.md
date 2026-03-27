---
name: opencli
version: 1.0.0
type: tool
author: clawbot
summary: 调用 opencli 执行外部网站、应用和命令行工具
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
      Subcommand and arguments (without "opencli" prefix).
      Example: "bilibili hot --limit 5"
    required: true
---

Execute opencli commands to access websites, apps, and external CLIs.
Common commands:
  bilibili hot/search/download    zhihu hot/search/download
  xiaohongshu search/feed/publish weibo hot/search
  twitter trending/search/post    hackernews top/search
  youtube search/transcript       web read <url>
  douban search/top250            jike feed/search
  weread shelf/search/highlights  xueqiu hot-stock/search
  gh pr list / gh issue list      docker ps
Add "-f json" for structured output. Use "list" to see all commands.
