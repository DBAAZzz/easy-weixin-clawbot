import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "outline";
  size?: "default" | "sm";
};

export function buttonClassName(options?: {
  className?: string;
  variant?: ButtonProps["variant"];
  size?: ButtonProps["size"];
}) {
  const variant = options?.variant ?? "primary";
  const size = options?.size ?? "default";

  return cn(
    "inline-flex items-center justify-center gap-2 border text-[12px] font-medium tracking-[-0.01em] transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
    size === "default" && "h-10 rounded-[14px] px-3.5",
    size === "sm" && "h-8 rounded-[12px] px-3 text-[11px]",
    variant === "primary" &&
      "border-[var(--ink)] bg-[var(--ink)] text-white shadow-[0_18px_36px_-24px_rgba(15,23,42,0.46)] hover:-translate-y-0.5 hover:border-[var(--accent-strong)] hover:bg-[var(--accent-strong)]",
    variant === "outline" &&
      "border-[var(--line-strong)] bg-[rgba(255,255,255,0.78)] text-[var(--ink)] hover:-translate-y-0.5 hover:border-[var(--accent)] hover:text-[var(--accent-strong)]",
    variant === "ghost" &&
      "border-transparent bg-transparent text-[var(--muted-strong)] hover:bg-white/60 hover:text-[var(--ink)]",
    options?.className
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
    <button
      type={type}
      className={buttonClassName({ className, variant, size })}
      {...props}
    />
  );
}
