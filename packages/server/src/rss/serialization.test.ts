import assert from "node:assert/strict";
import test from "node:test";
import { serializePreviewItem, serializePreviewSource } from "./serialization.js";
import type { EntryRecord, SourceRecord } from "./types.js";

test("serializePreviewItem sanitizes legacy HTML stored in summary/content fields", () => {
  const entry: EntryRecord = {
    id: 1n,
    sourceId: 1n,
    fingerprint: "fp",
    guid: null,
    rawLink: "https://example.com/post",
    normalizedLink: "https://example.com/post",
    title: "Legacy entry",
    author: "author",
    publishedAt: new Date("2026-04-23T04:02:45.000Z"),
    summaryText: '<p>Hello <b>World</b></p><img src="https://example.com/hero.jpg">',
    contentText: "<div>Body<br>Line</div>",
    mediaJson: [],
    metaJson: {
      contentHtml: '<div><p>Body<br>Line</p><blockquote>Quote</blockquote></div>',
    },
    collectedAt: new Date("2026-04-23T04:02:45.000Z"),
    expiresAt: null,
  };

  const preview = serializePreviewItem(entry);

  assert.equal(preview.summary_text, "Hello World");
  assert.equal(preview.content_text, "Body\nLine");
  assert.equal(preview.content_html, '<div><p>Body<br>Line</p><blockquote>Quote</blockquote></div>');
});

test("serializePreviewSource keeps preview payload minimal", () => {
  const source: SourceRecord = {
    id: 7n,
    name: "阮一峰科技爱好者",
    sourceType: "rss_url",
    routePath: null,
    feedUrl: "https://example.com/feed.xml",
    description: "weekly tech posts",
    enabled: true,
    status: "normal",
    lastFetchedAt: new Date("2026-04-23T04:02:45.000Z"),
    lastSuccessAt: new Date("2026-04-23T04:02:45.000Z"),
    lastError: null,
    failureStreak: 0,
    backoffUntil: null,
    createdAt: new Date("2026-04-22T00:00:00.000Z"),
    updatedAt: new Date("2026-04-23T00:00:00.000Z"),
  };

  assert.deepEqual(serializePreviewSource(source), {
    id: "7",
    name: "阮一峰科技爱好者",
  });
});
