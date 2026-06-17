import { Card } from "@clawbot/ui";
import { cn } from "../../lib/cn.js";
import type { AccountStat } from "./types.js";

export function StatsGrid({ stats }: { stats: AccountStat[] }) {
  return (
    <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <Card
          key={stat.label}
          className="rounded-section border-account-line bg-account-card shadow-account-control backdrop-blur-none"
        >
          <div className="mb-3.5 flex items-center gap-2">
            <span className={cn("size-1.5 rounded-full", stat.dotClassName)} />
            <span className="text-sm font-medium text-account-muted">{stat.label}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span
              className={cn(
                "font-sans text-stat font-bold leading-none tracking-title",
                stat.valueClassName,
              )}
            >
              {stat.value}
            </span>
            <span className="whitespace-nowrap text-sm text-account-muted-faint">{stat.meta}</span>
          </div>
        </Card>
      ))}
    </section>
  );
}
