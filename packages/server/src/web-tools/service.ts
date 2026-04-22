import { BlockList, isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { withSpan } from "@clawbot/observability";
import type {
  WebFetchResponse,
  WebSearchResponse,
  WebToolService,
} from "@clawbot/agent";
import {
  webSearchProviderStore,
  type DecryptedWebSearchProvider,
  type WebSearchProviderStore,
} from "./provider-store.js";
import { type WebSearchProviderType } from "./provider-types.js";

type FetchImpl = typeof fetch;
type LookupResult = Array<{ address: string; family: number }>;

interface CreateWebToolServiceOptions {
  providerStore?: Pick<WebSearchProviderStore, "listEnabledWithApiKeys">;
  fetchImpl?: FetchImpl;
  dnsLookup?: (hostname: string) => Promise<LookupResult>;
}

class ProviderUnavailableError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

const SEARCH_PROVIDER_PRIORITY: readonly WebSearchProviderType[] = ["brave", "tavily"];
const DDG_FALLBACK_PROVIDER = "duckduckgo";
const SEARCH_TIMEOUT_MS = 8_000;
const FETCH_VALIDATION_TIMEOUT_MS = 5_000;
const FETCH_READER_TIMEOUT_MS = 15_000;
const MAX_FETCH_REDIRECTS = 5;
const MAX_FETCH_CONTENT_CHARS = 12_000;
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36";
const DUCKDUCKGO_SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";

const PRIVATE_ADDRESS_BLOCKLIST = new BlockList();

for (const [address, prefix, family] of [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"],
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"],
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.0.2.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["198.51.100.0", 24, "ipv4"],
  ["203.0.113.0", 24, "ipv4"],
  ["224.0.0.0", 4, "ipv4"],
  ["240.0.0.0", 4, "ipv4"],
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
  ["2001:db8::", 32, "ipv6"],
] as const) {
  PRIVATE_ADDRESS_BLOCKLIST.addSubnet(address, prefix, family);
}

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

function resolveDuckDuckGoResultUrl(rawHref: string): string {
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

function parseDuckDuckGoResultBlock(
  block: string,
): WebSearchResponse["results"][number] | null {
  const titleMatch = block.match(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
  if (!titleMatch) {
    return null;
  }

  const snippetMatch = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
  const title = normalizeWhitespace(decodeHtmlEntities(stripTags(titleMatch[2])));
  const url = resolveDuckDuckGoResultUrl(titleMatch[1]);
  const snippet = normalizeWhitespace(
    decodeHtmlEntities(stripTags(snippetMatch?.[1] ?? "无摘要")),
  );

  if (!title || !url) {
    return null;
  }

  return { title, url, snippet };
}

function createScopedSignal(signal: AbortSignal, timeoutMs: number): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
}

function isTimeoutError(error: unknown): boolean {
  return error instanceof Error && error.name === "TimeoutError";
}

function isNetworkError(error: unknown): error is TypeError {
  return error instanceof TypeError;
}

function isRetryableStatus(status: number): boolean {
  return status === 401 || status === 403 || status === 408 || status === 429 || status >= 500;
}

function toProviderUnavailableError(
  provider: string,
  error: unknown,
  signal: AbortSignal,
): ProviderUnavailableError {
  if (signal.aborted && !isTimeoutError(error)) {
    throw error;
  }

  if (error instanceof ProviderUnavailableError) {
    return error;
  }

  if (isTimeoutError(error)) {
    return new ProviderUnavailableError(provider, `${provider} request timed out`);
  }

  if (isNetworkError(error)) {
    return new ProviderUnavailableError(
      provider,
      `${provider} request failed: ${error.message}`,
    );
  }

  if (error instanceof Error) {
    return new ProviderUnavailableError(provider, error.message);
  }

  return new ProviderUnavailableError(provider, `${provider} request failed`);
}

function createRequestHeaders(extra?: Record<string, string>): HeadersInit {
  return {
    accept: "application/json,text/plain,text/html,application/xhtml+xml",
    "user-agent": USER_AGENT,
    ...extra,
  };
}

async function searchWithBrave(
  query: string,
  maxResults: number,
  apiKey: string,
  fetchImpl: FetchImpl,
  signal: AbortSignal,
): Promise<WebSearchResponse["results"]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(Math.max(1, Math.min(maxResults, 20))));

  const response = await fetchImpl(url, {
    method: "GET",
    headers: createRequestHeaders({
      "X-Subscription-Token": apiKey,
    }),
    signal: createScopedSignal(signal, SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    if (isRetryableStatus(response.status)) {
      throw new ProviderUnavailableError(
        "brave",
        `brave search failed with status ${response.status}`,
        response.status,
      );
    }
    throw new Error(`brave search failed with status ${response.status}`);
  }

  const payload = (await response.json().catch(() => null)) as {
    web?: {
      results?: Array<{
        title?: string;
        url?: string;
        description?: string;
        extra_snippets?: string[];
      }>;
    };
  } | null;

  const results = Array.isArray(payload?.web?.results) ? payload.web.results : [];
  return results
    .map((result) => ({
      title: normalizeWhitespace(String(result.title ?? "")),
      url: normalizeWhitespace(String(result.url ?? "")),
      snippet: normalizeWhitespace(
        String(result.description ?? result.extra_snippets?.[0] ?? "无摘要"),
      ),
    }))
    .filter((result) => result.title && result.url)
    .slice(0, maxResults);
}

async function searchWithTavily(
  query: string,
  maxResults: number,
  apiKey: string,
  fetchImpl: FetchImpl,
  signal: AbortSignal,
): Promise<WebSearchResponse["results"]> {
  const response = await fetchImpl("https://api.tavily.com/search", {
    method: "POST",
    headers: createRequestHeaders({
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    }),
    body: JSON.stringify({
      query,
      search_depth: "basic",
      topic: "general",
      max_results: Math.max(1, Math.min(maxResults, 20)),
    }),
    signal: createScopedSignal(signal, SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    if (isRetryableStatus(response.status)) {
      throw new ProviderUnavailableError(
        "tavily",
        `tavily search failed with status ${response.status}`,
        response.status,
      );
    }
    throw new Error(`tavily search failed with status ${response.status}`);
  }

  const payload = (await response.json().catch(() => null)) as {
    results?: Array<{
      title?: string;
      url?: string;
      content?: string;
    }>;
  } | null;
  const results = Array.isArray(payload?.results) ? payload.results : [];

  return results
    .map((result) => ({
      title: normalizeWhitespace(String(result.title ?? "")),
      url: normalizeWhitespace(String(result.url ?? "")),
      snippet: normalizeWhitespace(String(result.content ?? "无摘要")),
    }))
    .filter((result) => result.title && result.url)
    .slice(0, maxResults);
}

async function searchWithDuckDuckGo(
  query: string,
  maxResults: number,
  fetchImpl: FetchImpl,
  signal: AbortSignal,
): Promise<WebSearchResponse["results"]> {
  const url = new URL(DUCKDUCKGO_SEARCH_ENDPOINT);
  url.searchParams.set("q", query);
  url.searchParams.set("kl", "cn-zh");

  const response = await fetchImpl(url, {
    method: "GET",
    headers: createRequestHeaders(),
    signal: createScopedSignal(signal, SEARCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new ProviderUnavailableError(
      DDG_FALLBACK_PROVIDER,
      `duckduckgo search failed with status ${response.status}`,
      response.status,
    );
  }

  const html = await response.text();
  return extractResultBlocks(html)
    .map(parseDuckDuckGoResultBlock)
    .filter((result): result is NonNullable<typeof result> => result !== null)
    .slice(0, maxResults);
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function isBlockedHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  );
}

async function assertPublicHostname(
  hostname: string,
  dnsLookup: NonNullable<CreateWebToolServiceOptions["dnsLookup"]>,
): Promise<void> {
  if (isBlockedHostname(hostname)) {
    throw new Error("web_fetch does not allow localhost or local network hostnames");
  }

  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    const family = ipVersion === 6 ? "ipv6" : "ipv4";
    if (PRIVATE_ADDRESS_BLOCKLIST.check(hostname, family)) {
      throw new Error("web_fetch target resolves to a private or reserved address");
    }
    return;
  }

  const addresses = await dnsLookup(hostname);
  if (addresses.length === 0) {
    throw new Error("web_fetch could not resolve the target hostname");
  }

  for (const address of addresses) {
    const family = address.family === 6 ? "ipv6" : "ipv4";
    if (PRIVATE_ADDRESS_BLOCKLIST.check(address.address, family)) {
      throw new Error("web_fetch target resolves to a private or reserved address");
    }
  }
}

function normalizeFetchUrl(value: string): URL {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("web_fetch only supports http and https URLs");
  }
  if (!url.hostname) {
    throw new Error("web_fetch requires an absolute URL with a hostname");
  }
  if (url.username || url.password) {
    throw new Error("web_fetch does not allow embedded credentials in URLs");
  }
  url.hash = "";
  return url;
}

async function cancelBody(response: Response): Promise<void> {
  if (!response.body) {
    return;
  }

  await response.body.cancel().catch(() => undefined);
}

async function resolveSafeFetchUrl(
  inputUrl: string,
  fetchImpl: FetchImpl,
  dnsLookup: NonNullable<CreateWebToolServiceOptions["dnsLookup"]>,
  signal: AbortSignal,
): Promise<string> {
  let current = normalizeFetchUrl(inputUrl).toString();

  for (let redirectCount = 0; redirectCount <= MAX_FETCH_REDIRECTS; redirectCount += 1) {
    const currentUrl = normalizeFetchUrl(current);
    await assertPublicHostname(currentUrl.hostname, dnsLookup);

    const response = await fetchImpl(currentUrl, {
      method: "GET",
      redirect: "manual",
      headers: createRequestHeaders(),
      signal: createScopedSignal(signal, FETCH_VALIDATION_TIMEOUT_MS),
    });

    if (!isRedirectStatus(response.status)) {
      await cancelBody(response);
      return currentUrl.toString();
    }

    const location = response.headers.get("location");
    await cancelBody(response);
    if (!location) {
      throw new Error("web_fetch received a redirect without a location header");
    }

    current = new URL(location, currentUrl).toString();
  }

  throw new Error("web_fetch exceeded the maximum redirect limit");
}

function normalizeReaderText(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clampContent(value: string): string {
  if (value.length <= MAX_FETCH_CONTENT_CHARS) {
    return value;
  }

  return `${value.slice(0, MAX_FETCH_CONTENT_CHARS).trimEnd()}\n\n[内容已截断]`;
}

function extractTitleFromReaderText(value: string): string | null {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines.slice(0, 8)) {
    if (line.startsWith("#")) {
      const title = line.replace(/^#+\s*/, "").trim();
      if (title) {
        return title;
      }
    }
  }

  for (const line of lines.slice(0, 8)) {
    if (!line.startsWith("http") && line.length <= 160) {
      return line;
    }
  }

  return null;
}

async function fetchWithJinaReader(
  url: string,
  fetchImpl: FetchImpl,
  signal: AbortSignal,
): Promise<WebFetchResponse> {
  const readerUrl = `https://r.jina.ai/${url}`;
  const jinaApiKey = process.env.JINA_API_KEY?.trim();
  const headers = createRequestHeaders(
    jinaApiKey ? { Authorization: `Bearer ${jinaApiKey}` } : undefined,
  );

  const response = await fetchImpl(readerUrl, {
    method: "GET",
    headers,
    signal: createScopedSignal(signal, FETCH_READER_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`web_fetch failed with status ${response.status}`);
  }

  const rawText = await response.text();
  const content = clampContent(normalizeReaderText(rawText));
  return {
    title: extractTitleFromReaderText(content),
    url,
    content,
  };
}

function sortConfiguredProviders(
  providers: DecryptedWebSearchProvider[],
): DecryptedWebSearchProvider[] {
  const order = new Map(SEARCH_PROVIDER_PRIORITY.map((provider, index) => [provider, index]));
  return [...providers].sort(
    (left, right) =>
      (order.get(left.providerType) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.providerType) ?? Number.MAX_SAFE_INTEGER),
  );
}

export function createWebToolService(
  options: CreateWebToolServiceOptions = {},
): WebToolService {
  const providerStore = options.providerStore ?? webSearchProviderStore;
  const fetchImpl = options.fetchImpl ?? fetch;
  const dnsLookup =
    options.dnsLookup ??
    (async (hostname: string) => lookup(hostname, { all: true, verbatim: true }));

  return {
    async search(request: {
      query: string;
      maxResults: number;
      signal: AbortSignal;
    }) {
      return withSpan(
        "web.search",
        {
          query: request.query,
          maxResults: request.maxResults,
        },
        async (span) => {
          let configuredProviders: DecryptedWebSearchProvider[] = [];
          let providerLoadError: string | null = null;

          try {
            configuredProviders = sortConfiguredProviders(
              await providerStore.listEnabledWithApiKeys(),
            );
          } catch (error) {
            providerLoadError = error instanceof Error ? error.message : String(error);
          }

          const failures: string[] = [];
          if (providerLoadError) {
            failures.push(`config:${providerLoadError}`);
          }

          for (const provider of configuredProviders) {
            try {
              const results = await withSpan(
                "web.search.provider",
                { provider: provider.providerType, fallback: failures.length > 0 },
                async (providerSpan) => {
                  const output =
                    provider.providerType === "brave"
                      ? await searchWithBrave(
                          request.query,
                          request.maxResults,
                          provider.apiKey,
                          fetchImpl,
                          request.signal,
                        )
                      : await searchWithTavily(
                          request.query,
                          request.maxResults,
                          provider.apiKey,
                          fetchImpl,
                          request.signal,
                        );
                  providerSpan.addAttributes({ resultCount: output.length });
                  return output;
                },
              );

              span.addAttributes({
                provider: provider.providerType,
                resultCount: results.length,
                attemptedFallbacks: failures.length,
                failureChain: failures.join(" | "),
              });
              return {
                provider: provider.providerType,
                results,
              } satisfies WebSearchResponse;
            } catch (error) {
              const unavailable = toProviderUnavailableError(
                provider.providerType,
                error,
                request.signal,
              );
              failures.push(
                unavailable.statusCode
                  ? `${provider.providerType}:${unavailable.statusCode}`
                  : `${provider.providerType}:${unavailable.message}`,
              );
            }
          }

          try {
            const results = await withSpan(
              "web.search.provider",
              { provider: DDG_FALLBACK_PROVIDER, fallback: true },
              async (providerSpan) => {
                const output = await searchWithDuckDuckGo(
                  request.query,
                  request.maxResults,
                  fetchImpl,
                  request.signal,
                );
                providerSpan.addAttributes({ resultCount: output.length });
                return output;
              },
            );

            span.addAttributes({
              provider: DDG_FALLBACK_PROVIDER,
              resultCount: results.length,
              attemptedFallbacks: failures.length,
              failureChain: failures.join(" | "),
            });
            return {
              provider: DDG_FALLBACK_PROVIDER,
              results,
            } satisfies WebSearchResponse;
          } catch (error) {
            const unavailable = toProviderUnavailableError(
              DDG_FALLBACK_PROVIDER,
              error,
              request.signal,
            );
            failures.push(
              unavailable.statusCode
                ? `${DDG_FALLBACK_PROVIDER}:${unavailable.statusCode}`
                : `${DDG_FALLBACK_PROVIDER}:${unavailable.message}`,
            );
            span.addAttributes({
              attemptedFallbacks: failures.length,
              failureChain: failures.join(" | "),
            });
            throw new Error("web_search failed after exhausting all providers");
          }
        },
      );
    },

    async fetch(request: {
      url: string;
      signal: AbortSignal;
    }) {
      return withSpan(
        "web.fetch",
        { url: request.url },
        async (span) => {
          const safeUrl = await withSpan(
            "web.fetch.validate",
            { url: request.url },
            async (validationSpan) => {
              const resolvedUrl = await resolveSafeFetchUrl(
                request.url,
                fetchImpl,
                dnsLookup,
                request.signal,
              );
              validationSpan.addAttributes({ resolvedUrl });
              return resolvedUrl;
            },
          );

          const response = await withSpan(
            "web.fetch.reader",
            { provider: "jina-reader", url: safeUrl },
            async (readerSpan) => {
              const output = await fetchWithJinaReader(safeUrl, fetchImpl, request.signal);
              readerSpan.addAttributes({
                contentLength: output.content.length,
                title: output.title ?? "",
              });
              return output;
            },
          );

          span.addAttributes({
            resolvedUrl: safeUrl,
            contentLength: response.content.length,
            title: response.title ?? "",
          });
          return response;
        },
      );
    },
  };
}