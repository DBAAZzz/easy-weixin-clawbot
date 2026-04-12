import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { MarkdownSource, SkillInfo } from "@clawbot/shared";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { ActivityIcon, PuzzleIcon, SearchIcon, XIcon } from "../components/ui/icons.js";
import { useQuery } from "@tanstack/react-query";
import { useSkills } from "../hooks/useSkills.js";
import { fetchSkillSource } from "@/api/skills.js";
import { queryKeys } from "../lib/query-keys.js";
import { cn } from "../lib/cn.js";
import { formatCount } from "../lib/format.js";

function formatActivationLabel(activation: SkillInfo["activation"]) {
  return activation === "always" ? "Always-On" : "On-Demand";
}

function formatOriginLabel(origin: SkillInfo["origin"]) {
  return origin === "builtin" ? "内置" : "用户层";
}

function SkillAvatar(props: { origin: SkillInfo["origin"] }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-[rgba(247,250,251,0.92)]",
        props.origin === "builtin"
          ? "border-[var(--line)] text-[var(--ink)]"
          : "border-[rgba(21,110,99,0.12)] text-[var(--accent-strong)]",
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
        "relative inline-flex h-8 w-[50px] shrink-0 items-center rounded-full border p-1 transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] disabled:cursor-not-allowed disabled:opacity-60",
        props.enabled
          ? "border-[rgba(28,100,242,0.14)] bg-[var(--accent)]"
          : "border-[var(--line-strong)] bg-[rgba(148,163,184,0.38)]",
      )}
    >
      <span
        className={cn(
          "size-6 rounded-full bg-white shadow-[0_8px_18px_-10px_rgba(15,23,42,0.45)] transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
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
      className="reveal-up group flex min-h-[108px] cursor-pointer items-center gap-3 rounded-lg border border-[rgba(21,32,43,0.08)] bg-[rgba(255,255,255,0.88)] px-3.5 py-3.5 transition duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] hover:-translate-y-0.5 hover:border-[rgba(21,110,99,0.14)] hover:bg-[rgba(255,255,255,0.96)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(21,110,99,0.14)] md:px-4"
      style={{ animationDelay: `${props.index * 40}ms` }}
    >
      <SkillAvatar origin={props.skill.origin} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[14px] font-semibold tracking-[-0.03em] text-[var(--ink)]">
            {props.skill.name}
          </h3>
          <Badge
            tone="muted"
            className="border-transparent bg-[rgba(21,110,99,0.08)] px-2 py-1 text-[9px] tracking-[0.08em] text-[var(--accent-strong)]"
          >
            {formatActivationLabel(props.skill.activation)}
          </Badge>
        </div>

        <p className="mt-1 truncate text-[12px] leading-5 text-[var(--muted-strong)]">
          {props.skill.summary}
        </p>

        <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--muted)]">
          {metadata.map((item, index) => (
            <span key={item} className="flex items-center gap-2">
              {index > 0 ? <span className="size-1 rounded-full bg-[var(--line-strong)]" /> : null}
              <span>{item}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <SkillToggle enabled={props.skill.enabled} busy={props.busy} onToggle={props.onToggle} />
        <span className="text-[10px] font-medium text-[var(--muted)]">
          {props.skill.enabled ? "已启用" : "已停用"}
        </span>
      </div>
    </div>
  );
}

function DetailItem(props: { label: string; value: string }) {
  return (
    <div className="rounded-[18px] border border-[var(--line)] bg-[rgba(247,250,251,0.84)] px-4 py-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">{props.label}</p>
      <p className="mt-1.5 text-[13px] font-medium text-[var(--ink)]">{props.value}</p>
    </div>
  );
}

function SkillDetailModal(props: {
  skill: SkillInfo;
  source: { data: MarkdownSource | null; loading: boolean; error: string | null };
  toggleBusy: boolean;
  onClose: () => void;
  onToggle: () => void | Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
      <button
        type="button"
        aria-label="关闭 skill 详情"
        onClick={props.onClose}
        className="absolute inset-0 bg-[rgba(15,23,42,0.24)] backdrop-blur-[8px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="skill-detail-title"
        className="relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[30px] border border-[rgba(21,32,43,0.1)] bg-[rgba(255,255,255,0.96)] shadow-[0_40px_120px_-56px_rgba(15,23,42,0.52)]"
      >
        <div className="border-b border-[var(--line)] px-5 py-4 md:px-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-4">
              <SkillAvatar origin={props.skill.origin} />
              <div className="min-w-0">
                <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">
                  Skill Detail
                </p>
                <h3
                  id="skill-detail-title"
                  className="mt-1.5 truncate text-[22px] font-semibold tracking-[-0.04em] text-[var(--ink)]"
                >
                  {props.skill.name}
                </h3>
                <p className="mt-2 max-w-2xl text-[13px] leading-6 text-[var(--muted-strong)]">
                  {props.skill.summary}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={props.onClose}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-[var(--line)] bg-white/80 text-[var(--muted-strong)] transition hover:border-[var(--line-strong)] hover:text-[var(--ink)]"
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
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-6">
          <div className="grid gap-3 md:grid-cols-2">
            <DetailItem label="Version" value={props.skill.version} />
            <DetailItem label="Activation" value={formatActivationLabel(props.skill.activation)} />
            <DetailItem label="Source" value={formatOriginLabel(props.skill.origin)} />
            <DetailItem label="Status" value={props.skill.enabled ? "已启用" : "已停用"} />
          </div>

          <div className="rounded-xl border border-[var(--line)] bg-[rgba(247,250,251,0.84)] px-4 py-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  Markdown Source
                </p>
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
                  <div className="ui-skeleton h-4 rounded-[8px]" />
                  <div className="ui-skeleton h-4 rounded-[8px]" />
                  <div className="ui-skeleton h-4 rounded-[8px]" />
                  <div className="ui-skeleton h-28 rounded-lg" />
                </div>
              ) : (
                <pre className="max-h-[320px] overflow-auto rounded-[18px] border border-[var(--line)] bg-[rgba(255,255,255,0.94)] px-4 py-3 text-[11px] leading-6 text-[var(--ink-soft)]">
                  {props.source.error
                    ? `加载源码失败：${props.source.error}`
                    : (props.source.data?.markdown ?? "暂无源码")}
                </pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function SkillsPage() {
  const { skills, loading, error, refresh, enable, disable } = useSkills();
  const [query, setQuery] = useState("");
  const [activeSkillName, setActiveSkillName] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [pendingToggleName, setPendingToggleName] = useState<string | null>(null);
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

  const enabledCount = skills.filter((skill) => skill.enabled).length;
  const alwaysOnCount = skills.filter((skill) => skill.activation === "always").length;
  const onDemandCount = skills.length - alwaysOnCount;

  async function handleRefresh() {
    setNotice(null);
    setMutationError(null);
    refresh();
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
              <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Skills</p>
              <h2 className="mt-1.5 text-[24px] text-[var(--ink)]">已安装技能</h2>
            </div>

            <Button size="sm" onClick={() => void handleRefresh()}>
              <ActivityIcon className="size-4" />
              刷新列表
            </Button>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full xl:max-w-[360px]">
              <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="搜索 skill 名称、摘要或来源"
                className="h-10 rounded-lg pl-10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
              <Badge tone="muted">已安装 {formatCount(skills.length)}</Badge>
              <Badge tone="muted">启用 {formatCount(enabledCount)}</Badge>
              <Badge tone="muted">Always-On {formatCount(alwaysOnCount)}</Badge>
              <Badge tone="muted">On-Demand {formatCount(onDemandCount)}</Badge>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
            加载 skill 列表失败：{error}
          </div>
        ) : null}

        {mutationError ? (
          <div className="rounded-[18px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
            操作失败：{mutationError}
          </div>
        ) : null}

        {notice ? (
          <div className="rounded-[18px] border border-[rgba(21,110,99,0.14)] bg-[rgba(240,253,250,0.92)] px-4 py-3 text-[12px] leading-6 text-[var(--accent-strong)]">
            {notice}
          </div>
        ) : null}

        {loading ? (
          <section className="grid gap-4 xl:grid-cols-2">
            {Array.from({ length: 6 }).map((_, index) => (
              <div
                key={index}
                className="overflow-hidden rounded-lg border border-[var(--line)] bg-[rgba(255,255,255,0.8)] px-3.5 py-3.5 md:px-4"
              >
                <div className="flex items-center gap-3">
                  <div className="ui-skeleton size-10 rounded-lg" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="ui-skeleton h-5 rounded-[8px]" />
                    <div className="ui-skeleton h-4 rounded-[8px]" />
                    <div className="ui-skeleton h-3 w-2/3 rounded-full" />
                  </div>
                  <div className="ui-skeleton h-8 w-[50px] rounded-full" />
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {!loading && filteredSkills.length === 0 ? (
          <section className="rounded-[28px] border border-dashed border-[var(--line)] bg-[rgba(255,255,255,0.48)] px-5 py-10 text-center">
            <p className="text-[15px] font-medium text-[var(--ink)]">没有匹配到 skill</p>
          </section>
        ) : null}

        {!loading && filteredSkills.length > 0 ? (
          <section className="space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
              <PuzzleIcon className="size-4 text-[var(--muted-strong)]" />
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
          onClose={() => setActiveSkillName(null)}
          onToggle={() => handleToggle(activeSkill)}
        />
      ) : null}
    </>
  );
}
