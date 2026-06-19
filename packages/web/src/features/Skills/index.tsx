import { startTransition, useRef } from "react";
import {
  Badge,
  Input,
  Card,
  SkillIcon,
  SearchIcon,
  Switch,
  Toggle,
  ToggleGroup,
} from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
import { cn } from "../../lib/cn.js";
import { DashboardHeader } from "../Dashboard/DashboardHeader.js";
import { StatsGrid } from "../Dashboard/StatsGrid.js";
import { SkillCard } from "./SkillCard.js";
import { SkillDetailModal } from "./SkillDetailModal.js";
import { runCheckTone, skillActivationTabs, type SkillActivationFilter } from "./types.js";
import { useSkillsPage, notifySkillInstallSuccess } from "./useSkillsPage.js";

export { notifySkillInstallSuccess, SkillDetailModal };

export function SkillsPage() {
  const {
    skills,
    loading,
    error,
    query,
    setQuery,
    activationFilter,
    setActivationFilter,
    onlyEnabled,
    setOnlyEnabled,
    setActiveSkillName,
    activeSkill,
    activeDetailTab,
    setActiveDetailTab,
    notice,
    mutationError,
    pendingToggleName,
    uploading,
    uploadCheck,
    preflightBusy,
    provisionBusy,
    preflightPlan,
    preflightError,
    provisionLogs,
    filteredSkills,
    tabCounts,
    stats,
    handleRefresh,
    source,
    handleFileUpload,
    handleToggle,
    handlePreflight,
    handleProvision,
    handleReprovision,
  } = useSkillsPage();
  const uploadInputId = "skill-upload-input";
  const uploadInputRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <div className="mx-auto max-w-7xl space-y-5 text-account-ink">
        <input
          ref={uploadInputRef}
          id={uploadInputId}
          type="file"
          accept=".zip,.md"
          className="sr-only"
          disabled={uploading}
          aria-label="上传技能"
          onChange={(event) => void handleFileUpload(event)}
        />
        <DashboardHeader
          eyebrow="Skills"
          title="技能库"
          description="管理已安装技能，按需启用或上传新的技能包"
          primaryLabel={uploading ? "上传中…" : "上传技能"}
          refreshLabel="刷新列表"
          onCreate={() => uploadInputRef.current?.click()}
          onRefresh={() => void handleRefresh()}
        />
        <StatsGrid stats={stats} />

        {error ? (
          <div className="rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-5 text-danger">
            加载 skill 列表失败：{error}
          </div>
        ) : null}

        {mutationError ? (
          <div className="rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-5 text-danger">
            操作失败：{mutationError}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-card border border-notice-success-border bg-notice-success-bg px-4 py-3 text-base leading-5 text-accent-strong">
            {notice}
          </div>
        ) : null}

        {uploadCheck ? (
          <div className="rounded-card border border-line bg-detail-bg px-4 py-3">
            <div className="flex items-center gap-2">
              <Badge tone={uploadCheck.canRunNow ? "online" : "warning"}>
                本地可运行检查：{uploadCheck.canRunNow ? "通过" : "未通过"}
              </Badge>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {uploadCheck.checks.map((check, index) => (
                <Badge key={`${check.message}-${index}`} tone={runCheckTone(check.status)}>
                  {check.message}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <Card className="!p-0">
          <div className="flex flex-col gap-4 border-b border-account-line px-4 py-4 xl:flex-row xl:items-center xl:justify-between xl:px-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="w-full md:w-account-search">
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="搜索技能名称、描述或来源"
                  leftIcon={<SearchIcon />}
                  size="sm"
                  inputClassName="rounded-card border-account-line-strong bg-account-card text-base placeholder:text-account-muted-faint focus:border-account-control-hover"
                />
              </div>

              <ToggleGroup
                value={[activationFilter]}
                onValueChange={(next) => {
                  const [selected] = next;
                  if (selected) setActivationFilter(selected as SkillActivationFilter);
                }}
                size="sm"
                tone="ink"
                variant="segmented"
              >
                {skillActivationTabs.map((item) => (
                  <Toggle
                    key={item.value}
                    value={item.value}
                    className={cn(
                      "gap-2 px-3 text-md hover:text-account-ink-soft",
                      activationFilter === item.value ? "text-account-ink" : "text-account-muted",
                    )}
                  >
                    {item.label}
                    <span
                      className={cn(
                        "rounded-pill px-1.5 py-0.5 font-mono text-sm font-semibold text-account-muted-soft",
                        activationFilter === item.value &&
                          "bg-account-filter-track text-account-muted",
                      )}
                    >
                      {formatCount(tabCounts[item.value])}
                    </span>
                  </Toggle>
                ))}
              </ToggleGroup>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-sm text-account-muted">
              <label className="inline-flex items-center gap-2 text-md font-medium text-account-muted">
                <Switch
                  checked={onlyEnabled}
                  label="仅看启用"
                  onCheckedChange={setOnlyEnabled}
                  size="sm"
                  tone="ink"
                />
                仅看启用
              </label>
              <span className="hidden h-4 w-px bg-account-line-strong md:block" />
              <span className="font-mono text-sm text-account-muted-soft">
                {formatCount(filteredSkills.length)} / {formatCount(skills.length)}
              </span>
            </div>
          </div>

          {loading ? (
            <section className="grid gap-4 p-4 xl:grid-cols-2 xl:p-5">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="overflow-hidden rounded-card border border-account-line bg-account-card px-4 py-4"
                >
                  <div className="flex items-center gap-3">
                    <div className="ui-skeleton size-11 rounded-card" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="ui-skeleton h-5 rounded-lg" />
                      <div className="ui-skeleton h-4 rounded-lg" />
                      <div className="ui-skeleton h-3 w-2/3 rounded-full" />
                    </div>
                    <div className="ui-skeleton h-8 w-12.5 rounded-full" />
                  </div>
                </div>
              ))}
            </section>
          ) : null}

          {!loading && filteredSkills.length === 0 ? (
            <section className="flex min-h-60 flex-col items-center justify-center px-6 py-12 text-center">
              <span className="flex size-12 items-center justify-center rounded-section bg-account-filter-track text-account-muted">
                <SkillIcon className="size-5" />
              </span>
              <p className="mt-4 text-lg font-semibold text-account-ink-soft">没有匹配的技能</p>
              <p className="mt-1 text-sm text-account-muted-soft">调整搜索关键词或筛选条件</p>
            </section>
          ) : null}

          {!loading && filteredSkills.length > 0 ? (
            <section className="space-y-3 p-4 xl:p-5">
              <div className="flex items-center gap-2 text-sm text-account-muted">
                <SkillIcon className="size-4 text-account-muted-soft" />
                <span>当前展示 {formatCount(filteredSkills.length)} 个已安装 skill</span>
              </div>

              <div className="grid gap-4 xl:grid-cols-2">
                {filteredSkills.map((skill, index) => (
                  <SkillCard
                    key={skill.name}
                    skill={skill}
                    index={index}
                    busy={pendingToggleName === skill.name}
                    onOpen={() =>
                      startTransition(() => {
                        setActiveSkillName(skill.name);
                        setActiveDetailTab("markdown");
                      })
                    }
                    onToggle={() => handleToggle(skill)}
                  />
                ))}
              </div>
            </section>
          ) : null}
        </Card>
      </div>

      {activeSkill ? (
        <SkillDetailModal
          skill={activeSkill}
          source={source}
          activeTab={activeDetailTab}
          preflightBusy={preflightBusy}
          provisionBusy={provisionBusy}
          preflight={preflightPlan}
          preflightError={preflightError}
          logs={provisionLogs}
          onTabChange={setActiveDetailTab}
          onClose={() => {
            setActiveSkillName(null);
            setActiveDetailTab("markdown");
          }}
          onPreflight={() => handlePreflight(activeSkill)}
          onProvision={() => handleProvision(activeSkill)}
          onReprovision={() => handleReprovision(activeSkill)}
        />
      ) : null}
    </>
  );
}
