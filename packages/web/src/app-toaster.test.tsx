import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("AppToaster renders the Clawbot notification landmark", async () => {
  const { AppToaster } = await import("@clawbot/ui").catch(() => ({
    AppToaster: () => null,
  }));

  const html = renderToStaticMarkup(createElement(AppToaster));

  assert.match(html, /aria-label="Clawbot 通知(?: [^"]+)?"/);
});
