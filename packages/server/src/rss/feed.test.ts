import assert from "node:assert/strict";
import test from "node:test";
import { parseFeedItems } from "./feed.js";

test("parseFeedItems keeps rich description as text and sanitizes HTML into summary/content", () => {
  const xml = `
    <rss version="2.0">
      <channel>
        <item>
          <title>🖼 #Tools #Design #AI #OpenSource</title>
          <description><p><a href="https://t.me/NewlearnerChannel/15442?q=%23Tools">#Tools</a> <a href="https://t.me/NewlearnerChannel/15442?q=%23Design">#Design</a><br><br><span class="emoji">👷</span> <b>Kami：一个开源的 AI 原生文档设计系统</b><br><br>频道：<a href="https://t.me/NewlearnerChannel" target="_blank">@NewlearnerChannel</a></p><img src="https://example.com/cover.jpg" width="800" height="554"></description>
          <link>https://t.me/NewlearnerChannel/15442</link>
          <guid isPermaLink="false">https://t.me/NewlearnerChannel/15442</guid>
          <pubDate>Thu, 23 Apr 2026 04:02:45 GMT</pubDate>
          <author>Tw93</author>
        </item>
      </channel>
    </rss>
  `;

  const [item] = parseFeedItems(xml);

  assert.ok(item);
  assert.equal(item.normalizedLink, "https://t.me/NewlearnerChannel/15442");
  assert.equal(item.author, "Tw93");
  assert.match(String(item.metaJson.contentHtml ?? ""), /<p>/);
  assert.match(String(item.metaJson.contentHtml ?? ""), /<img /);
  assert.equal(item.summaryText?.includes("<"), false);
  assert.equal(item.contentText?.includes("<"), false);
  assert.match(item.summaryText ?? "", /Kami：一个开源的 AI 原生文档设计系统/);
  assert.match(item.summaryText ?? "", /@NewlearnerChannel/);
  assert.match(item.contentText ?? "", /#Tools #Design/);
  assert.match(item.contentText ?? "", /Kami：一个开源的 AI 原生文档设计系统/);
  assert.match(item.contentText ?? "", /频道：@NewlearnerChannel/);
  assert.match(item.contentText ?? "", /\n/);
});

test("parseFeedItems keeps content:encoded as raw text before sanitizing", () => {
  const xml = `
    <rss xmlns:content="http://purl.org/rss/1.0/modules/content/" version="2.0">
      <channel>
        <item>
          <title>Long form post</title>
          <link>https://example.com/post</link>
          <content:encoded><div><p>Hello <b>World</b></p><p>Second line</p><img src="https://example.com/hero.jpg"></div></content:encoded>
        </item>
      </channel>
    </rss>
  `;

  const [item] = parseFeedItems(xml);

  assert.ok(item);
  assert.equal(item.normalizedLink, "https://example.com/post");
  assert.match(String(item.metaJson.contentHtml ?? ""), /<div>/);
  assert.equal(item.contentText?.includes("<"), false);
  assert.match(item.contentText ?? "", /Hello World/);
  assert.match(item.contentText ?? "", /Second line/);
  assert.match(item.contentText ?? "", /\n/);
});
