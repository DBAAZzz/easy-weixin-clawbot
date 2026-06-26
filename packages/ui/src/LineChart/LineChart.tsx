import { useMemo, type MouseEvent } from "react";
import { Group } from "@visx/group";
import { LinePath } from "@visx/shape";
import { scaleTime, scaleLinear } from "@visx/scale";
import { AxisBottom, AxisLeft } from "@visx/axis";
import { GridRows } from "@visx/grid";
import { ParentSize } from "@visx/responsive";
import { useTooltip, TooltipWithBounds } from "@visx/tooltip";
import { localPoint } from "@visx/event";
import { cn } from "../utils/cn.js";
import type { LineChartProps, LineChartSeries } from "./type.js";

// 坐标轴留白（像素），给刻度文案让位。
const MARGIN = { top: 8, right: 12, bottom: 22, left: 40 };

function toDate(x: string): Date {
  return new Date(`${x}T00:00:00`);
}

function defaultFormatX(x: string): string {
  const date = toDate(x);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function defaultFormatY(y: number): string {
  if (y >= 1_000_000) return `${(y / 1_000_000).toFixed(1)}m`;
  if (y >= 1_000) return `${(y / 1_000).toFixed(1)}k`;
  return String(y);
}

type TooltipDatum = {
  x: string;
  entries: { name: string; color: string; y: number }[];
};

function LineChartCanvas({
  series,
  width,
  height,
  formatX,
  formatY,
}: {
  series: LineChartSeries[];
  width: number;
  height: number;
  formatX: (x: string) => string;
  formatY: (y: number) => string;
}) {
  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = height - MARGIN.top - MARGIN.bottom;

  const { xScale, yScale, dates } = useMemo(() => {
    const allDates = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))].sort();
    const maxY = Math.max(1, ...series.flatMap((s) => s.points.map((p) => p.y)));
    return {
      dates: allDates,
      xScale: scaleTime({
        domain: [toDate(allDates[0]), toDate(allDates[allDates.length - 1])],
        range: [0, innerW],
      }),
      yScale: scaleLinear({ domain: [0, maxY], range: [innerH, 0], nice: true }),
    };
  }, [series, innerW, innerH]);

  const { showTooltip, hideTooltip, tooltipData, tooltipLeft, tooltipTop, tooltipOpen } =
    useTooltip<TooltipDatum>();

  function handleMove(event: MouseEvent<SVGRectElement>) {
    const point = localPoint(event);
    if (!point) return;
    const x0 = xScale.invert(point.x - MARGIN.left);
    const nearest = dates.reduce((best, day) =>
      Math.abs(toDate(day).getTime() - x0.getTime()) <
      Math.abs(toDate(best).getTime() - x0.getTime())
        ? day
        : best,
    );
    const entries = series
      .map((s) => {
        const hit = s.points.find((p) => p.x === nearest);
        return hit ? { name: s.name, color: s.color, y: hit.y } : null;
      })
      .filter((entry): entry is TooltipDatum["entries"][number] => entry !== null);

    showTooltip({
      tooltipData: { x: nearest, entries },
      tooltipLeft: MARGIN.left + xScale(toDate(nearest)),
      tooltipTop: MARGIN.top,
    });
  }

  return (
    <>
      <svg className="cb-line-chart-svg" width={width} height={height}>
        <Group left={MARGIN.left} top={MARGIN.top}>
          <GridRows scale={yScale} width={innerW} numTicks={4} className="cb-line-chart-grid" />
          {series.map((s) => (
            <LinePath
              key={s.name}
              data={s.points}
              x={(p) => xScale(toDate(p.x))}
              y={(p) => yScale(p.y)}
              strokeWidth={1.5}
              style={{ stroke: s.color, fill: "none" }}
            />
          ))}
        </Group>
        <AxisLeft
          scale={yScale}
          left={MARGIN.left}
          top={MARGIN.top}
          numTicks={4}
          tickFormat={(value) => formatY(Number(value))}
          hideAxisLine
          hideTicks
          axisClassName="cb-line-chart-axis"
        />
        <AxisBottom
          scale={xScale}
          left={MARGIN.left}
          top={MARGIN.top + innerH}
          numTicks={5}
          tickFormat={(value) => defaultFormatXFromDate(value as Date, formatX)}
          axisClassName="cb-line-chart-axis"
        />
        {tooltipOpen ? (
          <line
            className="cb-line-chart-guide"
            x1={tooltipLeft}
            x2={tooltipLeft}
            y1={MARGIN.top}
            y2={MARGIN.top + innerH}
          />
        ) : null}
        <rect
          x={MARGIN.left}
          y={MARGIN.top}
          width={Math.max(0, innerW)}
          height={Math.max(0, innerH)}
          fill="transparent"
          onMouseMove={handleMove}
          onMouseLeave={hideTooltip}
        />
      </svg>
      {tooltipOpen && tooltipData ? (
        <TooltipWithBounds
          key={tooltipData.x}
          left={tooltipLeft}
          top={tooltipTop}
          className="cb-line-chart-tooltip"
          unstyled
        >
          <div className="cb-line-chart-tooltip-date">{formatX(tooltipData.x)}</div>
          {tooltipData.entries.map((entry) => (
            <div key={entry.name} className="cb-line-chart-tooltip-row">
              <span className="cb-line-chart-tooltip-dot" style={{ background: entry.color }} />
              <span className="cb-line-chart-tooltip-name">{entry.name}</span>
              <span className="cb-line-chart-tooltip-value">{formatY(entry.y)}</span>
            </div>
          ))}
        </TooltipWithBounds>
      ) : null}
    </>
  );
}

// AxisBottom 用的是 scaleTime，刻度值是 Date；用回业务的 formatX 需要先还原成 YYYY-MM-DD。
function defaultFormatXFromDate(date: Date, formatX: (x: string) => string): string {
  const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return formatX(iso);
}

export function LineChart({
  series,
  formatX = defaultFormatX,
  formatY = defaultFormatY,
  className,
}: LineChartProps) {
  return (
    <div className={cn("cb-line-chart", className)}>
      <ParentSize>
        {({ width, height }) =>
          width > 0 && height > 0 && series.length > 0 ? (
            <LineChartCanvas
              series={series}
              width={width}
              height={height}
              formatX={formatX}
              formatY={formatY}
            />
          ) : null
        }
      </ParentSize>
    </div>
  );
}
