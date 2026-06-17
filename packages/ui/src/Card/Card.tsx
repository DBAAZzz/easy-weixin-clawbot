import type { HTMLAttributes } from "react";
import { cn } from "../utils/cn.js";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cb-card", className)} {...props} />;
}
