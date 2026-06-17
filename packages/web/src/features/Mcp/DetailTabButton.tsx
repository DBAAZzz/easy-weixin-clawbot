import type { ServerDetailTab } from "./types.js";
import { cn } from "../../lib/cn.js";

export function DetailTabButton(props: {
  tab: ServerDetailTab;
  activeTab: ServerDetailTab;
  label: string;
  onSelect: (tab: ServerDetailTab) => void;
}) {
  const selected = props.activeTab === props.tab;

  return (
    <button
      id={`mcp-server-tab-${props.tab}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`mcp-server-panel-${props.tab}`}
      onClick={() => props.onSelect(props.tab)}
      className={cn(
        "inline-flex items-center border-b-2 px-0 pb-3 pt-1 text-base font-medium tracking-body transition duration-200 ease-expo",
        selected ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
      )}
    >
      <span>{props.label}</span>
    </button>
  );
}
