import { useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import { ChevronDownIcon } from "./icons.js";

export function Accordion(props: {
  title: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
}) {
  const [open, setOpen] = useState(props.defaultOpen ?? false);
  const contentId = useId();

  return (
    <div
      className={cn(
        "overflow-hidden rounded-panel border border-line bg-white/72",
        props.className,
      )}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2.5 text-left transition duration-200 ease-expo hover:bg-card-hover focus-visible:outline-none focus-visible:shadow-focus-accent"
      >
        <span className="min-w-0 flex-1">{props.title}</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
          {props.meta}
          <ChevronDownIcon
            className={cn("size-4 transition duration-200 ease-expo", open && "rotate-180")}
          />
        </span>
      </button>

      {open ? (
        <div id={contentId} className={cn("border-t border-line", props.contentClassName)}>
          {props.children}
        </div>
      ) : null}
    </div>
  );
}
