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
    "inline-flex cursor-pointer select-none items-center justify-center gap-2 whitespace-nowrap border text-base font-medium tracking-body transition-all duration-200 ease-expo",
    "focus-visible:outline-none focus-visible:shadow-focus-accent",
    "disabled:pointer-events-none disabled:opacity-50",
    "active:translate-y-px",
    size === "default" && "h-9 rounded-card px-4",
    size === "sm" && "h-8 rounded-lg px-3 text-sm",
    size === "icon" && "size-9 rounded-card",
    variant === "primary" &&
      "border-ink bg-ink text-white shadow-btn hover:bg-accent-strong hover:border-accent-strong",
    variant === "outline" &&
      "border-line-strong bg-white/80 text-ink shadow-btn-soft hover:bg-hover-bg hover:text-accent-strong",
    variant === "ghost" &&
      "border-transparent bg-transparent text-muted-strong hover:bg-ghost-hover hover:text-ink",
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
