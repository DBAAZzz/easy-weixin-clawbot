import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-10 w-full rounded-lg border border-line-strong bg-panel-strong px-3.5 text-base text-ink outline-none transition duration-300 ease-expo placeholder:text-muted focus:border-accent focus:shadow-focus-accent",
        className,
      )}
      {...props}
    />
  );
}
