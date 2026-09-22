import { useCallback, useEffect, useState } from "react";
import "../../src/style.css";
import "./motion-demo.css";

const STEPS = [
  { token: "--duration-instant", label: "duration-instant", hint: "按压反馈 · 菜单高亮" },
  { token: "--duration-fast", label: "duration-fast", hint: "hover · 颜色/边框/阴影" },
  { token: "--duration-base", label: "duration-base", hint: "Dialog 进场 · thumb 位移" },
  { token: "--duration-slow", label: "duration-slow", hint: "大面板展开 · focus" },
] as const;

/** 播放 → 动画完成后无过渡归位，静止态保持干净的起点。 */
const RUN_WINDOW_MS = 900;

export default function DurationLadder() {
  const [running, setRunning] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const step of STEPS) {
      next[step.token] = styles.getPropertyValue(step.token).trim();
    }
    setValues(next);
  }, []);

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
        <span className="ui-motion-demo__note">同一缓动，只变时长</span>
      </div>

      {STEPS.map((step) => (
        <div className="ui-motion-demo__row" key={step.token}>
          <div className="ui-motion-demo__meta">
            <span className="ui-motion-demo__name">{step.label}</span>
            <span className="ui-motion-demo__value">
              {values[step.token] || "…"} · {step.hint}
            </span>
          </div>
          <div className="ui-motion-demo__track">
            <div
              className="ui-motion-demo__travel"
              style={{
                transform: running ? "translateX(calc(100% - 26px))" : "translateX(0)",
                transitionDuration: running ? `var(${step.token})` : "0ms",
                transitionProperty: "transform",
                transitionTimingFunction: "var(--ease-standard)",
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
