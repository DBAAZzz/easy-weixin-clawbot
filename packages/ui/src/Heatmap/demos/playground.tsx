import { Heatmap, type HeatmapCell } from "@clawbot/ui";
import { StoryBook, useControls } from "../../Playground/index.js";

function buildCells(empty: boolean): HeatmapCell[] {
  const today = new Date();
  // 一年度（约 365 天）的贡献图，演示按周排列与月份标签。
  return Array.from({ length: 365 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (364 - index));
    const date = day.toISOString().slice(0, 10);
    const level = (empty ? 0 : (index * 7 + 3) % 5) as HeatmapCell["level"];
    const tokens = level === 0 ? 0 : level * 1840 + (index % 30) * 60;
    // label 是 ReactNode：hover 时展示当日 token 用量（即业务侧自定义的明细）。
    return {
      date,
      level,
      label: (
        <>
          <div>{date}</div>
          <div>{tokens === 0 ? "无使用" : `${tokens.toLocaleString()} tokens`}</div>
        </>
      ),
    };
  });
}

export default function HeatmapPlayground() {
  const controls = useControls({ empty: false });

  return (
    <StoryBook>
      <div className="flex flex-col gap-4">
        <Heatmap cells={buildCells(controls.empty)} />
        <span className="text-base text-muted-strong">将鼠标悬停在方块上查看当日 token 用量</span>
      </div>
    </StoryBook>
  );
}
