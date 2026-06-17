import type { ToolInfo } from "@clawbot/shared";
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
} from "@clawbot/ui";
import { ExpandableDescription } from "./ExpandableDescription.js";
import { CompactMetaStrip } from "./CompactMetaStrip.js";
import { ParameterChip } from "./ParameterChip.js";
import { formatOriginLabel } from "./types.js";

function buildToolSnapshot(tool: ToolInfo) {
  return JSON.stringify(
    {
      handler: tool.handler,
      parameters: tool.parameterNames,
    },
    null,
    2,
  );
}

export function ToolDetailModal(props: { tool: ToolInfo; onClose: () => void }) {
  const overviewItems = [
    { label: "Handler", value: props.tool.handler },
    { label: "来源", value: formatOriginLabel(props.tool.origin) },
    { label: "状态", value: props.tool.enabled ? "已启用" : "已停用" },
  ];
  const parameterSnapshot = buildToolSnapshot(props.tool);

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className="max-w-4xl rounded-section bg-glass-92">
          <DialogClose
            label="关闭 tool 详情"
            className="absolute right-5 top-5 z-20 size-9 border-transparent bg-transparent text-muted hover:border-transparent hover:bg-transparent hover:text-ink"
          />

          <DialogHeader className="py-5">
            <div className="pr-10">
              <DialogTitle className="truncate">{props.tool.name}</DialogTitle>
              <p className="mt-2 text-sm text-muted">
                当前状态：
                <span className="font-medium text-ink">
                  {props.tool.enabled ? " 已启用" : " 已停用"}
                </span>
              </p>
              <ExpandableDescription text={props.tool.description} />
            </div>

            <CompactMetaStrip items={overviewItems} />
          </DialogHeader>

          <DialogBody className="py-6">
            <div className="rounded-panel bg-detail-bg">
              <div className="space-y-6">
                <div>
                  <p className="text-xs tracking-label text-muted">参数快照</p>
                  <pre className="mt-3 overflow-x-auto rounded-panel border border-line bg-white/78 px-4 py-4 text-sm leading-6 text-ink-soft">
                    {parameterSnapshot}
                  </pre>
                </div>

                <div className="border-t border-line pt-6">
                  <p className="text-xs tracking-label text-muted">输入参数</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {props.tool.parameterNames.length > 0 ? (
                      props.tool.parameterNames.map((name) => (
                        <ParameterChip key={name} name={name} />
                      ))
                    ) : (
                      <p className="text-base leading-7 text-muted-strong">
                        该 Tool 当前无输入参数。
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </DialogBody>
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}
