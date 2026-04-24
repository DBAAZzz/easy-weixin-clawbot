import { getWebToolService } from "../../ports/web-tool-service.js";
import type { NativeHandler } from "../types.js";

function normalizeUrl(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

export const webFetchHandler: NativeHandler = {
  async execute(args, _config, ctx) {
    const url = normalizeUrl(args.url);
    if (!url) {
      throw new Error("web_fetch requires a non-empty url");
    }

    // URL 抓取、清洗和 provider fallback 都封装在 WebToolService，handler 只负责入参归一化和结果转文本。
    const result = await getWebToolService().fetch({
      url,
      signal: ctx.signal,
    });

    const title = result.title?.trim() || "未提供";
    return [
      {
        type: "text",
        text: `标题：${title}\n来源：${result.url}\n\n${result.content}`,
      },
    ];
  },
};
