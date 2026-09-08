import { useCallback, useEffect, useState } from "react";
import "../../src/style.css";
import "./motion-demo.css";

const CURVES = [
  {
    css: "var(--ease-standard)",
    label: "ease-standard",
    hint: "中性 · 无方向属性",
    points: [0.2, 0, 0, 1],
  },
  {
    css: "var(--ease-entrance)",
    label: "ease-entrance",
    hint: "减速入场 · 浮层出现",
    points: [0.22, 0.61, 0.36, 1],
  },
  {
    css: "var(--ease-exit)",
    label: "ease-exit",
    hint: "加速退场 · 浮层消失",
    points: [0.4, 0, 1, 1],
  },
  {
    css: "var(--ease-spring)",
    label: "ease-spring",
    hint: "轻微过冲 · thumb 物理感",
    points: [0.34, 1.4, 0.64, 1],
  },
  { css: "linear", label: "linear（对照）", hint: "匀速 · 机械感对照", points: [0, 0, 1, 1] },
] as const;

const RUN_WINDOW_MS = 900;

/* Mini cubic-bezier sparkline: x = time, y = progress, dashed line = linear. */
function BezierSparkline({ points }: { points: readonly [number, number, number, number] }) {
  const width = 64;
  const height = 36;
  const pad = 3;
  const [x1, y1, x2, y2] = points;
  const toX = (x: number) => pad + x * (width - pad * 2);
  const toY = (y: number) => height - pad - y * (height - pad * 2);

  const samplePoints = Array.from({ length: 33 }, (_, index) => {
    const t = index / 32;
    const u = 1 - t;
    const x = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
    const y = 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
    return `${toX(x).toFixed(2)},${toY(Math.min(y, 1.25)).toFixed(2)}`;
  }).join(" ");

  return (
    <svg aria-hidden="true" className="ui-motion-demo__spark" viewBox={`0 0 ${width} ${height}`}>
      <line
        stroke="var(--clawbot-doc-border-strong)"
        stroke-dasharray="3 3"
        stroke-width="1"
        x1={toX(0)}
        x2={toX(1)}
        y1={toY(0)}
        y2={toY(1)}
      />
      <polyline
        fill="none"
        points={samplePoints}
        stroke="var(--color-accent, #1d6e54)"
        stroke-linecap="round"
        stroke-width="2"
      />
    </svg>
  );
}

export default function EasingCompare() {
  const [running, setRunning] = useState(false);

  const play = useCallback(() => {
    setRunning(true);
    window.setTimeout(() => {
      setRunning(false);
    }, RUN_WINDOW_MS);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(play, 400);
    return () => window.clearTimeout(timer);
  }, [play]);

  return (
    <div className="ui-motion-demo">
      <div className="ui-motion-demo__toolbar">
        <button className="ui-motion-demo__play" onClick={play} type="button">
          播放
        </button>
        <span className="ui-motion-demo__note">同一时长，只变缓动</span>
      </div>

      {CURVES.map((curve) => (
        <div className="ui-motion-demo__row ui-motion-demo__row--with-spark" key={curve.label}>
          <div className="ui-motion-demo__meta">
            <span className="ui-motion-demo__name">{curve.label}</span>
            <span className="ui-motion-demo__value">{curve.hint}</span>
          </div>
          <BezierSparkline points={curve.points} />
          <div className="ui-motion-demo__track">
            <div
              className="ui-motion-demo__travel"
              style={{
                transform: running ? "translateX(calc(100% - 26px))" : "translateX(0)",
                transitionDuration: running ? "var(--duration-base)" : "0ms",
                transitionProperty: "transform",
                transitionTimingFunction: curve.css,
              }}
            >
              <span className="ui-motion-demo__dot" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
