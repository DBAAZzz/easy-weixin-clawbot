import type { ReactNode } from "react";
import { cn } from "../utils/cn.js";
import { Tooltip } from "../Tooltip/index.js";

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

export type HeatmapCell = {
  /** ISO date (YYYY-MM-DD)；用于按周排列，也是 tooltip 的兜底文案。 */
  date: string;
  /** 强度等级，0 渲染为闲置色，1–4 由浅到深。 */
  level: HeatmapLevel;
  /** hover 时的 tooltip 内容，缺省回退到 date。 */
  label?: ReactNode;
};

export type HeatmapProps = {
  cells: HeatmapCell[];
  className?: string;
};

function toDate(date: string): Date {
  return new Date(`${date}T00:00:00`);
}

type MonthLabel = { key: string; text: string; column: number };

/**
 * 每月 1 号所在的周列即放一个月份标签（贡献图惯例）。起始那个不完整的月份
 * 不带标签——和 GitHub 一致，避免和下一个月挤在一起。
 */
function monthLabels(cells: HeatmapCell[], firstWeekday: number): MonthLabel[] {
  const labels: MonthLabel[] = [];
  cells.forEach((cell, index) => {
    const date = toDate(cell.date);
    if (date.getDate() !== 1) return;
    labels.push({
      key: cell.date,
      text: `${date.getMonth() + 1}月`,
      column: Math.floor((firstWeekday + index) / 7) + 1,
    });
  });
  return labels;
}

export function Heatmap({ cells, className }: HeatmapProps) {
  const firstWeekday = cells.length ? toDate(cells[0].date).getDay() : 0;
  const columnCount = cells.length ? Math.ceil((firstWeekday + cells.length) / 7) : 0;
  const labels = monthLabels(cells, firstWeekday);

  return (
    <div className={cn("cb-heatmap", className)}>
      <div className="cb-heatmap-grid">
        {cells.map((cell, index) => (
          <Tooltip key={cell.date} title={cell.label ?? cell.date}>
            <span
              className={cn("cb-heatmap-cell", `cb-heatmap-cell--l${cell.level}`)}
              // 仅首格按真实星期定位，其余由 grid auto-flow 顺序填充。
              style={index === 0 ? { gridRowStart: firstWeekday + 1 } : undefined}
              aria-label={typeof cell.label === "string" ? cell.label : cell.date}
            />
          </Tooltip>
        ))}
      </div>
      {labels.length ? (
        <div
          className="cb-heatmap-months"
          style={{ gridTemplateColumns: `repeat(${columnCount}, var(--spacing-7))` }}
        >
          {labels.map((label) => (
            <span
              key={label.key}
              className="cb-heatmap-month"
              style={{ gridColumnStart: label.column }}
            >
              {label.text}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
