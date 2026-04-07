export const DEFAULT_GRAPH_VIEWPORT = {
  durationMs: 350,
  padding: 56,
} as const;

export const SINGLE_NODE_VIEWPORT = {
  durationMs: 350,
  zoom: 1.6,
} as const;

export type GraphViewportAction =
  | { type: "none" }
  | {
      type: "fit";
      durationMs: number;
      padding: number;
    }
  | {
      type: "single";
      durationMs: number;
      zoom: number;
    };

export function getInitialViewportAction(nodeCount: number): GraphViewportAction {
  if (nodeCount <= 0) {
    return { type: "none" };
  }

  if (nodeCount === 1) {
    return {
      type: "single",
      durationMs: SINGLE_NODE_VIEWPORT.durationMs,
      zoom: SINGLE_NODE_VIEWPORT.zoom,
    };
  }

  return {
    type: "fit",
    durationMs: DEFAULT_GRAPH_VIEWPORT.durationMs,
    padding: DEFAULT_GRAPH_VIEWPORT.padding,
  };
}
