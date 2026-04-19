import { startTransition, useDeferredValue, useEffect, useRef, useState, type ChangeEvent } from "react";
import type {
  MarkdownSource,
  SkillInfo,
  SkillLocalRunCheck,
  SkillProvisionLog,
  SkillProvisionPlan,
} from "@clawbot/shared";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { ActivityIcon, PuzzleIcon, SearchIcon, UploadIcon, XIcon } from "../components/ui/icons.js";
import { useQuery } from "@tanstack/react-query";
import { useSkills } from "../hooks/useSkills.js";
import { fetchSkillSource } from "@/api/skills.js";
import { queryKeys } from "../lib/query-keys.js";
import { cn } from "../lib/cn.js";
import { formatCount } from "../lib/format.js";
import { formatRuntimeKindLabel, isAutoProvisionableRuntime } from "./skills-runtime-labels.js";

function formatActivationLabel(activation: SkillInfo["activation"]) {
  return activation === "always" ? "Always-On" : "On-Demand";
}

function formatOriginLabel(origin: SkillInfo["origin"]) {
  return origin === "builtin" ? "内置" : "用户层";
}

function formatProvisionStatusLabel(status?: SkillInfo["provisionStatus"]) {
  if (!status) return "未声明";
  if (status === "pending") return "待安装";
  if (status === "provisioning") return "安装中";
  if (status === "ready") return "已就绪";
  return "失败";
}

function provisionTone(status?: SkillInfo["provisionStatus"]): "muted" | "warning" | "online" | "error" {
  if (!status) return "muted";
  if (status === "pending") return "warning";
  if (status === "provisioning") return "warning";
  if (status === "ready") return "online";
  return "error";
}

function runCheckTone(status: "ok" | "fail" | "info"): "online" | "error" | "muted" {
  if (status === "ok") return "online";
  if (status === "fail") return "error";
  return "muted";
}

function SkillAvatar(props: { origin: SkillInfo["origin"] }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-frost-92",
        props.origin === "builtin"
          ? "border-line text-ink"
          : "border-accent-border text-accent-strong",
      )}
    >
      <PuzzleIcon className="size-[18px]" />
    </span>
  );
}

function SkillToggle(props: {
  enabled: boolean;
  busy: boolean;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      disabled={props.busy}
      aria-label={props.enabled ? "停用 skill" : "启用 skill"}
      aria-pressed={props.enabled}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void props.onToggle();
      }}
      className={cn(
        "relative inline-flex h-8 w-[50px] shrink-0 items-center rounded-full border p-1 transition duration-200 ease-expo disabled:cursor-not-allowed disabled:opacity-60",
        props.enabled
          ? "border-toggle-border bg-accent"
          : "border-line-strong bg-toggle-off-strong",
      )}
    >
      <span
        className={cn(
          "size-6 rounded-full bg-white shadow-float transition duration-200 ease-expo",
          props.enabled ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

function SkillCard(props: {
  skill: SkillInfo;
  index: number;
  busy: boolean;
  onOpen: () => void;
  onToggle: () => void | Promise<void>;
}) {
  const metadata = [
    `版本 ${props.skill.version}`,
    formatActivationLabel(props.skill.activation),
    formatOriginLabel(props.skill.origin),
  ];

  return (
    <div
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      aria-label={`查看 ${props.skill.name} 详情`}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          props.onOpen();
        }
      }}
      className="reveal-up group flex min-h-[108px] cursor-pointer items-center gap-3 rounded-lg border border-card-line bg-card-bg px-3.5 py-3.5 transition duration-200 ease-expo hover:-translate-y-0.5 hover:border-notice-success-border hover:bg-card-hover focus-visible:outline-none focus-visible:shadow-focus-accent md:px-4"
      style={{ animationDelay: `${props.index * 40}ms` }}
    >
      <SkillAvatar origin={props.skill.origin} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-lg font-semibold tracking-title text-ink">{props.skill.name}</h3>
          <Badge
            tone="muted"
            className="border-transparent bg-accent-mist px-2 py-1 text-2xs tracking-tag text-accent-strong"
          >
            {formatActivationLabel(props.skill.activation)}
          </Badge>
        </div>

        <p className="mt-1 truncate text-base leading-5 text-muted-strong">{props.skill.summary}</p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          {metadata.map((item, index) => (
            <span key={item} className="flex items-center gap-2">
              {index > 0 ? <span className="size-1 rounded-full bg-line-strong" /> : null}
              <span>{item}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <SkillToggle enabled={props.skill.enabled} busy={props.busy} onToggle={props.onToggle} />
        <span className="text-xs font-medium text-muted">
          {props.skill.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </div>
  );
}

function DetailItem(props: { label: string; value: string }) {
  return (
    <div className="rounded-section border border-line bg-detail-bg px-4 py-3">
      <p className="text-xs uppercase tracking-label text-muted">{props.label}</p>
      <p className="mt-1.5 text-md font-medium text-ink">{props.value}</p>
    </div>
  );
}

function SkillDetailModal(props: {
  skill: SkillInfo;
  source: { data: MarkdownSource | null; loading: boolean; error: string | null };
  toggleBusy: boolean;
  provisionBusy: boolean;
  preflight: SkillProvisionPlan | null;
  preflightError: string | null;
  logs: SkillProvisionLog[];
  onClose: () => void;
  onToggle: () => void | Promise<void>;
  onPreflight: () => void | Promise<void>;
  onProvision: () => void | Promise<void>;
  onReprovision: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label="关闭 skill 详情"
        onClick={props.onClose}
        className="absolute inset-0 bg-overlay backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-detail-title"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-pill border border-modal-border bg-card-hover shadow-modal"
      >
        <div className="border-b border-line px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <SkillAvatar origin={props.skill.origin} />
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-label-xl text-muted">Skill Detail</p>
                <h3
                  id="skill-detail-title"
                  className="mt-1.5 truncate text-5xl font-semibold tracking-heading text-ink"
                >
                  {props.skill.name}
                </h3>
                <p className="mt-2 max-w-2xl text-md leading-6 text-muted-strong">
                  {props.skill.summary}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white/80 text-muted-strong transition hover:border-line-strong hover:text-ink"
            >
              <XIcon className="size-4" />
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Badge tone={props.skill.enabled ? "online" : "offline"}>
              {props.skill.enabled ? "已启用" : "已停用"}
            </Badge>
            <Badge tone="muted">{formatActivationLabel(props.skill.activation)}</Badge>
            <Badge tone="muted">{formatOriginLabel(props.skill.origin)}</Badge>
            {props.skill.runtimeKind && props.skill.runtimeKind !== "knowledge-only" ? (
              <Badge tone="muted">运行形态：{formatRuntimeKindLabel(props.skill.runtimeKind)}</Badge>
            ) : null}
            {isAutoProvisionableRuntime(props.skill.runtimeKind) ? (
              <Badge tone={provisionTone(props.skill.provisionStatus)}>
                运行时：{formatProvisionStatusLabel(props.skill.provisionStatus)}
              </Badge>
            ) : null}
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-6">
          <div className="grid gap-3 md:grid-cols-2">
            <DetailItem label="Version" value={props.skill.version} />
            <DetailItem label="Activation" value={formatActivationLabel(props.skill.activation)} />
            <DetailItem label="Source" value={formatOriginLabel(props.skill.origin)} />
            <DetailItem label="Status" value={props.skill.enabled ? "已启用" : "已停用"} />
          </div>

          <div className="rounded-xl border border-line bg-detail-bg px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-label-lg text-muted">Markdown Source</p>
              </div>

              <Button
                size="sm"
                variant={props.skill.enabled ? "outline" : "primary"}
                disabled={props.toggleBusy}
                onClick={() => void props.onToggle()}
              >
                {props.skill.enabled ? "停用 Skill" : "启用 Skill"}
              </Button>
            </div>

            <div className="mt-4">
              {props.source.loading ? (
                <div className="space-y-2">
                  <div className="ui-skeleton h-4 rounded-lg" />
                  <div className="ui-skeleton h-4 rounded-lg" />
                  <div className="ui-skeleton h-4 rounded-lg" />
                  <div className="ui-skeleton h-28 rounded-lg" />
                </div>
              ) : (
                <pre className="max-h-[320px] overflow-auto rounded-section border border-line bg-detail-bg-strong px-4 py-3 text-sm leading-6 text-ink-soft">
                  {props.source.error
                    ? `加载源码失败：${props.source.error}`
                    : (props.source.data?.markdown ?? "暂无源码")}
                </pre>
              )}
            </div>
          </div>

          {props.skill.runtimeKind && props.skill.runtimeKind !== "knowledge-only" ? (
            <div className="rounded-xl border border-line bg-detail-bg px-4 py-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-label-lg text-muted">Runtime Provision</p>
                </div>
                {isAutoProvisionableRuntime(props.skill.runtimeKind) ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="outline" disabled={props.provisionBusy} onClick={() => void props.onPreflight()}>
                      预检
                    </Button>
                    <Button size="sm" disabled={props.provisionBusy} onClick={() => void props.onProvision()}>
                      {props.provisionBusy ? "安装中…" : "流式安装"}
                    </Button>
                    <Button size="sm" variant="outline" disabled={props.provisionBusy} onClick={() => void props.onReprovision()}>
                      重装
                    </Button>
                  </div>
                ) : (
                  <Badge tone="warning">该 Skill 需要人工确认运行方式</Badge>
                )}
              </div>

              {props.preflightError ? (
                <div className="mt-3 rounded-section border border-notice-error-border bg-notice-error-bg px-3 py-2 text-sm text-red-700">
                  预检失败：{props.preflightError}
                </div>
              ) : null}

              {props.preflight ? (
                <div className="mt-3 rounded-section border border-line bg-detail-bg-strong px-3 py-3 text-sm text-ink-soft">
                  <p>运行时：{props.preflight.runtime}</p>
                  <p className="mt-1">安装器：{props.preflight.installer}</p>
                  <p className="mt-1">需要创建环境：{props.preflight.createEnv ? "是" : "否"}</p>
                  <p className="mt-1">
                    依赖：
                    {props.preflight.dependencies.length > 0
                      ? props.preflight.dependencies.map((item) => item.name).join(", ")
                      : "(none)"}
                  </p>
                  <div className="mt-2 space-y-1">
                    {props.preflight.commandPreview.map((step) => (
                      <p key={step}>- {step}</p>
                    ))}
                  </div>
                </div>
              ) : null}

              <div className="mt-3 rounded-section border border-line bg-detail-bg-strong px-3 py-3">
                <p className="text-xs uppercase tracking-label text-muted">Provision Logs (SSE)</p>
                <pre className="mt-2 max-h-52 overflow-auto text-xs leading-5 text-ink-soft">
                  {props.logs.length > 0
                    ? props.logs.map((log) => `[${log.level}] ${log.message}`).join("\n")
                    : "暂无日志"}
                </pre>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function SkillsPage() {
  const {
    skills,
    loading,
    error,
    refresh,
    enable,
    disable,
    uploadFile,
    preflight,
    reprovision,
    streamProvision,
  } = useSkills();
  const [query, setQuery] = useState("");
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingToggleName, setPendingToggleName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadCheck, setUploadCheck] = useState<SkillLocalRunCheck | null>(null);
  const [provisionBusy, setProvisionBusy] = useState(false);
  const [preflightPlan, setPreflightPlan] = useState<SkillProvisionPlan | null>(null);
  const [preflightError, setPreflightError] = useState<string | null>(null);
  const [provisionLogs, setProvisionLogs] = useState<SkillProvisionLog[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredSkills = skills.filter((skill) => {
    if (!normalizedQuery) return true;

    return [skill.name, skill.summary, skill.activation, skill.origin, skill.author ?? ""].some(
      (value) => value.toLowerCase().includes(normalizedQuery),
    );
  });
  const activeSkill = skills.find((skill) => skill.name === activeSkillName) ?? null;
  const sourceQuery = useQuery({
    queryKey: queryKeys.skillSource(activeSkillName ?? ""),
    queryFn: () => fetchSkillSource(activeSkillName!),
    enabled: Boolean(activeSkillName),
  });
  const source = {
    data: sourceQuery.data ?? null,
    loading: Boolean(activeSkillName) && sourceQuery.isPending,
    error:
      sourceQuery.error instanceof Error
        ? sourceQuery.error.message
        : sourceQuery.error
          ? String(sourceQuery.error)
          : null,
  };

  useEffect(() => {
    if (!activeSkillName) return;

    if (!skills.some((skill) => skill.name === activeSkillName)) {
      setActiveSkillName(null);
    }
  }, [activeSkillName, skills]);

  useEffect(() => {
    if (!activeSkillName) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setActiveSkillName(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeSkillName]);

  useEffect(() => {
    setPreflightPlan(null);
    setPreflightError(null);
    setProvisionLogs([]);
  }, [activeSkillName]);

  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const alwaysOnCount = skills.filter((skill) => skill.activation === "always").length;
  const onDemandCount = skills.length - alwaysOnCount;

  async function handleRefresh() {
    setNotice(null);
    setMutationError(null);
    setUploadCheck(null);
    refresh();
  }

  async function handleFileUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    // Reset the input so the same file can be re-selected
    event.target.value = "";

    setNotice(null);
    setMutationError(null);
    setUploadCheck(null);
    setUploading(true);

    try {
      const result = await uploadFile(file);
      setNotice(`技能 "${result.name}" 安装成功`);
      setUploadCheck(result.localRunCheck ?? null);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setUploading(false);
    }
  }

  async function handlePreflight(skill: SkillInfo) {
    setPreflightError(null);
    setPreflightPlan(null);
    try {
      const plan = await preflight(skill.name);
      setPreflightPlan(plan);
    } catch (reason) {
      setPreflightError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function handleProvision(skill: SkillInfo) {
    setProvisionBusy(true);
    setPreflightError(null);
    setProvisionLogs([]);
    setMutationError(null);

    try {
      await streamProvision(skill.name, {
        onLog: (log) => setProvisionLogs((prev) => [...prev, log]),
        onError: (payload) => {
          setMutationError(payload.error);
        },
      });
      await handleRefresh();
      setNotice(`技能 "${skill.name}" 运行时安装完成`);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProvisionBusy(false);
    }
  }

  async function handleReprovision(skill: SkillInfo) {
    setProvisionBusy(true);
    setMutationError(null);
    setPreflightError(null);
    setProvisionLogs([]);

    try {
      const result = await reprovision(skill.name);
      setProvisionLogs(result.logs);
      setNotice(`技能 "${skill.name}" 已完成重装`);
      await handleRefresh();
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setProvisionBusy(false);
    }
  }

  async function handleToggle(skill: SkillInfo) {
    setNotice(null);
    setMutationError(null);
    setPendingToggleName(skill.name);

    try {
      const result = skill.enabled ? await disable(skill.name) : await enable(skill.name);
      setNotice(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPendingToggleName(null);
    }
  }

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
                variant="outline"
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
                  onOpen={() => startTransition(() => setActiveSkillName(skill.name))}
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
          toggleBusy={pendingToggleName === activeSkill.name}
          provisionBusy={provisionBusy}
          preflight={preflightPlan}
          preflightError={preflightError}
          logs={provisionLogs}
          onClose={() => setActiveSkillName(null)}
          onToggle={() => handleToggle(activeSkill)}
          onPreflight={() => handlePreflight(activeSkill)}
          onProvision={() => handleProvision(activeSkill)}
          onReprovision={() => handleReprovision(activeSkill)}
        />
      ) : null}
    </>
  );
}
