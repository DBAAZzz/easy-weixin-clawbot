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

const MEMORY_GRAPH_DESCRIPTION =
  "把 Tape 中当前折叠后的 fact、preference、decision 映射成可交互网络图。节点大小反映置信度，连线粒子动画展示数据链路。";

function matchesQuery(node: TapeGraphNode, query: string) {
  if (!query) return true;

  const haystack = [
    node.label,
    node.key,
    node.branch,
    node.category,
    formatMemoryValue(node.value),
  ]
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
    <div className="flex h-full items-center gap-3 rounded-[16px] border border-[rgba(148,163,184,0.14)] bg-[rgba(255,255,255,0.76)] px-3.5 py-3">
      {props.icon ? (
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-[12px]"
          style={{ backgroundColor: props.color ? `${props.color}14` : "rgba(148,163,184,0.08)", color: props.color }}
        >
          {props.icon}
        </div>
      ) : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-[10px] uppercase tracking-[0.2em] text-[var(--muted)]">{props.label}</p>
          <p className="font-[var(--font-mono)] text-[18px] font-semibold text-[var(--ink)]">
            {props.value}
          </p>
        </div>
        <p className="mt-1 text-[11px] leading-5 text-[var(--muted)]">{props.hint}</p>
      </div>
    </div>
  );
}

export function MemoryGraphPage() {
  const accounts = useAccounts();
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
      setSelectedAccountId("");
      return;
    }

    if (!selectedAccountId || !accounts.accounts.some((account) => account.id === selectedAccountId)) {
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
          <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Memory Graph</p>
          <h2 className="text-[20px] text-[var(--ink)]">记忆图谱</h2>
        </section>

        <Card className="grid gap-5 px-5 py-7 md:grid-cols-[minmax(0,1fr)_180px] md:items-end">
          <div>
            <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">暂无账号</p>
            <h3 className="mt-2 text-[18px] text-[var(--ink)]">先建立至少一个连接账号</h3>
            <p className="mt-2 max-w-2xl text-[12px] leading-6 text-[var(--muted)]">
              记忆网络图依赖 Tape 数据。完成扫码登录并产生会话后，页面会自动展示该账号的记忆节点和关联。
            </p>
          </div>

          <Link to="/login" className={buttonClassName({ className: "justify-center", size: "sm" })}>
            打开扫码连接
            <ScanIcon className="size-4" />
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <section className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-[0.24em] text-[var(--muted)]">Memory Graph</p>
          <div className="flex items-center gap-2">
            <h2 className="text-[20px] text-[var(--ink)]">记忆图谱</h2>
            <span
              className="inline-flex size-7 items-center justify-center rounded-full border border-[var(--line)] bg-white/72 text-[var(--muted)]"
              title={MEMORY_GRAPH_DESCRIPTION}
            >
              <AlertCircleIcon className="size-3.5" />
            </span>
          </div>
          <p className="max-w-2xl text-[11px] leading-5 text-[var(--muted)]">
            可视化 Tape 折叠后的事实、偏好与决策关系网络。
          </p>
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
            icon={isolatedCount > 0 ? <AlertCircleIcon className="size-4" /> : <CheckCircleIcon className="size-4" />}
            color={isolatedCount > 0 ? "#F59E0B" : "#10B981"}
            label="Isolated"
            value={formatCount(isolatedCount)}
            hint={isolatedCount > 0 ? `${isolatedCount} 条记忆未建立关联` : "所有记忆已关联"}
          />
        </div>

        <div className="h-px bg-[var(--line)]" />

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
        <div className="rounded-[16px] border border-[rgba(185,28,28,0.12)] bg-[rgba(254,242,242,0.9)] px-4 py-3 text-[12px] leading-6 text-red-700">
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

          <div className="flex flex-wrap items-center gap-3 rounded-[14px] border border-[var(--line)] bg-white/72 px-3.5 py-2">
            <div className="flex items-center gap-2 text-[12px] text-[var(--muted-strong)]">
              <PulseIcon className="size-4 text-[var(--accent-strong)]" />
              <span>
                {selectedAccountId ? `账号 ${selectedAccountId}` : "请选择账号"}
              </span>
            </div>
            <div className="h-4 w-px bg-[var(--line)]" />
            <span className="text-[12px] text-[var(--muted)]">
              分支 {selectedBranch} · 生成时间 {formatDateTime(graph.graph?.meta.generatedAt)}
            </span>
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-3">
          <MemoryTooltip node={activeNode} highlightedCount={highlightedCount} />

          <Card className="space-y-3 p-4">
            <div>
              <p className="text-[10px] uppercase tracking-[0.22em] text-[var(--muted)]">Prefix Groups</p>
              <h3 className="mt-1 text-[15px] text-[var(--ink)]">分组概览</h3>
            </div>

            {groups.length === 0 ? (
              <div className="rounded-[14px] border border-dashed border-[var(--line)] bg-white/60 px-4 py-4 text-center text-[12px] leading-6 text-[var(--muted)]">
                当前分支还没有可聚类的层级 key
              </div>
            ) : (
              <div className="space-y-1.5">
                {groups.slice(0, 8).map((group) => (
                  <div
                    key={group.id}
                    className="rounded-[12px] border border-[var(--line)] bg-white/72 px-3 py-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="truncate text-[12px] font-medium text-[var(--ink)]">{group.label}</p>
                      <span className="shrink-0 font-[var(--font-mono)] text-[11px] text-[var(--muted)]">
                        {group.children.length}
                      </span>
                    </div>
                  </div>
                ))}
                {groups.length > 8 ? (
                  <p className="px-1 text-[11px] text-[var(--muted)]">
                    还有 {groups.length - 8} 个分组…
                  </p>
                ) : null}
              </div>
            )}
          </Card>

          <Card className="space-y-2 p-4">
            <div className="flex items-center gap-2 text-[var(--muted-strong)]">
              <AlertCircleIcon className="size-3.5" />
              <p className="text-[11px] font-medium text-[var(--ink)]">操作提示</p>
            </div>
            <div className="space-y-1 text-[11px] leading-5 text-[var(--muted)]">
              <p>• 拖拽节点整理布局，滚轮缩放</p>
              <p>• 点击节点高亮邻居，流光粒子展示关联</p>
              <p>• 搜索自动定位并高亮匹配节点</p>
              <p>• 节点越大代表置信度越高</p>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}
