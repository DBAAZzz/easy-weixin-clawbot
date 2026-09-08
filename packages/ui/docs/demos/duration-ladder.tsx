import { useCallback, useEffect, useState } from "react";
import "../../src/style.css";
import "./motion-demo.css";

const STEPS = [
  { token: "--duration-instant", label: "duration-instant", hint: "按压反馈 · 菜单高亮" },
  { token: "--duration-fast", label: "duration-fast", hint: "hover · 颜色/边框/阴影" },
  { token: "--duration-base", label: "duration-base", hint: "图标旋转 · thumb 位移" },
  { token: "--duration-slow", label: "duration-slow", hint: "Dialog 进出场 · focus" },
] as const;

export default function DurationLadder() {
  const [played, setPlayed] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});

  useEffect(() => {
    const styles = getComputedStyle(document.documentElement);
    const next: Record<string, string> = {};
    for (const step of STEPS) {
      next[step.token] = styles.getPropertyValue(step.token).trim();
    }
    setValues(next);
  }, []);

  const replay = useCallback(() => {
    setPlayed(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setPlayed(true);
      });
    });
  }, []);

  useEffect(() => {
    replay();
  }, [replay]);

  return (
    <div className="ui-motion-demo">
      <div className="ui-motion-demo__toolbar">
        <button className="ui-motion-demo__play" onClick={replay} type="button">
          播放
        </button>
        <span className="ui-motion-demo__note">同一缓动（standard），仅时长不同</span>
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
                transform: played ? "translateX(calc(100% - 18px))" : "translateX(0)",
                transitionDuration: `var(${step.token})`,
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
