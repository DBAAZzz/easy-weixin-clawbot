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