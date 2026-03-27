import { startTransition, useDeferredValue, useEffect, useState } from "react";
import type { MarkdownSource } from "@clawbot/shared";
import { Badge } from "../components/ui/badge.js";
import { Button } from "../components/ui/button.js";
import { Input } from "../components/ui/input.js";
import { ActivityIcon, SearchIcon, TerminalIcon } from "../components/ui/icons.js";
import { useAsyncResource } from "../hooks/use-async-resource.js";
import { useTools } from "../hooks/useTools.js";
import { cn } from "../lib/cn.js";
import { formatCount } from "../lib/format.js";
import { fetchToolSource } from "../lib/api.js";

const EDITOR_CLASSNAME =
  "min-h-[220px] w-full rounded-[16px] border border-[var(--line-strong)] bg-[rgba(255,255,255,0.82)] px-3.5 py-3 font-[var(--font-mono)] text-[12px] leading-6 text-[var(--ink)] outline-none transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-[3px] focus:ring-[rgba(21,110,99,0.14)]";

export function ToolsPage() {
  const { tools, loading, error, refresh, install, update, enable, disable, remove } = useTools();
  const [query, setQuery] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [draftMarkdown, setDraftMarkdown] = useState("");
  const [sourceRevision, setSourceRevision] = useState(0);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"save" | "toggle" | "delete" | null>(null);
  const deferredQuery = useDeferredValue(query);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredTools = tools.filter((tool) => {
    if (!normalizedQuery) return true;

    return (
      tool.name.toLowerCase().includes(normalizedQuery) ||
      tool.summary.toLowerCase().includes(normalizedQuery) ||
      tool.handler.toLowerCase().includes(normalizedQuery) ||
      tool.parameterNames.some((name) => name.toLowerCase().includes(normalizedQuery))
    );
  });
  const selectedTool = filteredTools.find((tool) => tool.name === selectedName) ?? null;
  const source = useAsyncResource<MarkdownSource>(
    selectedName ? () => fetchToolSource(selectedName) : null,
    [selectedName, sourceRevision]
  );

  useEffect(() => {
    if (!filteredTools.length) {
      setSelectedName(null);
      return;
    }

    if (!selectedName || !filteredTools.some((tool) => tool.name === selectedName)) {
      setSelectedName(filteredTools[0]?.name ?? null);
    }
  }, [filteredTools, selectedName]);

  useEffect(() => {
    if (!selectedName) {
      setDraftMarkdown("");
      return;
    }

    if (source.data?.markdown) {
      setDraftMarkdown(source.data.markdown);
    }
  }, [selectedName, source.data?.markdown]);

  const enabledCount = tools.filter((tool) => tool.enabled).length;
  const userCount = tools.filter((tool) => tool.origin === "user").length;
  const builtinCount = tools.length - userCount;
  const handlerCount = new Set(tools.map((tool) => tool.handler)).size;
  const stats = [
    { label: "Tool 总数", value: formatCount(tools.length), hint: "当前已安装" },
    { label: "启用中", value: formatCount(enabledCount), hint: "会注册给 LLM" },
    { label: "用户层", value: formatCount(userCount), hint: "可直接编辑覆盖" },
    { label: "Handler", value: formatCount(handlerCount), hint: "allowlist 数量" },
  ];

  async function refreshAll() {
    setMutationError(null);
    setNotice(null);
    refresh();
    setSourceRevision((value) => value + 1);
  }

  async function handleToggle() {
    if (!selectedTool) return;

    setMutationError(null);
    setNotice(null);
    setBusyAction("toggle");

    try {
      const result = selectedTool.enabled
        ? await disable(selectedTool.name)
        : await enable(selectedTool.name);
      setNotice(`${result.name} 已${result.enabled ? "启用" : "停用"}`);
      setSourceRevision((value) => value + 1);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSave() {
    if (!draftMarkdown.trim()) {
      setMutationError("请先输入或载入 Markdown");
      return;
    }

    setMutationError(null);
    setNotice(null);
    setBusyAction("save");

    try {
      const result = selectedTool
        ? await update(selectedTool.name, draftMarkdown)
        : await install(draftMarkdown);
      setSelectedName(result.name);
      setNotice(`${result.name} 已保存到 user 层`);
      setSourceRevision((value) => value + 1);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  }

  async function handleRemove() {
    if (!selectedTool || selectedTool.origin !== "user") return;

    setMutationError(null);
    setNotice(null);
    setBusyAction("delete");

    try {
      await remove(selectedTool.name);
      setNotice(`${selectedTool.name} 的 user 版本已删除`);
      setSourceRevision((value) => value + 1);
    } catch (reason) {
      setMutationError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyAction(null);
    }
  }

  return (
    <div className="space-y-3 md:space-y-4">
      <section className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Tools</p>
            <h2 className="mt-1.5 text-[20px] text-[var(--ink)]">Tool 管理</h2>
            <p className="mt-1 max-w-2xl text-[12px] leading-5 text-[var(--muted)]">
              Markdown 驱动的可执行工具目录。右侧可查看源码、启停，以及把定义保存到 user
              层覆盖内置版本。
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setSelectedName(null)} variant="outline">
              新建草稿
            </Button>
            <Button size="sm" onClick={() => void refreshAll()}>
              <ActivityIcon className="size-4" />
              刷新列表
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[rgba(255,255,255,0.74)]">
          <div className="grid divide-y divide-[var(--line)] md:grid-cols-4 md:divide-x md:divide-y-0">
            {stats.map((stat) => (
              <div key={stat.label} className="px-4 py-3">
                <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                  {stat.label}
                </p>
                <p className="mt-1.5 font-[var(--font-mono)] text-[18px] font-semibold text-[var(--ink)]">
                  {stat.value}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--muted)]">{stat.hint}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {error ? (
        <div className="border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
          加载 tool 列表失败：{error}
        </div>
      ) : null}

      {mutationError ? (
        <div className="border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
          操作失败：{mutationError}
        </div>
      ) : null}

      {notice ? (
        <div className="border border-[rgba(21,110,99,0.14)] bg-[rgba(240,253,250,0.92)] px-4 py-3 text-[12px] leading-6 text-[var(--accent-strong)]">
          {notice}
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.95fr)]">
        <div className="overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[rgba(255,255,255,0.74)]">
          <div className="border-b border-[var(--line)] px-3 py-3 md:px-4">
            <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-[300px]">
                  <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
                  <Input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索名称、摘要、handler 或参数"
                    className="h-9 rounded-[8px] pl-10"
                  />
                </div>

                <div className="flex items-center gap-2 rounded-[14px] border border-dashed border-[var(--line)] bg-white/42 px-3 py-2 text-[11px] text-[var(--muted)]">
                  <TerminalIcon className="size-4 text-[var(--muted-strong)]" />
                  <span>tools 来自运行中的 markdown installer</span>
                </div>
              </div>

              <div className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
                <TerminalIcon className="size-4 text-[var(--muted-strong)]" />
                <span>当前筛选结果 {formatCount(filteredTools.length)} 个 tool</span>
              </div>
            </div>
          </div>

          {loading ? (
            <div>
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="grid gap-3 border-b border-[var(--line)] px-4 py-3 last:border-b-0"
                >
                  <div className="ui-skeleton h-5 rounded-[8px]" />
                  <div className="ui-skeleton h-3 rounded-full" />
                </div>
              ))}
            </div>
          ) : null}

          {!loading && filteredTools.length === 0 ? (
            <div className="px-5 py-9 text-center">
              <p className="text-[13px] text-[var(--ink)]">没有匹配到 tool</p>
              <p className="mt-1.5 text-[12px] text-[var(--muted)]">
                可以尝试清空搜索词，或者直接在右侧粘贴 Markdown 安装新工具。
              </p>
            </div>
          ) : null}

          {!loading && filteredTools.length > 0 ? (
            <div>
              {filteredTools.map((tool, index) => {
                const isSelected = tool.name === selectedTool?.name;

                return (
                  <button
                    key={tool.name}
                    type="button"
                    onClick={() => startTransition(() => setSelectedName(tool.name))}
                    className={cn(
                      "relative block w-full border-b border-[var(--line)] px-4 py-3 text-left last:border-b-0 hover:bg-[rgba(21,110,99,0.04)]",
                      isSelected && "bg-[rgba(21,110,99,0.05)]"
                    )}
                  >
                    <span
                      className={cn(
                        "absolute inset-y-3 left-0 w-[3px] rounded-full",
                        isSelected ? "bg-[var(--accent)]" : "bg-transparent"
                      )}
                    />
                    <div className="reveal-up min-w-0" style={{ animationDelay: `${index * 30}ms` }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-[var(--font-mono)] text-[13px] font-medium text-[var(--ink)]">
                          {tool.name}
                        </p>
                        <Badge tone={tool.enabled ? "online" : "offline"}>
                          {tool.enabled ? "已启用" : "已停用"}
                        </Badge>
                        <Badge tone="muted">{tool.origin}</Badge>
                        <Badge tone="muted">{tool.handler}</Badge>
                      </div>
                      <p className="mt-2 text-[12px] leading-6 text-[var(--muted-strong)]">
                        {tool.summary}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {tool.parameterNames.length > 0 ? (
                          tool.parameterNames.map((name) => (
                            <span
                              key={name}
                              className="rounded-full border border-[var(--line)] bg-white/64 px-2.5 py-1 text-[10px] font-[var(--font-mono)] text-[var(--muted-strong)]"
                            >
                              {name}
                            </span>
                          ))
                        ) : (
                          <span className="text-[11px] text-[var(--muted)]">无参数</span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[rgba(255,255,255,0.74)]">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">
                Detail
              </p>
              <h3 className="mt-1.5 text-[16px] text-[var(--ink)]">
                {selectedTool ? selectedTool.name : "新建 Tool 草稿"}
              </h3>
            </div>

            <div className="space-y-4 px-4 py-4">
              {selectedTool ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge tone={selectedTool.enabled ? "online" : "offline"}>
                      {selectedTool.enabled ? "已启用" : "已停用"}
                    </Badge>
                    <Badge tone="muted">版本 {selectedTool.version}</Badge>
                    <Badge tone="muted">{selectedTool.origin}</Badge>
                    <Badge tone="muted">{selectedTool.handler}</Badge>
                  </div>

                  <p className="text-[12px] leading-6 text-[var(--muted-strong)]">
                    {selectedTool.summary}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant={selectedTool.enabled ? "outline" : "primary"}
                      disabled={busyAction !== null}
                      onClick={() => void handleToggle()}
                    >
                      {selectedTool.enabled ? "停用 Tool" : "启用 Tool"}
                    </Button>
                    {selectedTool.origin === "user" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyAction !== null}
                        onClick={() => void handleRemove()}
                      >
                        删除 user 版本
                      </Button>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--muted)]">
                        Source Preview
                      </p>
                      {source.loading ? (
                        <span className="text-[11px] text-[var(--muted)]">读取中</span>
                      ) : null}
                    </div>
                    <pre className="max-h-[260px] overflow-auto rounded-[16px] border border-[var(--line)] bg-[rgba(246,249,250,0.92)] px-3.5 py-3 text-[11px] leading-6 text-[var(--ink-soft)]">
                      {source.error
                        ? `加载源码失败：${source.error}`
                        : source.data?.markdown ?? "暂无源码"}
                    </pre>
                  </div>
                </>
              ) : (
                <p className="text-[12px] leading-6 text-[var(--muted)]">
                  右侧编辑区支持直接粘贴 Markdown 安装新 tool。选择左侧条目后，会自动载入源码并保存到
                  user 层。
                </p>
              )}
            </div>
          </div>

          <div className="overflow-hidden rounded-lg border border-[var(--line-strong)] bg-[rgba(255,255,255,0.74)]">
            <div className="border-b border-[var(--line)] px-4 py-3">
              <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Editor</p>
              <h3 className="mt-1.5 text-[16px] text-[var(--ink)]">保存到 User 层</h3>
            </div>

            <div className="space-y-3 px-4 py-4">
              <textarea
                value={draftMarkdown}
                onChange={(event) => setDraftMarkdown(event.target.value)}
                className={EDITOR_CLASSNAME}
                placeholder="粘贴 tool markdown。若当前选中条目，则会按该名称保存到 user 层。"
              />

              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busyAction !== null} onClick={() => void handleSave()}>
                  {selectedTool ? "覆盖到 user 层" : "安装新 Tool"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busyAction !== null}
                  onClick={() => {
                    setSelectedName(null);
                    setDraftMarkdown("");
                    setMutationError(null);
                    setNotice(null);
                  }}
                >
                  清空草稿
                </Button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
