import { z } from "zod";
import type { NativeHandler, NativeToolDefinition, ToolCatalogItem, ToolSnapshot } from "./types.js";
import { cliHandler } from "./handlers/cli.js";
import { webFetchHandler } from "./handlers/web-fetch.js";
import { webSearchHandler } from "./handlers/web-search.js";

function defineNativeTool(input: {
  name: string;
  handler: string;
  handlerConfig?: Record<string, unknown>;
  description: string;
  parameters: z.ZodObject<any>;
  parameterNames: string[];
  nativeHandler: NativeHandler;
}): NativeToolDefinition {
  return {
    name: input.name,
    handler: input.handler,
    description: input.description,
    parameters: input.parameters,
    parameterNames: input.parameterNames,
    execute(args, ctx) {
      return input.nativeHandler.execute(args, input.handlerConfig ?? {}, ctx);
    },
  };
}

export const BUILTIN_TOOLS: NativeToolDefinition[] = [
  defineNativeTool({
    name: "web_search",
    handler: "web-search",
    description: [
      "用于检索外部网页信息并返回精简后的搜索结果列表。",
      "适合查询最新信息、新闻、文档入口或公开资料。",
      "如需阅读全文，请在拿到结果 URL 后继续调用 web_fetch。",
    ].join("\n"),
    parameters: z.object({
      query: z.string().describe("需要搜索的关键词、问题或主题"),
      maxResults: z.number().int().default(5).describe("返回结果数量，默认 5，最大 8"),
    }),
    parameterNames: ["maxResults", "query"],
    nativeHandler: webSearchHandler,
  }),
  defineNativeTool({
    name: "web_fetch",
    handler: "web-fetch",
    description: [
      "用于读取单个网页的正文内容，并返回适合大模型继续处理的精简文本。",
      "仅支持外部 http/https URL，不适用于本地文件、内网地址或需要访问内部资源的场景。",
    ].join("\n"),
    parameters: z.object({
      url: z.string().describe("需要抓取的绝对 http/https URL"),
    }),
    parameterNames: ["url"],
    nativeHandler: webFetchHandler,
  }),
  defineNativeTool({
    name: "opencli",
    handler: "cli",
    handlerConfig: {
      binary: "opencli",
      defaultArgs: [],
      maxOutputChars: 4000,
      timeout: 30000,
    },
    description: [
      "调用 opencli 执行网站、桌面应用和外部 CLI 能力。",
      "命令格式为 `<site> <command> [--options]`，不需要带 opencli 前缀。",
      "需要结构化输出时优先追加 `-f json`。",
    ].join("\n"),
    parameters: z.object({
      command: z.string().describe('子命令和参数，例如 "bilibili hot --limit 5"'),
    }),
    parameterNames: ["command"],
    nativeHandler: cliHandler,
  }),
];

export function createBuiltinToolSnapshot(): ToolSnapshot {
  return {
    tools: BUILTIN_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
      execute: tool.execute,
    })),
  };
}

export function listBuiltinToolCatalog(): ToolCatalogItem[] {
  return BUILTIN_TOOLS.map((tool) => {
    const item: ToolCatalogItem = {
      name: tool.name,
      description: tool.description,
      type: "tool",
      handler: tool.handler,
      origin: "builtin",
      enabled: true,
      managedBySystem: true,
      parameterNames: [...tool.parameterNames].sort((left, right) => left.localeCompare(right)),
    };
    return item;
  }).sort((left, right) => left.name.localeCompare(right.name));
}

export function getBuiltinToolCatalogItem(name: string): ToolCatalogItem | null {
  return listBuiltinToolCatalog().find((tool) => tool.name === name) ?? null;
}
