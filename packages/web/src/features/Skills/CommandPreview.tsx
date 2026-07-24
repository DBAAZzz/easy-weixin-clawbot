import type { SkillProvisionPlan } from "@clawbot/shared";
import { formatInstallerLabel } from "./types.js";

export function CommandPreview(props: { plan: SkillProvisionPlan }) {
  if (props.plan.commandPreview.length === 0) {
    return null;
  }

  return (
    <div>
      <p className="text-xs tracking-label text-muted">
        安装命令 · {formatInstallerLabel(props.plan.installer)}
      </p>
      <div className="mt-2 space-y-1">
        {props.plan.commandPreview.map((command) => (
          <p key={command} className="truncate font-mono text-xs text-muted">
            {command}
          </p>
        ))}
      </div>
    </div>
  );
}
