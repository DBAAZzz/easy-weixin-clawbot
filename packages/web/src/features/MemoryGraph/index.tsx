import { useDeferredValue, useEffect, useMemo, useState } from "react";
import type { TapeGraphNode } from "@clawbot/shared";
import { Card, ClockIcon, GitBranchIcon, RobotIcon, buttonClassName } from "@clawbot/ui";
import { useAccounts } from "@/hooks/useAccounts.js";
import { useConversations } from "@/hooks/useConversations.js";
import { useTapeGraph } from "@/hooks/useTapeGraph.js";
import { MemoryFilters, MemoryGlobalBadge } from "@/components/memory/MemoryFilters.js";
import { MemoryGraph } from "@/components/memory/MemoryGraph.js";
import { MemoryTooltip } from "@/components/memory/MemoryTooltip.js";
import { formatCount, formatDateTime } from "@/lib/format.js";
import { Link } from "react-router-dom";
import { matchesQuery } from "./types.js";
import { StatCard, StatBreakdownItem, StatMeta } from "./StatCard.js";
import { PrefixGroups } from "./PrefixGroups.js";

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
    { value: "__global__", label: "main", suffix: <MemoryGlobalBadge /> },
    { value: "*", label: "全部分支" },
    ...conversations.conversations.map((conversation) => ({
      value: conversation.conversation_id,
      label: conversation.title?.trim() || "未命名会话",
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
  const activeDegree = activeNode
    ? edges.filter((edge) => edge.source === activeNode.id || edge.target === activeNode.id).length
    : 0;

  const activeNeighbors = useMemo(() => {
    if (!activeNode) return [];
    const neighborIds = new Set<string>();
    for (const edge of edges) {
      if (edge.source === activeNode.id) neighborIds.add(edge.target);
      else if (edge.target === activeNode.id) neighborIds.add(edge.source);
    }
    return nodes.filter((node) => neighborIds.has(node.id));
  }, [activeNode, edges, nodes]);

  const activePinned = !!selectedNode && activeNode?.id === selectedNode.id;

  const factCount = nodes.filter((n) => n.category === "fact").length;
  const prefCount = nodes.filter((n) => n.category === "preference").length;
  const decCount = nodes.filter((n) => n.category === "decision").length;

  const connectedCount = nodes.length - isolatedCount;
  const avgDegree = nodes.length > 0 ? ((2 * edges.length) / nodes.length).toFixed(1) : "0";

  const selectedAccount = accounts.accounts.find((a) => a.id === selectedAccountId);

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery);
    graph.refresh();
  };

  if (!accounts.loading && accounts.accounts.length === 0) {
    return (
      <div className="space-y-4">
        <section>
          <p className="text-xs font-semibold uppercase tracking-caps-lg text-account-muted-soft">
            Memory Graph
          </p>
          <h2 className="mt-2 text-page-title font-bold leading-tight tracking-body text-account-ink">
            记忆图谱
          </h2>
        </section>

        <Card className="grid gap-5 px-5 py-7 md:grid-cols-[minmax(0,1fr)_180px] md:items-end">
          <div>
            <p className="text-base uppercase tracking-label-xl text-muted">暂无账号</p>
          </div>

          <Link
            to="/login"
            className={buttonClassName({
              className: "w-full justify-center",
              variant: "secondary",
              size: "sm",
            })}
          >
            打开扫码连接
          </Link>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 text-account-ink">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-caps-lg text-account-muted-soft">
            Memory Graph
          </p>
          <h1 className="mt-2 text-page-title font-bold leading-tight tracking-body text-account-ink">
            记忆图谱
          </h1>
          <p className="mt-2 text-sm leading-5 text-account-muted">
            浏览账号记忆节点、关联关系与前缀聚类
          </p>
        </div>
      </section>

      <MemoryFilters
        accountOptions={accountOptions}
        branchOptions={branchOptions}
        selectedAccountId={selectedAccountId}
        selectedBranch={selectedBranch}
        query={query}
        loading={graph.loading || accounts.loading}
        onAccountChange={setSelectedAccountId}
        onBranchChange={setSelectedBranch}
        onQueryChange={handleQueryChange}
      />

      {/* ===== Stats ===== */}
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="记忆节点"
          englishLabel="Nodes"
          value={formatCount(nodes.length)}
          dotClassName="bg-account-ink"
        >
          <StatBreakdownItem dotClassName="bg-account-muted" label="事实" value={factCount} />
          <StatBreakdownItem dotClassName="bg-account-success-dot" label="偏好" value={prefCount} />
          <StatBreakdownItem dotClassName="bg-danger" label="决策" value={decCount} />
        </StatCard>

        <StatCard
          label="关联边"
          englishLabel="Edges"
          value={formatCount(edges.length)}
          dotClassName="bg-account-success-dot"
        >
          <StatMeta>
            平均度 <b className="font-mono font-bold text-account-ink-soft">{avgDegree}</b> · 已连接{" "}
            <b className="font-mono font-bold text-account-ink-soft">{connectedCount}</b> 节点
          </StatMeta>
        </StatCard>

        <StatCard
          label="前缀聚类组"
          englishLabel="Groups"
          value={formatCount(groups.length)}
          dotClassName="bg-account-warning-dot"
        >
          <StatMeta>
            按 <span className="font-mono text-account-ink-soft">key</span> 前缀自动聚类
          </StatMeta>
        </StatCard>

        <StatCard
          label="孤立节点"
          englishLabel="Isolated"
          value={formatCount(isolatedCount)}
          dotClassName="bg-account-muted-faint"
        >
          <StatMeta>无任何关联边</StatMeta>
        </StatCard>
      </section>

      {graph.error ? (
        <div className="rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 text-base leading-5 text-danger">
          加载记忆图失败：{graph.error}
        </div>
      ) : null}

      {/* ===== Graph + sidebar ===== */}
      <section className="grid gap-4 xl:grid-cols-[1fr_auto]">
        <div className="overflow-hidden rounded-section border border-account-line bg-account-card shadow-account-card">
          <div className="flex flex-wrap items-center justify-between gap-5 border-b border-account-line px-5 py-4">
            <div className="flex items-center gap-4">
              <span className="text-md font-semibold text-account-ink">关系图谱</span>
              <span className="inline-flex items-center gap-1.5 text-base text-account-muted">
                <span className="size-2.5 rounded-full bg-account-muted" />
                事实
              </span>
              <span className="inline-flex items-center gap-1.5 text-base text-account-muted">
                <span className="size-2.5 rounded-full bg-account-success-dot" />
                偏好
              </span>
              <span className="inline-flex items-center gap-1.5 text-base text-account-muted">
                <span className="size-2.5 rounded-full bg-danger" />
                决策
              </span>
            </div>
            <span className="text-base text-account-muted-faint">
              点击节点高亮关联 · 点击空白取消
            </span>
          </div>

          <div className="relative min-h-96 bg-account-page">
            <MemoryGraph
              nodes={nodes}
              edges={edges}
              selectedNodeId={selectedNode?.id ?? null}
              highlightedNodeIds={searchHighlightIds}
              onNodeHover={setHoveredNode}
              onNodeSelect={setSelectedNode}
            />
          </div>
        </div>

        <div className="flex w-96 flex-col gap-4">
          <MemoryTooltip
            node={activeNode}
            degree={activeDegree}
            pinned={activePinned}
            neighbors={activeNeighbors}
            onSelectNeighbor={setSelectedNode}
          />
          <PrefixGroups groups={groups} nodes={nodes} visibleNodeIds={visibleNodeIds} />
        </div>
      </section>

      {/* ===== Meta bar ===== */}
      <div className="flex flex-wrap items-center gap-6 px-5 py-3.5 text-base text-account-muted-faint">
        <span className="inline-flex items-center gap-2">
          <RobotIcon className="size-4 text-account-muted-soft" />
          账号{" "}
          <span className="font-semibold text-account-ink-soft">
            {selectedAccount?.display_name ?? selectedAccount?.alias ?? selectedAccountId}
          </span>
          <span className="font-mono text-account-muted-faint">{selectedAccountId}</span>
        </span>

        <span className="h-3 w-px bg-account-line-strong" />

        <span className="inline-flex items-center gap-2">
          <GitBranchIcon className="size-4 text-account-muted-soft" />
          分支{" "}
          <span className="font-mono font-semibold text-account-ink-soft">{selectedBranch}</span>
          {selectedBranch === "__global__" ? (
            <span className="rounded-full bg-account-success-bg px-1.5 py-0.5 text-xs font-semibold text-account-success-fg">
              全局
            </span>
          ) : null}
        </span>

        <span className="h-3 w-px bg-account-line-strong" />

        <span className="inline-flex items-center gap-2">
          <ClockIcon className="size-4 text-account-muted-faint" />
          生成于{" "}
          <span className="font-mono font-semibold text-account-ink-soft">
            {formatDateTime(graph.graph?.meta.generatedAt)}
          </span>
        </span>
      </div>
    </div>
  );
}
