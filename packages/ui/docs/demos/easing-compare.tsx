import { useCallback, useEffect, useState } from "react";
import "../../src/style.css";
import "./motion-demo.css";

const CURVES = [
  { css: "var(--ease-standard)", label: "ease-standard", hint: "中性 · 无方向属性" },
  { css: "var(--ease-entrance)", label: "ease-entrance", hint: "减速入场 · 浮层出现" },
  { css: "var(--ease-exit)", label: "ease-exit", hint: "加速退场 · 浮层消失" },
  { css: "var(--ease-spring)", label: "ease-spring", hint: "轻微过冲 · thumb 物理感" },
  { css: "linear", label: "linear（对照）", hint: "匀速 · 机械感对照" },
] as const;

export default function EasingCompare() {
  const [played, setPlayed] = useState(false);

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
        <span className="ui-motion-demo__note">同一时长（duration-base 200ms），仅缓动不同</span>
      </div>

      {CURVES.map((curve) => (
        <div className="ui-motion-demo__row" key={curve.label}>
          <div className="ui-motion-demo__meta">
            <span className="ui-motion-demo__name">{curve.label}</span>
            <span className="ui-motion-demo__value">{curve.hint}</span>
          </div>
          <div className="ui-motion-demo__track">
            <div
              className="ui-motion-demo__travel"
              style={{
                transform: played ? "translateX(calc(100% - 18px))" : "translateX(0)",
                transitionDuration: "var(--duration-base)",
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
