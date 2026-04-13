import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-line bg-panel p-5 shadow-card backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}
