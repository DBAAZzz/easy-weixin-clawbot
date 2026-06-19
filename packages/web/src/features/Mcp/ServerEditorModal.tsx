import {
  Button,
  DialogAction,
  DialogFrame,
  DialogMain,
  DialogSidebar,
  DialogSplit,
} from "@clawbot/ui";
import { TAPD_MCP_JSON_EXAMPLE } from "../../lib/mcp-form.js";

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
  const title = props.mode === "create" ? "新建 MCP 服务" : "编辑 MCP 服务";
  const submitLabel = props.mode === "create" ? "创建并连接" : "保存并刷新";

  return (
    <DialogFrame
      open
      layout="split"
      title={title}
      description={
        props.mode === "create"
          ? "粘贴标准 MCP JSON，创建后会立即连接。"
          : "修改 MCP JSON，保存后会重新连接。"
      }
      contentClassName="max-w-6xl rounded-dialog"
      bodyClassName="p-0 md:p-0"
      closeLabel="关闭 MCP server 编辑器"
      onOpenChange={(open) => !open && props.onClose()}
      footer={
        <div className="cb-dialog-footer-actions">
          <DialogAction type="button" onClick={props.onClose}>
            取消
          </DialogAction>
          <DialogAction
            type="submit"
            form="mcp-server-editor-form"
            disabled={props.busy}
            variant="primary"
          >
            {submitLabel}
          </DialogAction>
        </div>
      }
    >
      <DialogSplit className="mcp-editor-split">
        <DialogMain>
          <form
            id="mcp-server-editor-form"
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void props.onSubmit();
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold uppercase tracking-caps-lg text-account-muted-soft">
                配置内容
              </p>
              <Button type="button" size="sm" variant="secondary" onClick={props.onFillExample}>
                填入示例
              </Button>
            </div>

            <textarea
              value={props.jsonText}
              onChange={(event) => props.onChange(event.target.value)}
              spellCheck={false}
              placeholder={TAPD_MCP_JSON_EXAMPLE}
              className="min-h-96 w-full resize-y rounded-panel border border-account-line-strong bg-account-card px-4 py-4 font-mono text-base leading-6 text-account-ink outline-none transition duration-200 ease-expo placeholder:text-account-muted-faint focus:border-account-control-hover focus:shadow-focus-accent"
            />

            {props.error ? (
              <div className="rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-5 text-danger">
                {props.error}
              </div>
            ) : null}
          </form>
        </DialogMain>

        <DialogSidebar className="bg-account-card">
          <div className="space-y-3">
            <p className="text-sm font-semibold uppercase tracking-caps-lg text-account-muted-soft">
              示例代码
            </p>
            <pre className="max-h-160 overflow-auto rounded-panel border border-account-line bg-account-table-head px-3 py-3 font-mono text-xs leading-5 text-account-ink-soft">
              {TAPD_MCP_JSON_EXAMPLE}
            </pre>
          </div>
        </DialogSidebar>
      </DialogSplit>
    </DialogFrame>
  );
}
