import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "./dialog.js";

test("Dialog renders a reusable modal shell with shared structure", () => {
  const html = renderToStaticMarkup(
    <Dialog open onOpenChange={() => {}}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-2xl rounded-section bg-glass-92">
          <DialogClose label="关闭测试弹窗" />
          <DialogHeader>
            <DialogTitle>测试标题</DialogTitle>
            <DialogDescription>测试说明</DialogDescription>
          </DialogHeader>
          <DialogBody>正文内容</DialogBody>
          <DialogFooter>底部操作</DialogFooter>
        </DialogContent>
      </DialogPortal>
    </Dialog>,
  );

  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /关闭测试弹窗/);
  assert.match(html, /测试标题/);
  assert.match(html, /测试说明/);
  assert.match(html, /正文内容/);
  assert.match(html, /底部操作/);
  assert.match(html, /bg-overlay/);
  assert.match(html, /rounded-section/);
});
