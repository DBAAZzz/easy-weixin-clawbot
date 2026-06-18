import { useMemo } from "react";
import type { TapeGraphGroup, TapeGraphNode } from "@clawbot/shared";
import { Card } from "@clawbot/ui";
import { cn } from "@/lib/cn.js";

const PALETTE_CLASSES = [
  "bg-account-muted",
  "bg-account-success-dot",
  "bg-danger",
  "bg-account-warning-dot",
  "bg-danger-strong",
  "bg-account-success-fg",
];

interface PrefixGroupsProps {
  groups: TapeGraphGroup[];
  nodes: TapeGraphNode[];
  visibleNodeIds: Set<string>;
}

export function PrefixGroups({ groups, nodes, visibleNodeIds }: PrefixGroupsProps) {
  const groupCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of nodes) {
      if (!visibleNodeIds.has(node.id)) continue;
      const groupId = extractGroupId(node.key);
      if (groupId) {
        counts[groupId] = (counts[groupId] ?? 0) + 1;
      }
    }
    return counts;
  }, [nodes, visibleNodeIds]);

  const maxCount = Math.max(1, ...Object.values(groupCounts));

  return (
    <Card className="flex flex-1 flex-col rounded-section border-account-line bg-account-card shadow-account-card backdrop-blur-none">
      <div className="mb-3.5 flex items-center justify-between">
        <span className="text-md font-semibold text-account-ink">前缀聚类组</span>
        <span className="font-mono text-base text-account-muted-faint">{groups.length} 组</span>
      </div>

      {groups.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-card border border-dashed border-account-line bg-account-table-head px-4 py-8 text-center text-base leading-6 text-account-muted-faint">
          当前分支还没有可聚类的层级 key
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-1.5">
          {groups.slice(0, 8).map((group, index) => {
            const count = groupCounts[group.id] ?? 0;
            const pct = Math.round((count / maxCount) * 100);
            const colorClass = PALETTE_CLASSES[index % PALETTE_CLASSES.length];

            return (
              <div
                key={group.id}
                className="rounded-card border border-account-line bg-account-table-head px-3 py-2.5 transition-colors duration-200 ease-expo hover:border-account-control-hover"
              >
                <div className="mb-2 flex items-center gap-2">
                  <span className={cn("size-2 shrink-0 rounded-xs", colorClass)} />
                  <span className="truncate text-md font-semibold text-account-ink-soft">
                    {group.label}
                  </span>
                  <span className="ml-auto shrink-0 font-mono text-base font-semibold text-account-muted">
                    {count}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-sm text-account-muted-soft">
                    {group.id}.*
                  </span>
                  <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-account-filter-track">
                    <span
                      className={cn("block h-full rounded-full", colorClass)}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                </div>
              </div>
            );
          })}
          {groups.length > 8 ? (
            <p className="px-1 text-sm text-account-muted">还有 {groups.length - 8} 个分组…</p>
          ) : null}
        </div>
      )}
    </Card>
  );
}

function extractGroupId(key: string): string | null {
  const dotIndex = key.indexOf(".");
  if (dotIndex === -1) return null;
  const secondDot = key.indexOf(".", dotIndex + 1);
  if (secondDot === -1) return key.slice(0, dotIndex);
  return key.slice(0, secondDot);
}
