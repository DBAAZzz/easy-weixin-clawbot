import { Badge } from "../ui/badge.js";
import { cn } from "../../lib/cn.js";

export function TraceFlagList({ flags }: { flags: string[] }) {
  if (flags.length === 0) {
    return <Badge>none</Badge>;
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((flag) => (
        <span
          key={flag}
          className={cn(
            "inline-flex rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.1em]",
            flag === "error" && "border-red-200 bg-red-50 text-red-700",
            flag === "slow" && "border-amber-200 bg-amber-50 text-amber-700",
            flag === "expensive" && "border-violet-200 bg-violet-50 text-violet-700",
            flag === "max_rounds" && "border-sky-200 bg-sky-50 text-sky-700",
          )}
        >
          {flag}
        </span>
      ))}
    </div>
  );
}
