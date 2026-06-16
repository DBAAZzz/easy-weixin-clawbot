import type { ComponentProps } from "react";
import { ScrollArea as BaseScrollArea } from "@base-ui/react/scroll-area";
import { cn } from "../utils/cn.js";

export function ScrollArea({ className, children, ...props }: ComponentProps<"div">) {
  return (
    <BaseScrollArea.Root className={cn("cb-scroll-area", className)} {...props}>
      <BaseScrollArea.Viewport className="cb-scroll-area-viewport">
        <BaseScrollArea.Content>{children}</BaseScrollArea.Content>
      </BaseScrollArea.Viewport>
    </BaseScrollArea.Root>
  );
}
