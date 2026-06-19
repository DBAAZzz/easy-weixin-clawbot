import { useState } from "react";
import { cn } from "../../lib/cn.js";

export function ExpandableDescription(props: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const description = props.text.trim();
  const canExpand = description.length > 60;

  if (!description) {
    return null;
  }

  return (
    <div className="mt-4 max-w-3xl">
      <p
        className={cn(
          "text-lg leading-7 text-muted-strong",
          canExpand && !expanded && "line-clamp-2",
        )}
      >
        {description}
      </p>
      {canExpand ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-2 text-sm font-medium text-accent-strong transition hover:text-accent"
        >
          {expanded ? "收起" : "...更多"}
        </button>
      ) : null}
    </div>
  );
}
