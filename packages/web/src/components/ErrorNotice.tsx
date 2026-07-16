import type { ReactNode } from "react";
import { cn } from "../lib/cn.js";

type ErrorNoticeProps = {
  children: ReactNode;
  className?: string;
  size?: "sm" | "md";
};

export function ErrorNotice({ children, className, size = "md" }: ErrorNoticeProps) {
  return (
    <div
      className={cn(
        "rounded-card border border-notice-error-border bg-notice-error-bg px-4 py-3 leading-5 text-danger",
        size === "sm" ? "text-sm" : "text-base",
        className,
      )}
    >
      {children}
    </div>
  );
}
