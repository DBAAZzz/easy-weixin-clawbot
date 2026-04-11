import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from "react-force-graph-2d";
import type { TapeGraphEdge, TapeGraphNode } from "@clawbot/shared";
import { MemoryLegend } from "./MemoryLegend.js";
import { getInitialViewportAction } from "./viewport.js";

const CATEGORY_COLORS: Record<TapeGraphNode["category"], string> = {
  fact: "#3B82F6",
  preference: "#10B981",
  decision: "#F59E0B",
};

interface GraphLink extends Omit<TapeGraphEdge, "source" | "target"> {
  source: string | NodeObject<TapeGraphNode>;
  target: string | NodeObject<TapeGraphNode>;
}

function getNodeSize(node: TapeGraphNode) {
  const confidence = node.confidence ?? 0.5;
  const base = node.category === "decision" ? 7 : 6;
  return base + confidence * 7;
}

function resolveNodeId(node: string | number | NodeObject<TapeGraphNode> | undefined) {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (node && typeof node === "object" && "id" in node) {
    return String(node.id);
  }

  return "";
}

function toCanvasColor(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function drawDotGrid(ctx: CanvasRenderingContext2D, width: number, height: number, globalScale: number) {
  const spacing = 32;
  const dotRadius = 0.6 / globalScale;
  const transform = ctx.getTransform();
  const offsetX = transform.e / transform.a;
  const offsetY = transform.f / transform.d;
  const visibleLeft = -offsetX;
  const visibleTop = -offsetY;
  const visibleRight = visibleLeft + width / transform.a;
  const visibleBottom = visibleTop + height / transform.d;

  const startX = Math.floor(visibleLeft / spacing) * spacing;
  const startY = Math.floor(visibleTop / spacing) * spacing;

  ctx.fillStyle = "rgba(148, 163, 184, 0.14)";
  for (let x = startX; x < visibleRight; x += spacing) {
    for (let y = startY; y < visibleBottom; y += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Draw a small book/document icon (two horizontal lines) inside the node */
function drawFactIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const s = r * 0.38;
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.lineWidth = Math.max(1, s * 0.28);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - s, y - s * 0.35);
  ctx.lineTo(x + s, y - s * 0.35);
  ctx.moveTo(x - s, y + s * 0.35);
  ctx.lineTo(x + s * 0.5, y + s * 0.35);
  ctx.stroke();
}

/** Draw a small heart shape inside the node */
function drawPreferenceIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const s = r * 0.32;
  ctx.save();
  ctx.translate(x, y + s * 0.15);
  ctx.beginPath();
  ctx.moveTo(0, s * 0.9);
  ctx.bezierCurveTo(-s * 0.1, s * 0.7, -s * 1.2, s * 0.1, -s * 1.2, -s * 0.3);
  ctx.bezierCurveTo(-s * 1.2, -s * 0.9, -s * 0.6, -s * 1.1, 0, -s * 0.5);
  ctx.bezierCurveTo(s * 0.6, -s * 1.1, s * 1.2, -s * 0.9, s * 1.2, -s * 0.3);
  ctx.bezierCurveTo(s * 1.2, s * 0.1, s * 0.1, s * 0.7, 0, s * 0.9);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
  ctx.restore();
}

/** Draw a small diamond/rhombus inside the node */
function drawDecisionIcon(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const s = r * 0.36;
  ctx.beginPath();
  ctx.moveTo(x, y - s);
  ctx.lineTo(x + s * 0.75, y);
  ctx.lineTo(x, y + s);
  ctx.lineTo(x - s * 0.75, y);
  ctx.closePath();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.fill();
}

const ICON_DRAWERS: Record<TapeGraphNode["category"], (ctx: CanvasRenderingContext2D, x: number, y: number, r: number) => void> = {
  fact: drawFactIcon,
  preference: drawPreferenceIcon,
  decision: drawDecisionIcon,
};

function drawNode(
  ctx: CanvasRenderingContext2D,
  node: TapeGraphNode,
  x: number,
  y: number,
  size: number,
  isHighlighted: boolean,
  globalScale: number,
) {
  const color = CATEGORY_COLORS[node.category];
  const alpha = isHighlighted ? 0.92 : 0.28;

  // Outer glow for highlighted nodes
  if (isHighlighted) {
    ctx.beginPath();
    ctx.arc(x, y, size + 3, 0, Math.PI * 2);
    ctx.fillStyle = toCanvasColor(color, 0.12);
    ctx.fill();
  }

  // Main circle
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fillStyle = toCanvasColor(color, alpha);
  ctx.fill();

  // Category icon inside (only when zoomed enough to see it)
  if (globalScale > 0.5 && size > 5) {
    ICON_DRAWERS[node.category](ctx, x, y, size);
  }
}

export function MemoryGraph(props: {
  nodes: TapeGraphNode[];
  edges: TapeGraphEdge[];
  selectedNodeId: string | null;
  highlightedNodeIds?: Set<string>;
  onNodeHover(node: TapeGraphNode | null): void;
  onNodeSelect(node: TapeGraphNode | null): void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<ForceGraphMethods<TapeGraphNode, GraphLink> | undefined>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const hasInitialFitRef = useRef(false);
  const prevDataKeyRef = useRef("");

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const nextEntry = entries[0];
      if (!nextEntry) return;

      setSize({
        width: nextEntry.contentRect.width,
        height: Math.max(460, nextEntry.contentRect.height),
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Initial viewport fit — only on data change, not on container resize
  useEffect(() => {
    if (!graphRef.current || props.nodes.length === 0 || size.width === 0) return;

    const dataKey = `${props.nodes.length}:${props.edges.length}`;
    if (hasInitialFitRef.current && dataKey === prevDataKeyRef.current) return;

    prevDataKeyRef.current = dataKey;
    hasInitialFitRef.current = true;

    const timeoutId = window.setTimeout(() => {
      const graph = graphRef.current;
      if (!graph) return;

      const action = getInitialViewportAction(props.nodes.length);
      if (action.type === "none") return;

      if (action.type === "fit") {
        graph.zoomToFit(action.durationMs, action.padding);
        return;
      }

      const bbox = graph.getGraphBbox();
      if (bbox) {
        graph.centerAt(
          (bbox.x[0] + bbox.x[1]) / 2,
          (bbox.y[0] + bbox.y[1]) / 2,
          action.durationMs,
        );
      }
      graph.zoom(action.zoom, action.durationMs);
    }, 180);

    return () => window.clearTimeout(timeoutId);
  }, [props.nodes, props.edges, size.width, size.height]);

  // Auto-zoom to search-highlighted nodes
  useEffect(() => {
    if (!graphRef.current || !props.highlightedNodeIds || props.highlightedNodeIds.size === 0) return;

    const matchedNodes = props.nodes.filter((n) => props.highlightedNodeIds!.has(n.id));
    if (matchedNodes.length === 0) return;

    const timeoutId = window.setTimeout(() => {
      const graph = graphRef.current;
      if (!graph) return;

      if (matchedNodes.length === 1) {
        const node = matchedNodes[0] as NodeObject<TapeGraphNode>;
        graph.centerAt(node.x ?? 0, node.y ?? 0, 400);
        graph.zoom(2.5, 400);
      } else {
        graph.zoomToFit(400, 60, (node) => props.highlightedNodeIds!.has(node.id));
      }
    }, 100);

    return () => window.clearTimeout(timeoutId);
  }, [props.highlightedNodeIds, props.nodes]);

  const selectedNodeId = props.selectedNodeId;
  const highlightedNodeIds = new Set<string>();
  const highlightedEdgeKeys = new Set<string>();

  if (selectedNodeId) {
    highlightedNodeIds.add(selectedNodeId);

    for (const edge of props.edges) {
      if (edge.source === selectedNodeId || edge.target === selectedNodeId) {
        highlightedNodeIds.add(edge.source);
        highlightedNodeIds.add(edge.target);
        highlightedEdgeKeys.add(`${edge.type}:${edge.source}:${edge.target}`);
      }
    }
  }

  const graphData = useMemo(
    () => ({
      nodes: props.nodes,
      links: props.edges.map((edge) => ({ ...edge })),
    }),
    [props.nodes, props.edges],
  );

  const searchHighlight = props.highlightedNodeIds;

  return (
    <div
      ref={containerRef}
      className="memory-graph-container relative h-[680px] min-h-[460px] overflow-hidden rounded-xl border border-[rgba(148,163,184,0.18)] shadow-[0_32px_72px_-52px_rgba(15,23,42,0.36)]"
    >
      {size.width > 0 && props.nodes.length > 0 ? (
        <ForceGraph2D<TapeGraphNode, GraphLink>
          ref={graphRef}
          width={size.width}
          height={size.height}
          graphData={graphData}
          backgroundColor="rgba(0,0,0,0)"
          maxZoom={6}
          nodeLabel={() => ""}
          linkColor={(link) => {
            const source = resolveNodeId(link.source);
            const target = resolveNodeId(link.target);
            const isHighlighted =
              highlightedEdgeKeys.size === 0 ||
              highlightedEdgeKeys.has(`${link.type}:${source}:${target}`) ||
              highlightedEdgeKeys.has(`${link.type}:${target}:${source}`);

            if (link.type === "prefix_cluster") {
              return isHighlighted ? "rgba(107,114,128,0.38)" : "rgba(148,163,184,0.12)";
            }

            return isHighlighted
              ? `rgba(79,70,229,${Math.min(0.9, 0.22 + link.weight * 0.16)})`
              : "rgba(99,102,241,0.08)";
          }}
          linkWidth={(link) => {
            const source = resolveNodeId(link.source);
            const target = resolveNodeId(link.target);
            const isHighlighted =
              highlightedEdgeKeys.size === 0 ||
              highlightedEdgeKeys.has(`${link.type}:${source}:${target}`) ||
              highlightedEdgeKeys.has(`${link.type}:${target}:${source}`);
            const baseWidth = Math.min(1.25 + link.weight * 0.45, 4.2);
            return isHighlighted ? baseWidth : Math.max(0.65, baseWidth * 0.55);
          }}
          linkLineDash={(link) => (link.type === "prefix_cluster" ? [5, 4] : null)}
          linkDirectionalParticles={(link) => {
            const source = resolveNodeId(link.source);
            const target = resolveNodeId(link.target);
            const isHighlighted =
              highlightedEdgeKeys.has(`${link.type}:${source}:${target}`) ||
              highlightedEdgeKeys.has(`${link.type}:${target}:${source}`);
            return isHighlighted ? 3 : 0;
          }}
          linkDirectionalParticleWidth={2.5}
          linkDirectionalParticleSpeed={0.006}
          linkDirectionalParticleColor={(link) => {
            if (link.type === "prefix_cluster") return "rgba(107,114,128,0.5)";
            return "rgba(79,70,229,0.6)";
          }}
          onRenderFramePre={(ctx, globalScale) => {
            drawDotGrid(ctx, size.width, size.height, globalScale);
          }}
          nodeCanvasObjectMode={() => "replace"}
          nodeCanvasObject={(node, ctx, globalScale) => {
            const nodeSize = getNodeSize(node);
            const fontSize = Math.max(10, 12 / globalScale);
            const isSelected = selectedNodeId === node.id;
            const isNeighborHighlighted =
              highlightedNodeIds.size === 0 || highlightedNodeIds.has(node.id);
            const isSearchMatch = searchHighlight?.has(node.id) ?? false;
            const isHighlighted = isNeighborHighlighted || isSearchMatch;
            const x = node.x ?? 0;
            const y = node.y ?? 0;

            // Search match pulse glow
            if (isSearchMatch) {
              ctx.beginPath();
              ctx.arc(x, y, nodeSize + 6, 0, Math.PI * 2);
              ctx.fillStyle = toCanvasColor(CATEGORY_COLORS[node.category], 0.15);
              ctx.fill();
            }

            // Draw the node with category shape
            drawNode(ctx, node, x, y, isSelected ? nodeSize + 2 : nodeSize, isHighlighted, globalScale);

            // Selection ring
            if (isSelected) {
              ctx.beginPath();
              ctx.arc(x, y, nodeSize + 4, 0, Math.PI * 2);
              ctx.lineWidth = 1.5;
              ctx.strokeStyle = "rgba(15,23,42,0.45)";
              ctx.setLineDash([3, 2]);
              ctx.stroke();
              ctx.setLineDash([]);
            }

            // Label
            if (globalScale > 0.35) {
              ctx.font = `500 ${fontSize}px ui-sans-serif, system-ui, sans-serif`;
              ctx.textAlign = "center";
              ctx.textBaseline = "top";
              const label = node.label.length > 12 ? `${node.label.slice(0, 12)}…` : node.label;
              const textWidth = ctx.measureText(label).width;
              const bgWidth = textWidth + 10;
              const bgHeight = fontSize + 6;
              const labelY = y + nodeSize + 6;

              // Label background pill
              const bgX = x - bgWidth / 2;
              ctx.fillStyle = isHighlighted ? "rgba(255,255,255,0.92)" : "rgba(255,255,255,0.48)";
              ctx.beginPath();
              const radius = bgHeight / 2;
              ctx.moveTo(bgX + radius, labelY);
              ctx.lineTo(bgX + bgWidth - radius, labelY);
              ctx.arcTo(bgX + bgWidth, labelY, bgX + bgWidth, labelY + radius, radius);
              ctx.arcTo(bgX + bgWidth, labelY + bgHeight, bgX + bgWidth - radius, labelY + bgHeight, radius);
              ctx.lineTo(bgX + radius, labelY + bgHeight);
              ctx.arcTo(bgX, labelY + bgHeight, bgX, labelY + bgHeight - radius, radius);
              ctx.arcTo(bgX, labelY, bgX + radius, labelY, radius);
              ctx.closePath();
              ctx.fill();

              // Confidence micro-bar under label
              if (typeof node.confidence === "number" && globalScale > 0.7) {
                const barWidth = bgWidth - 6;
                const barX = x - barWidth / 2;
                const barY = labelY + bgHeight + 2;
                const barHeight = 2;
                ctx.fillStyle = "rgba(148,163,184,0.15)";
                ctx.fillRect(barX, barY, barWidth, barHeight);
                const color = CATEGORY_COLORS[node.category];
                ctx.fillStyle = toCanvasColor(color, isHighlighted ? 0.7 : 0.3);
                ctx.fillRect(barX, barY, barWidth * node.confidence, barHeight);
              }

              ctx.fillStyle = isHighlighted ? "rgba(15,23,42,0.88)" : "rgba(100,116,139,0.7)";
              ctx.fillText(label, x, labelY + 3);
            }
          }}
          nodePointerAreaPaint={(node, color, ctx) => {
            const nodeSize = getNodeSize(node) + 6;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, nodeSize, 0, 2 * Math.PI, false);
            ctx.fill();
          }}
          cooldownTicks={120}
          warmupTicks={60}
          d3VelocityDecay={0.22}
          autoPauseRedraw={false}
          onNodeHover={(node) => props.onNodeHover(node)}
          onNodeClick={(node) => props.onNodeSelect(node)}
          onBackgroundClick={() => props.onNodeSelect(null)}
        />
      ) : null}

      {props.nodes.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-[12px] leading-6 text-[var(--muted)]">
          当前筛选条件下没有可展示的记忆节点。
        </div>
      ) : null}

      {props.nodes.length > 0 ? <MemoryLegend variant="floating" /> : null}
    </div>
  );
}
