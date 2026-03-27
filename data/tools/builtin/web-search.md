---
name: web_search
version: 1.0.0
type: tool
author: clawbot
summary: 搜索互联网，返回标题、链接和摘要
handler: web-search
inputSchema:
  query:
    type: string
    description: 搜索关键词或完整问题
    required: true
  maxResults:
    type: integer
    description: 返回结果数量，默认 5，最多 8
    default: 5
---

搜索互联网并返回标题、链接和摘要，适合查询最新信息或外部资料。
