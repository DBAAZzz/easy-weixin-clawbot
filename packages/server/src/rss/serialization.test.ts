import assert from "node:assert/strict";
import test from "node:test";
import { serializePreviewItem } from "./serialization.js";
import type { EntryRecord } from "./types.js";

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
