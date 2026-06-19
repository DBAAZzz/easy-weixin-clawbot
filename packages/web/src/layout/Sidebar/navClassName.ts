import { cn } from "@/lib/cn.js";

export function navClassName(isActive: boolean, collapsed: boolean) {
  return cn(
    "group flex items-center rounded-lg text-md transition duration-200 ease-expo",
    collapsed ? "size-10 justify-center px-0 py-0" : "gap-3 px-3 py-2.5",
    isActive
      ? "bg-accent-active font-semibold text-ink shadow-accent-xs"
      : "text-muted-strong hover:bg-white/72 hover:text-ink",
  );
}
