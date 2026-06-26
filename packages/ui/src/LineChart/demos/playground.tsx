import { LineChart, type LineChartSeries } from "@clawbot/ui";
import { StoryBook, useControls } from "../../Playground/index.js";

function buildSeries(multi: boolean): LineChartSeries[] {
  const today = new Date();
  const days = Array.from({ length: 30 }, (_, index) => {
    const day = new Date(today);
    day.setDate(today.getDate() - (29 - index));
    return day.toISOString().slice(0, 10);
  });

  const make = (name: string, color: string, base: number, swing: number): LineChartSeries => ({
    name,
    color,
    points: days.map((x, i) => ({ x, y: Math.round(base + Math.sin(i / 3) * swing + i * 12) })),
  });

  const series = [make("claude-opus-4", "var(--color-accent)", 800, 300)];
  if (multi) {
    series.push(make("gpt-5", "var(--color-accent-soft-border)", 400, 200));
    series.push(make("gemini-2.5", "var(--color-ink-soft)", 200, 120));
  }
  return series;
}

export default function LineChartPlayground() {
  const controls = useControls({ multi: true });

  return (
    <StoryBook>
      <LineChart series={buildSeries(controls.multi)} />
    </StoryBook>
  );
}
