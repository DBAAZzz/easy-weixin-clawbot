import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-[14px] border border-[var(--line-strong)] bg-[rgba(255,255,255,0.82)] px-3.5 text-[12px] text-[var(--ink)] outline-none transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:ring-[3px] focus:ring-[rgba(21,110,99,0.14)]",
        className
      )}
      {...props}
    />
  );
}
