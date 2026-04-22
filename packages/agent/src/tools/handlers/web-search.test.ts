import assert from "node:assert/strict";
import test from "node:test";
import type { WebToolService } from "../../ports/web-tool-service.js";
import { setWebToolService } from "../../ports/web-tool-service.js";
import { webSearchHandler } from "./web-search.js";

function createService(overrides: Partial<WebToolService> = {}): WebToolService {
  return {
    async search() {
      return {
        provider: "brave",
        results: [
          {
            title: "Clawbot",
            url: "https://example.com/clawbot",
            snippet: "Example snippet",
          },
        ],
      };
    },
    async fetch() {
      return {
        title: "Example",
        url: "https://example.com",
        content: "content",
      };
    },
    ...overrides,
  };
}

test("webSearchHandler delegates to WebToolService and formats results", async () => {
  const signal = AbortSignal.timeout(1_000);
  let received:
    | {
        query: string;
        maxResults: number;
        signal: AbortSignal;
      }
    | undefined;

  setWebToolService(
    createService({
      async search(request) {
        received = request;
        return {
          provider: "brave",
          results: [
            {
              title: "Clawbot Docs",
              url: "https://example.com/docs",
              snippet: "Design document",
            },
          ],
        };
      },
    }),
  );

  const result = await webSearchHandler.execute(
    { query: " clawbot ", maxResults: 3 },
    {},
    { signal },
  );

  assert.deepEqual(received, {
    query: "clawbot",
    maxResults: 3,
    signal,
  });
  assert.deepEqual(result, [
    {
      type: "text",
      text:
        "“clawbot”的搜索结果：\n\n1. Clawbot Docs\n链接：https://example.com/docs\n摘要：Design document",
    },
  ]);
});

test("webSearchHandler returns empty-result message", async () => {
  setWebToolService(
    createService({
      async search() {
        return {
          provider: "tavily",
          results: [],
        };
      },
    }),
  );

  const result = await webSearchHandler.execute(
    { query: "missing" },
    {},
    { signal: AbortSignal.timeout(1_000) },
  );

  assert.deepEqual(result, [{ type: "text", text: "没有找到与“missing”相关的结果。" }]);
});

test("webSearchHandler rejects empty queries", async () => {
  setWebToolService(createService());

  await assert.rejects(
    () =>
      webSearchHandler.execute(
        { query: "   " },
        {},
        { signal: AbortSignal.timeout(1_000) },
      ),
    /web_search requires a non-empty query/,
  );
});