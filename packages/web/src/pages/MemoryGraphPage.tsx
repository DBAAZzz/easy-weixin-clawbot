import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { TapeGraphNode } from "@clawbot/shared";
import { useAccounts } from "../hooks/useAccounts.js";
import { useConversations } from "../hooks/useConversations.js";
import { useTapeGraph } from "../hooks/useTapeGraph.js";
import { Card } from "../components/ui/card.js";
import { buttonClassName } from "../components/ui/button.js";
import { MemoryFilters } from "../components/memory/MemoryFilters.js";
import { MemoryGraph } from "../components/memory/MemoryGraph.js";
import { MemoryTooltip, formatMemoryValue } from "../components/memory/MemoryTooltip.js";
import { formatCount, formatDateTime } from "../lib/format.js";
import {
  AlertCircleIcon,
  CheckCircleIcon,
  LayersIcon,
  LinkIcon,
  NetworkIcon,
  PulseIcon,
  ScanIcon,
} from "../components/ui/icons.js";
import { Link } from "react-router-dom";

function matchesQuery(node: TapeGraphNode, query: string) {
  if (!query) return true;

  const haystack = [node.label, node.key, node.branch, node.category, formatMemoryValue(node.value)]
    .join(" ")
    .toLowerCase();

  return haystack.includes(query);
}

function StatCard(props: {
  label: string;
  value: string;
  hint: string;
  color?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-glass-76 flex h-full items-center gap-3 rounded-lg border border-slate-border px-3.5 py-3">
      {" "}
      {props.icon ? (
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-panel"
          style={{
            backgroundColor: props.color ? `${props.color}14` : "rgba(148,163,184,0.08)",
            color: props.color,
          }}
        >
          {props.icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-xs uppercase tracking-label text-muted">{props.label}</p>
          <p className="font-mono text-3xl font-semibold text-ink">{props.value}</p>
        </div>
        <p className="mt-1 text-sm leading-5 text-muted">{props.hint}</p>
      </div>
    </div>
  );
}

export function MemoryGraphPage() {
  const accounts = useAccounts({ status: "active" });
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedBranch, setSelectedBranch] = useState("__global__");
  const [query, setQuery] = useState("");
  const [selectedNode, setSelectedNode] = useState<TapeGraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<TapeGraphNode | null>(null);
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const conversations = useConversations(selectedAccountId || undefined);
  const graph = useTapeGraph(selectedAccountId || undefined, selectedBranch);

  useEffect(() => {
    if (!accounts.accounts.length) {
      if (selectedAccountId) {
        setSelectedAccountId("");
      }
      return;
    }

    if (
      !selectedAccountId ||
      !accounts.accounts.some((account) => account.id === selectedAccountId)
    ) {
      setSelectedAccountId(accounts.accounts[0].id);
    }
  }, [accounts.accounts, selectedAccountId]);

  useEffect(() => {
    if (!selectedAccountId) return;
    setSelectedBranch("__global__");
    setSelectedNode(null);
    setHoveredNode(null);
  }, [selectedAccountId]);

  const accountOptions = accounts.accounts.map((account) => ({
    value: account.id,
    label: account.display_name ?? account.alias ?? account.id,
  }));

  const branchOptions = [
    { value: "__global__", label: "全局记忆" },
    { value: "*", label: "全部分支" },
    ...conversations.conversations.map((conversation) => ({
      value: conversation.conversation_id,
      label: conversation.title
        ? `${conversation.title} · ${conversation.conversation_id}`
        : conversation.conversation_id,
    })),
  ];

  const graphNodes = graph.graph?.nodes;
  const graphEdges = graph.graph?.edges;
  const graphGroups = graph.graph?.groups;

  const nodes = useMemo(
    () => (graphNodes ?? []).filter((node) => matchesQuery(node, deferredQuery)),
    [graphNodes, deferredQuery],
  );

  const visibleNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const edges = useMemo(
    () =>
      (graphEdges ?? []).filter(
        (edge) => visibleNodeIds.has(edge.source) && visibleNodeIds.has(edge.target),
      ),
    [graphEdges, visibleNodeIds],
  );

  const groups = useMemo(
    () =>
      (graphGroups ?? []).filter((group) =>
        group.children.some((childId: string) => visibleNodeIds.has(childId)),
      ),
    [graphGroups, visibleNodeIds],
  );

  const linkedNodeIds = useMemo(
    () => new Set(edges.flatMap((edge) => [edge.source, edge.target])),
    [edges],
  );
  const isolatedCount = useMemo(
    () => nodes.filter((node) => !linkedNodeIds.has(node.id)).length,
    [nodes, linkedNodeIds],
  );

  const searchHighlightIds = useMemo(() => {
    if (!deferredQuery) return undefined;
    return new Set(nodes.map((n) => n.id));
  }, [deferredQuery, nodes]);

  const activeNode =
    selectedNode && visibleNodeIds.has(selectedNode.id)
      ? selectedNode
      : hoveredNode && visibleNodeIds.has(hoveredNode.id)
        ? hoveredNode
        : null;
  const highlightedCount = activeNode
    ? new Set(
        edges
          .filter((edge) => edge.source === activeNode.id || edge.target === activeNode.id)
          .flatMap((edge) => [edge.source, edge.target]),
      ).size
    : 0;

  // Category breakdown
  const factCount = nodes.filter((n) => n.category === "fact").length;
  const prefCount = nodes.filter((n) => n.category === "preference").length;
  const decCount = nodes.filter((n) => n.category === "decision").length;

  if (!accounts.loading && accounts.accounts.length === 0) {
    return (
      <div className="space-y-4">
        <section className="space-y-3">
          <p className="text-xs uppercase tracking-label-xl text-muted">Memory Graph</p>
          <h2 className="text-4xl text-ink">记忆图谱</h2>
        </section>

        <Card className="grid gap-5 px-5 py-7 md:grid-cols-[minmax(0,1fr)_180px] md:items-end">
          <div>
            <p className="text-xs uppercase tracking-label-xl text-muted">暂无账号</p>
          </div>

          <Link
            to="/login"
            className={buttonClassName({
              className: "w-full justify-center",
              variant: "outline",
              size: "sm",
            })}
          >
            <ScanIcon className="size-4" />
            打开扫码连接
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <section className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-label-xl text-muted">Memory Graph</p>
          <h2 className="text-4xl text-ink">记忆图谱</h2>
        </div>
      </section>

      <Card className="space-y-4 p-4 md:p-5">
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<NetworkIcon className="size-4" />}
            color="#6366F1"
            label="Nodes"
            value={formatCount(nodes.length)}
            hint={`事实 ${factCount} · 偏好 ${prefCount} · 决策 ${decCount}`}
          />
          <StatCard
            icon={<LinkIcon className="size-4" />}
            color="#8B5CF6"
            label="Edges"
            value={formatCount(edges.length)}
            hint="共现 + 前缀关联边"
          />
          <StatCard
            icon={<LayersIcon className="size-4" />}
            color="#10B981"
            label="Groups"
            value={formatCount(groups.length)}
            hint="前缀聚类组"
          />
          <StatCard
            icon={
              isolatedCount > 0 ? (
                <AlertCircleIcon className="size-4" />
              ) : (
                <CheckCircleIcon className="size-4" />
              )
            }
            color={isolatedCount > 0 ? "#F59E0B" : "#10B981"}
            label="Isolated"
            value={formatCount(isolatedCount)}
            hint={isolatedCount > 0 ? `${isolatedCount} 条记忆未建立关联` : "所有记忆已关联"}
          />
        </div>

        <div className="h-px bg-line" />

        <MemoryFilters
          accountOptions={accountOptions}
          branchOptions={branchOptions}
          selectedAccountId={selectedAccountId}
          selectedBranch={selectedBranch}
          query={query}
          loading={graph.loading || accounts.loading}
          onAccountChange={setSelectedAccountId}
          onBranchChange={setSelectedBranch}
          onQueryChange={setQuery}
          onRefresh={graph.refresh}
        />
      </Card>

      {graph.error ? (
        <div className="rounded-lg border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-6 text-red-700">
          加载记忆图失败：{graph.error}
        </div>
      ) : null}

      {/* Main content: graph + sidebar */}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <MemoryGraph
            nodes={nodes}
            edges={edges}
            selectedNodeId={selectedNode?.id ?? null}
            highlightedNodeIds={searchHighlightIds}
            onNodeHover={setHoveredNode}
            onNodeSelect={setSelectedNode}
          />

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white/72 px-3.5 py-2">
            <div className="flex items-center gap-2 text-base text-muted-strong">
              <PulseIcon className="size-4 text-accent-strong" />
              <span>{selectedAccountId ? `账号 ${selectedAccountId}` : "请选择账号"}</span>
            </div>
            <div className="h-4 w-px bg-line" />
            <span className="text-base text-muted">
              分支 {selectedBranch} · 生成时间 {formatDateTime(graph.graph?.meta.generatedAt)}
            </span>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-3">
          <MemoryTooltip node={activeNode} highlightedCount={highlightedCount} />

          <Card className="space-y-3 p-4">
            <div>
              <p className="text-xs uppercase tracking-label-lg text-muted">Prefix Groups</p>
              <h3 className="mt-1 text-xl text-ink">分组概览</h3>
            </div>

            {groups.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line bg-white/60 px-4 py-4 text-center text-base leading-6 text-muted">
                当前分支还没有可聚类的层级 key
              </div>
            ) : (
              <div className="space-y-1.5">
                {groups.slice(0, 8).map((group) => (
                  <div
                    key={group.id}
                    className="rounded-panel border border-line bg-white/72 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-base font-medium text-ink">{group.label}</p>
                      <span className="shrink-0 font-mono text-sm text-muted">
                        {group.children.length}
                      </span>
                    </div>
                  </div>
                ))}
                {groups.length > 8 ? (
                  <p className="px-1 text-sm text-muted">还有 {groups.length - 8} 个分组…</p>
                ) : null}
              </div>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
