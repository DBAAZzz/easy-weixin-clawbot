import type {
  MarkdownSource,
  SkillInfo,
  SkillProvisionLog,
  SkillProvisionPlan,
} from "@clawbot/shared";
import { Button, DialogFrame } from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
import { buildEnvironmentSnapshot, formatActivationLabel, formatOriginLabel } from "./types.js";
import type { SkillDetailTab } from "./types.js";
import { CompactMetaStrip } from "./CompactMetaStrip.js";
import { DetailTabButton } from "./DetailTabButton.js";
import { ExpandableSummary } from "./ExpandableSummary.js";
import { SkillMarkdownDocument } from "./SkillMarkdownDocument.js";

export function SkillDetailModal(props: {
  skill: SkillInfo;
  source: { data: MarkdownSource | null; loading: boolean; error: string | null };
  activeTab: SkillDetailTab;
  preflightBusy: boolean;
  provisionBusy: boolean;
  preflight: SkillProvisionPlan | null;
  preflightError: string | null;
  logs: SkillProvisionLog[];
  onTabChange: (tab: SkillDetailTab) => void;
  onClose: () => void;
  onPreflight: () => void | Promise<void>;
  onProvision: () => void | Promise<void>;
  onReprovision: () => void | Promise<void>;
}) {
  const overviewItems = [
    {
      label: "版本",
      value: props.skill.version,
    },
    {
      label: "激活方式",
      value: formatActivationLabel(props.skill.activation),
    },
    {
      label: "来源",
      value: formatOriginLabel(props.skill.origin),
    },
    {
      label: "状态",
      value: props.skill.enabled ? "已启用" : "已停用",
    },
  ];
  const dependencies =
    props.preflight?.dependencies.map((dependency) => dependency.name) ??
    props.skill.dependencyNames ??
    [];
  const scripts = props.skill.scriptSet ?? [];
  const markdownBody = props.source.data?.markdown ?? "";
  const runtimeMessage =
    props.skill.runtimeKind === "knowledge-only" || !props.skill.runtimeKind
      ? "该 Skill 仅提供 Markdown 知识内容，不需要独立运行时。"
      : props.skill.runtimeKind === "manual-needed"
        ? "该 Skill 需要人工确认运行方式。"
        : null;
  const environmentSnapshot = buildEnvironmentSnapshot({
    dependencies,
    scripts,
    installer: props.preflight?.installer,
    createEnv: props.preflight?.createEnv,
    commands: props.preflight?.commandPreview ?? [],
  });
  const primaryInstallAction =
    props.skill.provisionStatus === "ready" ||
    props.skill.provisionStatus === "failed" ||
    Boolean(props.skill.installedAt)
      ? props.onReprovision
      : props.onProvision;

  return (
    <DialogFrame
      open
      title={props.skill.name}
      closeLabel="关闭 skill 详情"
      contentClassName="!max-w-6xl rounded-section bg-glass-92"
      headerClassName="py-5"
      bodyClassName="py-6"
      onOpenChange={(open) => !open && props.onClose()}
      description={
        <>
          <span>
            当前状态：
            <span className="font-medium text-ink">
              {props.skill.enabled ? " 已启用" : " 已停用"}
            </span>
            {props.skill.provisionError ? (
              <span className="text-red-700"> · 最近一次安装失败</span>
            ) : null}
          </span>
          <ExpandableSummary text={props.skill.summary} />
        </>
      }
    >
      <div className="space-y-6">
        <CompactMetaStrip items={overviewItems} />

        <div>
          <div
            role="tablist"
            aria-label="Skill 详情视图"
            className="flex flex-wrap items-center gap-6 border-b border-line"
          >
            <DetailTabButton
              tab="markdown"
              activeTab={props.activeTab}
              label="文档"
              onSelect={props.onTabChange}
            />
            <DetailTabButton
              tab="runtime"
              activeTab={props.activeTab}
              label="环境配置"
              onSelect={props.onTabChange}
            />
          </div>

          <div className="pt-6">
            {props.activeTab === "markdown" ? (
              <div id="skill-panel-markdown" role="tabpanel" aria-labelledby="skill-tab-markdown">
                {props.source.loading ? (
                  <div className="space-y-3">
                    <div className="ui-skeleton h-5 rounded-lg" />
                    <div className="ui-skeleton h-4 rounded-lg" />
                    <div className="ui-skeleton h-4 rounded-lg" />
                    <div className="ui-skeleton h-4 rounded-lg" />
                    <div className="ui-skeleton h-28 rounded-section" />
                  </div>
                ) : props.source.error ? (
                  <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
                    加载源码失败：{props.source.error}
                  </div>
                ) : (
                  <div className="rounded-panel bg-detail-bg px-6 py-7 md:px-7 md:py-8">
                    <SkillMarkdownDocument markdown={markdownBody} />
                  </div>
                )}
              </div>
            ) : (
              <div id="skill-panel-runtime" role="tabpanel" aria-labelledby="skill-tab-runtime">
                <div className="space-y-6">
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    {!runtimeMessage ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={props.preflightBusy || props.provisionBusy}
                        onClick={() => void props.onPreflight()}
                      >
                        {props.preflightBusy ? "检测中…" : "重新检测"}
                      </Button>
                    ) : null}
                    {!runtimeMessage ? (
                      <Button
                        size="sm"
                        disabled={props.preflightBusy || props.provisionBusy}
                        onClick={() => void primaryInstallAction()}
                      >
                        {props.provisionBusy ? "安装中…" : "安装"}
                      </Button>
                    ) : null}
                  </div>

                  <div className="rounded-panel bg-detail-bg px-6 py-6 md:px-7 md:py-7">
                    {runtimeMessage ? (
                      <p className="text-base leading-7 text-muted-strong">{runtimeMessage}</p>
                    ) : props.preflightBusy && !props.preflight ? (
                      <div className="space-y-3">
                        <div className="ui-skeleton h-4 rounded-lg" />
                        <div className="ui-skeleton h-4 rounded-lg" />
                        <div className="ui-skeleton h-28 rounded-panel" />
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {props.preflightError ? (
                          <p className="text-sm leading-6 text-red-700">
                            环境检测失败：{props.preflightError}
                          </p>
                        ) : null}

                        {props.skill.provisionError ? (
                          <p className="text-sm leading-6 text-red-700">
                            最近一次安装失败：{props.skill.provisionError}
                          </p>
                        ) : null}

                        <div>
                          <p className="text-xs tracking-label text-muted">环境数据</p>
                          <pre className="mt-3 overflow-x-auto rounded-panel border border-line bg-white/78 px-4 py-4 text-sm leading-6 text-ink-soft">
                            {environmentSnapshot}
                          </pre>
                        </div>

                        <div className="border-t border-line pt-6">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <p className="text-xs tracking-label text-muted">安装日志</p>
                            <p className="text-sm text-muted">
                              {formatCount(props.logs.length)} 条
                            </p>
                          </div>
                          <pre className="mt-3 max-h-52 overflow-auto rounded-panel border border-line bg-white/78 px-4 py-4 text-sm leading-6 text-ink-soft">
                            {props.logs.length > 0
                              ? props.logs.map((log) => `[${log.level}] ${log.message}`).join("\n")
                              : "暂无日志"}
                          </pre>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </DialogFrame>
  );
}
