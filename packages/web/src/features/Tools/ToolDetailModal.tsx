import type { ToolInfo } from "@clawbot/shared";
import {
  Badge,
  DialogMetaItem,
  DialogParamItem,
  DialogSidebarSection,
  SplitDialog,
  ToolsIcon,
} from "@clawbot/ui";
import { formatOriginLabel } from "./types.js";

function buildToolSnapshot(tool: ToolInfo) {
  return JSON.stringify(
    {
      name: tool.name,
      origin: tool.origin,
      enabled: tool.enabled,
      parameters: tool.parameterNames,
    },
    null,
    2,
  );
}

export function ToolDetailModal(props: { tool: ToolInfo; onClose: () => void }) {
  const parameterSnapshot = buildToolSnapshot(props.tool);
  const statusBadge = (
    <Badge
      size="sm"
      tone={props.tool.enabled ? "online" : "muted"}
      bordered={false}
      showDot={false}
    >
      {props.tool.enabled ? "已启用" : "已停用"}
    </Badge>
  );

  return (
    <SplitDialog
      open
      closeLabel="关闭 tool 详情"
      description={props.tool.description}
      icon={<ToolsIcon />}
      status={statusBadge}
      title={props.tool.name}
      tone={props.tool.enabled ? "success" : "neutral"}
      onOpenChange={(open) => !open && props.onClose()}
      sidebar={
        <>
          <DialogSidebarSection title="元信息">
            <dl className="grid gap-4">
              <DialogMetaItem label="来源" value={formatOriginLabel(props.tool.origin)} />
              <DialogMetaItem label="状态" value={statusBadge} />
              <DialogMetaItem label="参数" value={`${props.tool.parameterNames.length} 个`} mono />
            </dl>
          </DialogSidebarSection>

          <DialogSidebarSection title="输入参数">
            <div className="grid gap-2">
              {props.tool.parameterNames.length > 0 ? (
                props.tool.parameterNames.map((name) => (
                  <DialogParamItem key={name} name={name} required />
                ))
              ) : (
                <p className="text-sm text-account-muted-soft">无输入参数</p>
              )}
            </div>
          </DialogSidebarSection>
        </>
      }
    >
      <div className="space-y-6">
        <section>
          <p className="text-xs font-semibold tracking-label text-account-muted-soft">参数快照</p>
          <pre className="mt-3 overflow-x-auto rounded-panel border border-account-line bg-account-card px-4 py-4 text-sm leading-6 text-account-ink-soft">
            {parameterSnapshot}
          </pre>
        </section>
      </div>
    </SplitDialog>
  );
}
