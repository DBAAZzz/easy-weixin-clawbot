import type { NativeHandler } from "../types.js";

type SearchResult = {
  title: string;
  url: string;
  snippet: string;
};

const SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_MAX_RESULTS = 5;
const MAX_RESULTS_LIMIT = 8;
const HTML_ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&quot;": "\"",
  "&apos;": "'",
  "&#39;": "'",
  "&#x27;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, "");
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(
      /&(amp|quot|apos|lt|gt);|&#39;|&#x27;/g,
      (entity) => HTML_ENTITY_MAP[entity] ?? entity,
    );
}

function extractResultBlocks(html: string): string[] {
  return [...html.matchAll(/<div class="result results_links[\s\S]*?<div class="clear"><\/div>\s*<\/div>\s*<\/div>/g)].map(
    (match) => match[0],
  );
}

function resolveResultUrl(rawHref: string): string {
  const decodedHref = decodeHtmlEntities(rawHref);
  const href = decodedHref.startsWith("//") ? `https:${decodedHref}` : decodedHref;

  try {
    const url = new URL(href, "https://duckduckgo.com");
    const redirected = url.searchParams.get("uddg");
    return redirected ? decodeURIComponent(redirected) : url.toString();
  } catch {
    return href;
  }
}

function parseResultBlock(block: string): SearchResult | null {
  const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  if (!titleMatch) {
    return null;
  }

  const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
  const title = normalizeWhitespace(decodeHtmlEntities(stripTags(titleMatch[2])));
  const url = resolveResultUrl(titleMatch[1]);
  const snippet = normalizeWhitespace(
    decodeHtmlEntities(stripTags(snippetMatch?.[1] ?? "无摘要")),
  );

  if (!title || !url) {
    return null;
  }

  return { title, url, snippet };
}

function clampMaxResults(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESULTS;
  }

  return Math.min(MAX_RESULTS_LIMIT, Math.max(1, Math.trunc(value)));
}

async function searchWeb(
  query: string,
  maxResults: number,
  signal: AbortSignal,
): Promise<SearchResult[]> {
  const url = new URL(SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("kl", "cn-zh");

  const response = await fetch(url, {
    method: "GET",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Web search failed: ${response.status} ${response.statusText}`);
  }

  const html = await response.text();

  return extractResultBlocks(html)
    .map(parseResultBlock)
    .filter((result): result is SearchResult => result !== null)
    .slice(0, maxResults);
}

export const webSearchHandler: NativeHandler = {
  async execute(args, _config, ctx) {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      throw new Error("web_search requires a non-empty query");
    }

    const maxResults = clampMaxResults(args.maxResults);
    const results = await searchWeb(query, maxResults, ctx.signal);

    if (results.length === 0) {
      return [{ type: "text", text: `没有找到与“${query}”相关的结果。` }];
    }

    const lines = results.map(
      (result, index) =>
        `${index + 1}. ${result.title}\n链接：${result.url}\n摘要：${result.snippet}`,
    );

    return [{ type: "text", text: `“${query}”的搜索结果：\n\n${lines.join("\n\n")}` }];
  },
};
