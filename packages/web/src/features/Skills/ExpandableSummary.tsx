import { useState } from "react";
import { cn } from "../../lib/cn.js";

export function ExpandableSummary(props: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = props.text.trim();
  const canExpand = summary.length > 60;

  if (!summary) {
    return null;
  }

  return (
    <div className="mt-2">
      <p
        className={cn(
          "text-sm leading-5 text-muted-strong",
          canExpand && !expanded && "line-clamp-2",
        )}
      >
        {summary}
      </p>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1.5 text-xs font-medium text-accent-strong transition hover:text-accent"
        >
          {expanded ? "收起" : "...更多"}
        </button>
      ) : null}
    </div>
  );
}
