import { startTransition } from "react";
import {
  Badge,
  Button,
  Input,
  ActivityIcon,
  PuzzleIcon,
  SearchIcon,
  UploadIcon,
} from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
import { SkillCard } from "./SkillCard.js";
import { SkillDetailModal } from "./SkillDetailModal.js";
import { runCheckTone } from "./types.js";
import { useSkillsPage, notifySkillInstallSuccess } from "./useSkillsPage.js";

export { notifySkillInstallSuccess, SkillDetailModal };

export function SkillsPage() {
  const {
    skills,
    loading,
    error,
    query,
    setQuery,
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
    fileInputRef,
    filteredSkills,
    source,
    enabledCount,
    alwaysOnCount,
    onDemandCount,
    handleRefresh,
    handleFileUpload,
    handleToggle,
    handlePreflight,
    handleProvision,
    handleReprovision,
  } = useSkillsPage();

  return (
    <>
      <div className="space-y-5">
        <section className="space-y-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-label-xl text-muted">Skills</p>
              <h2 className="mt-1.5 text-6xl text-ink">已安装技能</h2>
            </div>

            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".zip,.md"
                className="hidden"
                onChange={(event) => void handleFileUpload(event)}
              />
              <Button
                size="sm"
                variant="secondary"
                disabled={uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <UploadIcon className="size-4" />
                {uploading ? "上传中…" : "上传技能"}
              </Button>
              <Button size="sm" onClick={() => void handleRefresh()}>
                <ActivityIcon className="size-4" />
                刷新列表
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-[360px]">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 skill 名称、摘要或来源"
                className="h-10 rounded-lg pl-10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone="muted">已安装 {formatCount(skills.length)}</Badge>
              <Badge tone="muted">启用 {formatCount(enabledCount)}</Badge>
              <Badge tone="muted">Always-On {formatCount(alwaysOnCount)}</Badge>
              <Badge tone="muted">On-Demand {formatCount(onDemandCount)}</Badge>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            加载 skill 列表失败：{error}
          </div>
        ) : null}

        {mutationError ? (
          <div className="rounded-section border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
            操作失败：{mutationError}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-section border border-notice-success-border bg-notice-success-bg px-4 py-3 text-base leading-6 text-accent-strong">
            {notice}
          </div>
        ) : null}

        {uploadCheck ? (
          <div className="rounded-section border border-line bg-detail-bg px-4 py-3">
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

        {loading ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-lg border border-line bg-glass-80 px-3.5 py-3.5 md:px-4"
              >
                <div className="flex items-center gap-3">
                  <div className="ui-skeleton size-10 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="ui-skeleton h-5 rounded-lg" />
                    <div className="ui-skeleton h-4 rounded-lg" />
                    <div className="ui-skeleton h-3 w-2/3 rounded-full" />
                  </div>
                  <div className="ui-skeleton h-8 w-[50px] rounded-full" />
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {!loading && filteredSkills.length === 0 ? (
          <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
            <p className="text-xl font-medium text-ink">没有匹配到 skill</p>
          </section>
        ) : null}

        {!loading && filteredSkills.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted">
              <PuzzleIcon className="size-4 text-muted-strong" />
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
