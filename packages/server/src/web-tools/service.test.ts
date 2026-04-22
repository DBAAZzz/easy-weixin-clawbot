import assert from "node:assert/strict";
import test from "node:test";
import { createWebToolService } from "./service.js";
import type { DecryptedWebSearchProvider } from "./provider-store.js";

function createProvider(
  providerType: DecryptedWebSearchProvider["providerType"],
  apiKey: string,
): DecryptedWebSearchProvider {
  return {
    id: providerType === "brave" ? 1n : 2n,
    providerType,
    apiKey,
    enabled: true,
    createdAt: new Date("2026-04-21T00:00:00.000Z"),
    updatedAt: new Date("2026-04-21T00:00:00.000Z"),
  };
}

test("search falls back from Brave to Tavily on retryable failure", async () => {
  const requests: string[] = [];
  const service = createWebToolService({
    providerStore: {
      async listEnabledWithApiKeys() {
        return [createProvider("brave", "brave-key"), createProvider("tavily", "tavily-key")];
      },
    },
    fetchImpl: async (input) => {
      const url = String(input);
      requests.push(url);

      if (url.startsWith("https://api.search.brave.com/res/v1/web/search")) {
        return new Response("{}", { status: 429 });
      }

      if (url === "https://api.tavily.com/search") {
        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Tavily Result",
                url: "https://example.com/tavily",
                content: "Tavily snippet",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      throw new Error(`unexpected url: ${url}`);
    },
  });

  const result = await service.search({
    query: "clawbot",
    maxResults: 5,
    signal: AbortSignal.timeout(2_000),
  });

  assert.equal(result.provider, "tavily");
  assert.deepEqual(result.results, [
    {
      title: "Tavily Result",
      url: "https://example.com/tavily",
      snippet: "Tavily snippet",
    },
  ]);
  assert.equal(requests.length, 2);
});

test("search does not fall back when primary provider returns empty results", async () => {
  let tavilyCalled = false;
  const service = createWebToolService({
    providerStore: {
      async listEnabledWithApiKeys() {
        return [createProvider("brave", "brave-key"), createProvider("tavily", "tavily-key")];
      },
    },
    fetchImpl: async (input) => {
      const url = String(input);

      if (url.startsWith("https://api.search.brave.com/res/v1/web/search")) {
        return new Response(JSON.stringify({ web: { results: [] } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url === "https://api.tavily.com/search") {
        tavilyCalled = true;
      }

      throw new Error(`unexpected url: ${url}`);
    },
  });

  const result = await service.search({
    query: "empty result",
    maxResults: 5,
    signal: AbortSignal.timeout(2_000),
  });

  assert.equal(result.provider, "brave");
  assert.deepEqual(result.results, []);
  assert.equal(tavilyCalled, false);
});

test("search uses DuckDuckGo fallback when no configured providers exist", async () => {
  const service = createWebToolService({
    providerStore: {
      async listEnabledWithApiKeys() {
        return [];
      },
    },
    fetchImpl: async (input) => {
      const url = String(input);
      if (url.startsWith("https://html.duckduckgo.com/html/")) {
        return new Response(
          `
          <div class="result results_links">
            <div>
              <a class="result__a" href="https://example.com/ddg">DuckDuckGo Result</a>
              <a class="result__snippet">DuckDuckGo snippet</a>
              <div class="clear"></div>
            </div>
          </div>
          `,
          { status: 200, headers: { "Content-Type": "text/html" } },
        );
      }

      throw new Error(`unexpected url: ${url}`);
    },
  });

  const result = await service.search({
    query: "fallback",
    maxResults: 5,
    signal: AbortSignal.timeout(2_000),
  });

  assert.equal(result.provider, "duckduckgo");
  assert.deepEqual(result.results, [
    {
      title: "DuckDuckGo Result",
      url: "https://example.com/ddg",
      snippet: "DuckDuckGo snippet",
    },
  ]);
});

test("fetch rejects private network targets", async () => {
  const service = createWebToolService();

  await assert.rejects(
    () =>
      service.fetch({
        url: "http://127.0.0.1:8080/private",
        signal: AbortSignal.timeout(2_000),
      }),
    /private or reserved address/,
  );
});

test("fetch validates redirects and reads the final page via Jina", async () => {
  const requests: string[] = [];
  const service = createWebToolService({
    dnsLookup: async (hostname) => {
      if (hostname === "news.example.com" || hostname === "cdn.example.com") {
        return [{ address: "93.184.216.34", family: 4 }];
      }
      throw new Error(`unexpected hostname: ${hostname}`);
    },
    fetchImpl: async (input, init) => {
      const url = String(input);
      requests.push(`${init?.method ?? "GET"} ${url}`);

      if (url === "https://news.example.com/article") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://cdn.example.com/final-article" },
        });
      }

      if (url === "https://cdn.example.com/final-article") {
        return new Response("ok", { status: 200 });
      }

      if (url === "https://r.jina.ai/https://cdn.example.com/final-article") {
        return new Response("# Final Title\n\nArticle body", { status: 200 });
      }

      throw new Error(`unexpected url: ${url}`);
    },
  });

  const result = await service.fetch({
    url: "https://news.example.com/article",
    signal: AbortSignal.timeout(2_000),
  });

  assert.equal(result.url, "https://cdn.example.com/final-article");
  assert.equal(result.title, "Final Title");
  assert.equal(result.content, "# Final Title\n\nArticle body");
  assert.deepEqual(requests, [
    "GET https://news.example.com/article",
    "GET https://cdn.example.com/final-article",
    "GET https://r.jina.ai/https://cdn.example.com/final-article",
  ]);
});