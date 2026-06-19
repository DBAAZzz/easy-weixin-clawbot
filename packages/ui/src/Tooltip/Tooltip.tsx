import { isValidElement, type ReactNode } from "react";
import { Tooltip as BaseTooltip } from "@base-ui/react/tooltip";
import { cn } from "../utils/cn.js";

export type TooltipPlacement = "top" | "bottom" | "left" | "right";

export type TooltipProps = {
  children: ReactNode;
  className?: string;
  delay?: number;
  placement?: TooltipPlacement;
  title: ReactNode;
};

export function Tooltip({
  children,
  className,
  delay = 200,
  placement = "top",
  title,
}: TooltipProps) {
  const asTrigger = isValidElement(children);

  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger
        className={cn(!asTrigger && "cb-tooltip-trigger")}
        delay={delay}
        {...(asTrigger ? { render: children } : { children })}
      />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner side={placement} sideOffset={4}>
          <BaseTooltip.Popup className={cn("cb-tooltip-popup", className)}>
            {title}
          </BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
