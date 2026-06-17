import { Menu } from "@base-ui/react/menu";
import { type ReactNode } from "react";
import { Badge } from "../Badge/index.js";
import { MoreHorizontalIcon } from "../Icons/index.js";
import { Switch } from "../Switch/index.js";
import { cn } from "../utils/cn.js";
import {
  cardActionButtonClassName,
  cardActionGroupClassName,
  cardActionToneClassName,
  cardIconContainerClassName,
  cardMenuItemClassName,
  type CardActionTone,
} from "./style.js";

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
        cardActionButtonClassName,
        cardActionToneClassName[props.tone ?? "neutral"],
        props.className,
      )}
    >
      {props.icon}
    </button>
  );
}

export function CardActionGroup(props: { children: ReactNode; className?: string }) {
  return <div className={cn(cardActionGroupClassName, props.className)}>{props.children}</div>;
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
  return (
    <Menu.Root modal={false}>
      <Menu.Trigger
        type="button"
        aria-label="更多操作"
        title="更多操作"
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        className={cn(cardActionButtonClassName, "cb-card-overflow-trigger", props.className)}
      >
        <MoreHorizontalIcon />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={8} className="cb-z-50">
          <Menu.Popup className="cb-card-menu-popup">
            {props.items.map((item) => (
              <Menu.Item
                key={item.label}
                disabled={item.disabled}
                label={item.label}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  item.onClick();
                }}
                className={cn(cardMenuItemClassName)}
              >
                {item.icon ? <span className={cardIconContainerClassName}>{item.icon}</span> : null}
                <span>{item.label}</span>
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

export function CardToggle(props: {
  enabled: boolean;
  busy?: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
  disabled?: boolean;
}) {
  const { enabled, busy, label, onToggle, className, disabled } = props;
  return (
    <Switch
      disabled={busy || disabled}
      label={label}
      checked={enabled}
      title={enabled ? "已启用" : "已停用"}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onCheckedChange={() => {
        onToggle();
      }}
      className={className}
    />
  );
}

export function IconTag(props: {
  icon: ReactNode;
  children: ReactNode;
  tone?: "online" | "offline" | "muted" | "error" | "warning";
  className?: string;
}) {
  return (
    <Badge tone={props.tone ?? "muted"} className={cn("cb-icon-tag", props.className)}>
      <span className={cardIconContainerClassName}>{props.icon}</span>
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
        "cb-metric-grid",
        columns === 2 && "cb-metric-grid--2",
        columns === 3 && "cb-metric-grid--3",
        columns === 4 && "cb-metric-grid--4",
        props.className,
      )}
    >
      {props.items.map((item) => (
        <div key={`${item.label}-${String(item.value)}`} className="cb-metric-cell">
          <div className="cb-metric-label">
            <span className={cardIconContainerClassName}>{item.icon}</span>
            <span>{item.label}</span>
          </div>
          <p className="cb-metric-value">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
