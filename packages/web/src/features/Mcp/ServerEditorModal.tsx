import {
  Button,
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@clawbot/ui";
import { TAPD_MCP_JSON_EXAMPLE } from "../../lib/mcp-form.js";
import { CompactMetaStrip } from "./CompactMetaStrip.js";

export function ServerEditorModal(props: {
  mode: "create" | "edit";
  jsonText: string;
  error: string | null;
  busy: boolean;
  onClose: () => void;
  onChange: (value: string) => void;
  onFillExample: () => void;
  onSubmit: () => void | Promise<void>;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-4xl rounded-section bg-glass-92">
          <DialogClose
            label="关闭 MCP server 编辑器"
            className="absolute right-5 top-5 z-20 size-9 border-transparent bg-transparent text-muted hover:border-transparent hover:bg-transparent hover:text-ink"
          />

          <DialogHeader className="py-5">
            <div className="pr-10">
              <DialogTitle>
                {props.mode === "create" ? "粘贴标准 MCP JSON" : "编辑 MCP JSON 配置"}
              </DialogTitle>
              <p className="mt-2 text-sm leading-6 text-muted">
                {props.mode === "create"
                  ? "创建后会立即连接并刷新目录。"
                  : "保存后会重新连接并同步最新的 MCP tools。"}
              </p>
            </div>

            <CompactMetaStrip
              items={[
                { label: "模式", value: props.mode === "create" ? "新建" : "编辑" },
                { label: "格式", value: "MCP JSON" },
                {
                  label: "提交",
                  value: props.mode === "create" ? "创建并连接" : "保存并刷新",
                },
              ]}
            />
          </DialogHeader>

          <DialogBody className="py-6">
            <form
              className="space-y-6"
              onSubmit={(event) => {
                event.preventDefault();
                void props.onSubmit();
              }}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs tracking-label text-muted">配置内容</p>
                <Button type="button" size="sm" variant="secondary" onClick={props.onFillExample}>
                  填入 TAPD 示例
                </Button>
              </div>

              <div className="rounded-panel bg-detail-bg px-6 py-6 md:px-7 md:py-7">
                <div className="space-y-6">
                  <textarea
                    value={props.jsonText}
                    onChange={(event) => props.onChange(event.target.value)}
                    spellCheck={false}
                    placeholder={TAPD_MCP_JSON_EXAMPLE}
                    className="min-h-[320px] w-full rounded-panel border border-line-strong bg-white/78 px-4 py-4 font-mono text-base leading-6 text-ink outline-none transition duration-300 ease-expo placeholder:text-muted focus:border-accent focus:shadow-focus-accent"
                  />

                  {props.error ? (
                    <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
                      {props.error}
                    </div>
                  ) : null}

                  <div className="border-t border-line pt-6">
                    <p className="text-xs tracking-label text-muted">输入示例</p>
                    <pre className="mt-3 max-h-60 overflow-auto rounded-panel border border-line bg-white/78 px-4 py-4 text-sm leading-6 text-ink-soft">
                      {TAPD_MCP_JSON_EXAMPLE}
                    </pre>
                  </div>
                </div>
              </div>

              <div className="sticky bottom-0 flex flex-wrap justify-end gap-3 border-t border-line bg-glass-92 px-1 pt-4">
                <Button size="sm" type="button" variant="secondary" onClick={props.onClose}>
                  取消
                </Button>
                <Button size="sm" disabled={props.busy} type="submit">
                  {props.mode === "create" ? "创建并连接" : "保存并刷新"}
                </Button>
              </div>
            </form>
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
