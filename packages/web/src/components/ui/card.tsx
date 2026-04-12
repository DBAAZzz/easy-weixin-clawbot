import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-lg border border-[var(--line)] bg-[var(--panel)] p-5 shadow-[0_20px_40px_-34px_rgba(15,23,42,0.16)] backdrop-blur-xl",
        className,
      )}
      {...props}
    />
  );
}
