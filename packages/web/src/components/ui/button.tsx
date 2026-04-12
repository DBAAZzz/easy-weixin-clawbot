import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline" | "destructive";
  size?: "default" | "sm" | "icon";
};

export function buttonClassName(options?: {
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const variant = options?.variant ?? "primary";
  const size = options?.size ?? "default";

  return cn(
    "inline-flex cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap border text-[12px] font-medium tracking-[-0.01em] transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
    "focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[rgba(21,110,99,0.14)]",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:translate-y-px",
    size === "default" && "h-9 rounded-[10px] px-4",
    size === "sm" && "h-8 rounded-[8px] px-3 text-[11px]",
    size === "icon" && "size-9 rounded-[10px]",
    variant === "primary" &&
      "border-[var(--ink)] bg-[var(--ink)] text-white shadow-[0_1px_3px_rgba(15,23,42,0.2)] hover:bg-[var(--accent-strong)] hover:border-[var(--accent-strong)]",
    variant === "outline" &&
      "border-[var(--line-strong)] bg-white/80 text-[var(--ink)] shadow-[0_1px_2px_rgba(15,23,42,0.05)] hover:bg-[rgba(246,249,250,0.9)] hover:text-[var(--accent-strong)]",
    variant === "ghost" &&
      "border-transparent bg-transparent text-[var(--muted-strong)] hover:bg-[rgba(21,32,43,0.04)] hover:text-[var(--ink)]",
    variant === "destructive" &&
      "border-red-200 bg-red-50 text-red-700 hover:bg-red-100 hover:border-red-300",
    options?.className,
  );
}

export function Button({
  className,
  variant = "primary",
  size = "default",
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={buttonClassName({ className, variant, size })} {...props} />
  );
}
