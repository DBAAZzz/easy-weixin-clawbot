import { toast } from "@clawbot/ui";
import { Badge } from "@clawbot/ui";
import { Button } from "@clawbot/ui";
import { Input } from "@clawbot/ui";
import { Select } from "@clawbot/ui";
import { LinkIcon, PlusIcon, RefreshIcon, StackIcon } from "@clawbot/ui";
import { toggleScheduledTask } from "@/api/scheduled-tasks.js";
import { formatCount } from "../../lib/format.js";
import { TaskCard } from "./TaskCard.js";
import { TaskEditorDialog } from "./TaskEditorDialog.js";
import { PreviewDialog } from "./PreviewDialog.js";
import { RunsDialog } from "./RunsDialog.js";
import { useTaskCenter } from "./useTaskCenter.js";
import { EMPTY_TASK_DRAFT, createTaskDraft } from "./types.js";

export function TaskCenterPage() {
  const {
    accounts,
    accountIdFilter,
    draft,
    editingTask,
    editorOpen,
    error,
    filteredTasks,
    loading,
    navigate,
    preview,
    previewOpen,
    refresh,
    runsTask,
    saving,
    searchQuery,
    setDraft,
    setEditingTask,
    setEditorOpen,
    setPreviewOpen,
    setRunsTask,
    setSearchParams,
    setSearchQuery,
    sourceOptions,
    stats,
    handleSave,
    handleDelete,
    handleRunNow,
    openPreview,
  } = useTaskCenter();

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">Task Center</p>
            <h2 className="mt-1.5 text-6xl text-ink">任务中心</h2>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => void refresh()}>
              <RefreshIcon className="size-4" />
              刷新
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setEditingTask(null);
                setDraft({
                  ...EMPTY_TASK_DRAFT,
                  accountId: accountIdFilter ?? accounts[0]?.id ?? "",
                });
                setEditorOpen(true);
              }}
            >
              <PlusIcon className="size-4" />
              新建任务
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
          <Badge tone="muted">总数 {formatCount(stats.total)}</Badge>
          <Badge tone="online">启用 {formatCount(stats.enabled)}</Badge>
          <Badge tone="warning">运行中 {formatCount(stats.running)}</Badge>
          <Badge tone="error">异常 {formatCount(stats.errors)}</Badge>
        </div>

        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_160px]">
          <Input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="搜索任务名称、账号或订阅源..."
          />
          <Select
            size="sm"
            value={accountIdFilter ?? "all"}
            onChange={(value) => {
              if (value === "all") {
                setSearchParams({});
                return;
              }
              setSearchParams({ accountId: value });
            }}
            options={[
              { value: "all", label: "全部账号" },
              ...accounts.map((account) => ({
                value: account.id,
                label: account.alias || account.display_name || account.id,
              })),
            ]}
          />
          <Button size="sm" variant="secondary" onClick={() => navigate("/rss-subscriptions")}>
            <LinkIcon className="size-4" />
            管理订阅
          </Button>
        </div>
      </section>

      {error ? (
        <div className="rounded-panel border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
          加载任务失败：{error instanceof Error ? error.message : String(error)}
        </div>
      ) : null}

      {loading ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="rounded-lg border border-line bg-glass-80 px-5 py-5">
              <div className="ui-skeleton h-5 rounded-lg" />
              <div className="mt-3 ui-skeleton h-4 rounded-lg" />
              <div className="mt-4 ui-skeleton h-20 rounded-lg" />
            </div>
          ))}
        </section>
      ) : null}

      {!loading && filteredTasks.length === 0 ? (
        <section className="rounded-dialog border border-dashed border-line bg-glass-48 px-5 py-10 text-center">
          <StackIcon className="mx-auto size-8 text-muted" />
          <p className="mt-3 text-xl font-medium text-ink">暂无 RSS 任务</p>
          <p className="mt-2 text-base leading-6 text-muted">
            先配置订阅源，再创建快讯任务或摘要任务。
          </p>
        </section>
      ) : null}

      {!loading && filteredTasks.length > 0 ? (
        <section className="grid gap-4 xl:grid-cols-2">
          {filteredTasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              account={accounts.find((account) => account.id === task.account_id)}
              onPreview={() => void openPreview(task)}
              onRuns={() => setRunsTask(task)}
              onRunNow={() => void handleRunNow(task)}
              onEdit={() => {
                setEditingTask(task);
                setDraft(createTaskDraft(task));
                setEditorOpen(true);
              }}
              onToggle={async () => {
                try {
                  await toggleScheduledTask(task.account_id, task.seq, !task.enabled);
                  toast.success(`${task.name} 已${task.enabled ? "暂停" : "恢复"}`);
                  await refresh();
                } catch (toggleIssue) {
                  toast.error(toggleIssue instanceof Error ? toggleIssue.message : "更新失败");
                }
              }}
              onDelete={() => void handleDelete(task)}
            />
          ))}
        </section>
      ) : null}

      <TaskEditorDialog
        open={editorOpen}
        draft={draft}
        accounts={accounts}
        sourceOptions={sourceOptions}
        saving={saving}
        editing={Boolean(editingTask)}
        onOpenChange={setEditorOpen}
        onChange={setDraft}
        onSave={() => void handleSave()}
      />
      <PreviewDialog open={previewOpen} preview={preview} onOpenChange={setPreviewOpen} />
      <RunsDialog
        open={Boolean(runsTask)}
        accountId={runsTask?.account_id ?? ""}
        seq={runsTask?.seq ?? 0}
        taskName={runsTask?.name ?? ""}
        onOpenChange={(open) => {
          if (!open) {
            setRunsTask(null);
          }
        }}
      />
    </div>
  );
}
