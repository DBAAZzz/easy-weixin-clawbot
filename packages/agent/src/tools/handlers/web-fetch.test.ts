import assert from "node:assert/strict";
import test from "node:test";
import type { WebToolService } from "../../ports/web-tool-service.js";
import { setWebToolService } from "../../ports/web-tool-service.js";
import { webFetchHandler } from "./web-fetch.js";

function createService(overrides: Partial<WebToolService> = {}): WebToolService {
  return {
    async search() {
      return {
        provider: "brave",
        results: [],
      };
    },
    async fetch() {
      return {
        title: "Example",
        url: "https://example.com/page",
        content: "正文内容",
      };
    },
    ...overrides,
  };
}

test("webFetchHandler delegates to WebToolService and formats content", async () => {
  const signal = AbortSignal.timeout(1_000);
  let received:
    | {
        url: string;
        signal: AbortSignal;
      }
    | undefined;

  setWebToolService(
    createService({
      async fetch(request) {
        received = request;
        return {
          title: "Fetched Title",
          url: request.url,
          content: "抓取结果正文",
        };
      },
    }),
  );

  const result = await webFetchHandler.execute(
    { url: " https://example.com/post " },
    {},
    { signal },
  );

  assert.deepEqual(received, {
    url: "https://example.com/post",
    signal,
  });
  assert.deepEqual(result, [
    {
      type: "text",
      text: "标题：Fetched Title\n来源：https://example.com/post\n\n抓取结果正文",
    },
  ]);
});

test("webFetchHandler falls back to 未提供 when title is missing", async () => {
  setWebToolService(
    createService({
      async fetch(request) {
        return {
          title: null,
          url: request.url,
          content: "无标题正文",
        };
      },
    }),
  );

  const result = await webFetchHandler.execute(
    { url: "https://example.com/no-title" },
    {},
    { signal: AbortSignal.timeout(1_000) },
  );

  assert.deepEqual(result, [
    {
      type: "text",
      text: "标题：未提供\n来源：https://example.com/no-title\n\n无标题正文",
    },
  ]);
});

test("webFetchHandler rejects empty urls", async () => {
  setWebToolService(createService());

  await assert.rejects(
    () =>
      webFetchHandler.execute(
        { url: "   " },
        {},
        { signal: AbortSignal.timeout(1_000) },
      ),
    /web_fetch requires a non-empty url/,
  );
});