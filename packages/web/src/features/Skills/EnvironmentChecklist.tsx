import type { SkillDependencyCheck, SkillProvisionPlan } from "@clawbot/shared";
import { cn } from "../../lib/cn.js";
import {
  formatDependencyStatus,
  formatInstallerLabel,
  formatRuntimeLabel,
} from "./types.js";

function StatusPill(props: { status: SkillDependencyCheck["status"] }) {
  const tone = formatDependencyStatus(props.status);

  return (
    <span className={cn("flex shrink-0 items-center gap-1.5 text-sm font-semibold", tone.text)}>
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      {tone.label}
    </span>
  );
}

function ChecklistRow(props: {
  name: string;
  meta?: string;
  status: SkillDependencyCheck["status"];
  first?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 py-2.5",
        !props.first && "border-t border-line",
      )}
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-xs font-semibold text-ink">{props.name}</p>
        {props.meta ? <p className="mt-0.5 truncate text-xs text-muted">{props.meta}</p> : null}
      </div>
      <StatusPill status={props.status} />
    </div>
  );
}

function describeDependency(dependency: SkillDependencyCheck) {
  if (dependency.status === "outdated") {
    return `已装 ${dependency.installedVersion} · 需要 ${dependency.installSpec ?? dependency.name}`;
  }
  if (dependency.status === "ok" && dependency.installedVersion) {
    return dependency.installedVersion;
  }
  if (dependency.status === "unknown") {
    return "未能读取环境信息";
  }
  return undefined;
}

export function EnvironmentChecklist(props: { plan: SkillProvisionPlan }) {
  const { runtimeCheck, dependencies } = props.plan;
  const envLabel = runtimeCheck.runtime === "python" ? "虚拟环境 .venv" : "node_modules";

  return (
    <div className="space-y-4">
      <div>
        <ChecklistRow
          first
          name={formatRuntimeLabel(runtimeCheck)}
          meta={
            runtimeCheck.status === "ok"
              ? runtimeCheck.envReady
                ? `${envLabel} 已就绪`
                : `${envLabel} 待创建`
              : `未检测到 ${runtimeCheck.binary}`
          }
          status={runtimeCheck.status === "ok" ? "ok" : "missing"}
        />

        {dependencies.map((dependency) => (
          <ChecklistRow
            key={dependency.name}
            name={dependency.name}
            meta={describeDependency(dependency)}
            status={dependency.status}
          />
        ))}
      </div>

      {dependencies.length === 0 ? (
        <p className="text-sm leading-5 text-muted">未检测到需要安装的依赖。</p>
      ) : null}

      {props.plan.commandPreview.length > 0 ? (
        <div className="border-t border-line pt-3">
          <p className="text-xs tracking-label text-muted">
            安装命令 · {formatInstallerLabel(props.plan.installer)}
          </p>
          <div className="mt-1.5 space-y-1">
            {props.plan.commandPreview.map((command) => (
              <p key={command} className="truncate font-mono text-xs text-muted-strong">
                {command}
              </p>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
