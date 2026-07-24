import type { SkillDependencyCheck, SkillProvisionPlan } from "@clawbot/shared";
import { cn } from "../../lib/cn.js";
import { countPendingConditions, formatDependencyStatus, formatRuntimeLabel } from "./types.js";

type RowStatus = SkillDependencyCheck["status"];

function ChecklistRow(props: { name: string; meta?: string; status: RowStatus }) {
  const tone = formatDependencyStatus(props.status);

  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3">
      <span className={cn("size-1.5 rounded-full", tone.dot)} />
      <div className="min-w-0">
        <p className="truncate font-mono text-xs font-semibold text-ink">{props.name}</p>
        {props.meta ? <p className="mt-0.5 truncate text-xs text-muted">{props.meta}</p> : null}
      </div>
      <span className={cn("min-w-14 text-right text-xs font-semibold", tone.text)}>{tone.label}</span>
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

function HeaderSummary(props: { plan: SkillProvisionPlan; detecting: boolean }) {
  if (props.detecting) {
    return (
      <span className="flex items-center gap-1.5 text-xs font-semibold text-accent">
        <span className="status-dot size-1.5 rounded-full bg-accent" />
        检测中
      </span>
    );
  }

  const pending = countPendingConditions(props.plan);
  if (pending === 0) {
    return <span className="text-xs font-semibold text-account-success-fg">全部就绪</span>;
  }
  return <span className="text-xs font-semibold text-account-warning-fg">{pending} 项待处理</span>;
}

export function EnvironmentChecklist(props: { plan: SkillProvisionPlan; detecting?: boolean }) {
  const { runtimeCheck, dependencies } = props.plan;
  const envLabel = runtimeCheck.runtime === "python" ? "虚拟环境 .venv" : "node_modules";
  const runtimeMeta =
    runtimeCheck.status === "ok"
      ? runtimeCheck.envReady
        ? `${envLabel} 已就绪`
        : `${envLabel} 待创建`
      : `未检测到 ${runtimeCheck.binary}`;

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs tracking-label text-muted">环境检测</p>
        <HeaderSummary plan={props.plan} detecting={Boolean(props.detecting)} />
      </div>

      <div
        className={cn(
          "mt-3 grid gap-y-2.5 transition-opacity duration-200 ease-expo",
          props.detecting && "opacity-60",
        )}
      >
        <ChecklistRow
          name={formatRuntimeLabel(runtimeCheck)}
          meta={runtimeMeta}
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
        <p className="mt-2.5 text-sm leading-5 text-muted">未检测到需要安装的依赖。</p>
      ) : null}
    </div>
  );
}
