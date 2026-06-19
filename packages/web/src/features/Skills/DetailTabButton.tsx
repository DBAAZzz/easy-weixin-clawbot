import { cn } from "../../lib/cn.js";
import type { SkillDetailTab } from "./types.js";

export function DetailTabButton(props: {
  tab: SkillDetailTab;
  activeTab: SkillDetailTab;
  label: string;
  onSelect: (tab: SkillDetailTab) => void;
}) {
  const selected = props.activeTab === props.tab;

  return (
    <button
      id={`skill-tab-${props.tab}`}
      type="button"
      role="tab"
      aria-selected={selected}
      aria-controls={`skill-panel-${props.tab}`}
      onClick={() => props.onSelect(props.tab)}
      className={cn(
        "inline-flex items-center border-b-2 px-0 pb-2.5 pt-1 text-sm font-medium tracking-body transition duration-200 ease-expo",
        selected ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
      )}
    >
      <span>{props.label}</span>
    </button>
  );
}
