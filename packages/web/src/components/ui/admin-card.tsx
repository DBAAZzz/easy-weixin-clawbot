import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Badge } from "./badge.js";
import { cn } from "../../lib/cn.js";
import { MoreHorizontalIcon } from "./icons.js";

type CardActionTone = "neutral" | "primary" | "success" | "warning" | "danger";

export function CardActionButton(props: {
  label: string;
  onClick: () => void;
  icon: ReactNode;
  tone?: CardActionTone;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onClick();
      }}
      className={cn(
        "pointer-events-auto inline-flex size-7 items-center justify-center rounded-full border border-transparent bg-transparent text-icon-muted transition duration-200 ease-expo disabled:cursor-not-allowed disabled:opacity-45",
        "md:group-hover:border-slate-border-strong md:group-hover:bg-white/92 md:group-hover:shadow-popover-strong",
        props.tone === "primary" &&
          "md:group-hover:text-sky-600 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-600",
        props.tone === "success" &&
          "md:group-hover:text-emerald-600 hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-600",
        props.tone === "warning" &&
          "md:group-hover:text-amber-600 hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600",
        props.tone === "danger" &&
          "md:group-hover:text-red-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600",
        props.tone !== "primary" &&
          props.tone !== "success" &&
          props.tone !== "warning" &&
          props.tone !== "danger" &&
          "hover:border-slate-border-strong hover:bg-white/92 hover:text-muted-strong",
        props.className,
      )}
    >
      {props.icon}
    </button>
  );
}

export function CardActionGroup(props: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none absolute right-4 top-4 flex items-center gap-1 opacity-100 transition duration-200 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100",
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

export function CardOverflowMenu(props: {
  items: Array<{
    label: string;
    onClick: () => void;
    icon?: ReactNode;
    tone?: CardActionTone;
    disabled?: boolean;
  }>;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) {
        return;
      }
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={cn("relative", props.className)}>
      <button
        type="button"
        aria-label="更多操作"
        title="更多操作"
        aria-expanded={open}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
        className={cn(
          "inline-flex size-7 items-center justify-center rounded-full border border-line bg-white text-icon-muted shadow-overflow-btn transition duration-200 ease-expo",
          "hover:border-slate-border-26 hover:bg-pane-98 hover:text-muted-strong",
          open && "border-slate-border-26 bg-pane-98 text-muted-strong",
        )}
      >
        <MoreHorizontalIcon className="size-4" />
      </button>

      {open ? (
        <div className="absolute right-0 top-9 z-20 min-w-[168px] overflow-hidden rounded-lg border border-line bg-white/98 p-1.5 shadow-menu backdrop-blur">
          {props.items.map((item) => (
            <button
              key={item.label}
              type="button"
              disabled={item.disabled}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                item.onClick();
              }}
              className={cn(
                "flex w-full items-center gap-2 rounded-card px-3 py-2 text-left text-base text-muted-strong transition disabled:cursor-not-allowed disabled:opacity-45",
                "hover:bg-ghost-hover hover:text-ink",
              )}
            >
              {item.icon ? (
                <span className="inline-flex size-4 items-center justify-center opacity-70">
                  {item.icon}
                </span>
              ) : null}
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CardToggle(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    enabled: boolean;
    busy?: boolean;
    label: string;
    onToggle: () => void;
  },
) {
  const { enabled, busy, label, onToggle, className, ...rest } = props;
  return (
    <button
      type="button"
      disabled={busy || rest.disabled}
      aria-label={label}
      aria-pressed={enabled}
      title={enabled ? "已启用" : "已停用"}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      className={cn(
        "relative inline-flex h-7 w-[46px] shrink-0 items-center rounded-full border p-1 transition duration-200 ease-expo disabled:cursor-not-allowed disabled:opacity-60",
        enabled ? "border-toggle-border bg-accent" : "border-line-strong bg-toggle-off",
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          "size-5 rounded-full bg-white shadow-float transition duration-200 ease-expo",
          enabled ? "translate-x-[18px]" : "translate-x-0",
        )}
      />
    </button>
  );
}

export function IconTag(props: {
  icon: ReactNode;
  children: ReactNode;
  tone?: "online" | "offline" | "muted" | "error" | "warning";
  className?: string;
}) {
  return (
    <Badge
      tone={props.tone ?? "muted"}
      className={cn("gap-1.5 px-2.5 py-1.5 tracking-tag", props.className)}
    >
      <span className="inline-flex size-3 items-center justify-center opacity-75">
        {props.icon}
      </span>
      <span>{props.children}</span>
    </Badge>
  );
}

export interface MetricGridItem {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}

export function MetricGrid(props: {
  items: MetricGridItem[];
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  const columns = props.columns ?? 2;

  return (
    <div
      className={cn(
        "mt-3 grid gap-px overflow-hidden rounded-lg border border-line/80 bg-line/80",
        columns === 2 && "grid-cols-2",
        columns === 3 && "grid-cols-3",
        columns === 4 && "grid-cols-4",
        props.className,
      )}
    >
      {props.items.map((item) => (
        <div key={`${item.label}-${String(item.value)}`} className="bg-pane-82 px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <span className="inline-flex size-3.5 items-center justify-center">{item.icon}</span>
            <span>{item.label}</span>
          </div>
          <p className="mt-1 text-md font-medium text-muted-strong">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
