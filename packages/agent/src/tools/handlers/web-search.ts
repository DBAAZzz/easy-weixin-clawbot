import type { NativeHandler } from "../types.js";
import { getWebToolService } from "../../ports/web-tool-service.js";

const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 8;

function clampMaxResults(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.min(MAX_RESULTS_LIMIT, Math.max(1, Math.trunc(value)));
}

export const webSearchHandler: NativeHandler = {
  async execute(args, _config, ctx) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      throw new Error("web_search requires a non-empty query");
    }

    const maxResults = clampMaxResults(args.maxResults);
    const results = await getWebToolService().search({
      query,
      maxResults,
      signal: ctx.signal,
    });

    if (results.results.length === 0) {
      return [{ type: "text", text: `没有找到与“${query}”相关的结果。` }];
    }

    const lines = results.results.map(
      (result, index) =>
        `${index + 1}. ${result.title}\n链接：${result.url}\n摘要：${result.snippet}`,
    );

    return [{ type: "text", text: `“${query}”的搜索结果：\n\n${lines.join("\n\n")}` }];
  },
};
