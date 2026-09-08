import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import "../../src/style.css";
import "./easing-playground.css";

type ControlPoint = { x: number; y: number };

type HandleId = "p1" | "p2";

const PRESETS = [
  {
    key: "standard",
    label: "standard",
    points: [
      { x: 0.2, y: 0 },
      { x: 0, y: 1 },
    ] as [ControlPoint, ControlPoint],
    hint: "中性对称 · 颜色/状态变化（= M3 emphasized）",
  },
  {
    key: "entrance",
    label: "entrance",
    points: [
      { x: 0.22, y: 0.61 },
      { x: 0.36, y: 1 },
    ] as [ControlPoint, ControlPoint],
    hint: "减速入场 · 浮层出现",
  },
  {
    key: "exit",
    label: "exit",
    points: [
      { x: 0.4, y: 0 },
      { x: 1, y: 1 },
    ] as [ControlPoint, ControlPoint],
    hint: "加速退场 · 浮层消失",
  },
  {
    key: "spring",
    label: "spring",
    points: [
      { x: 0.34, y: 1.4 },
      { x: 0.64, y: 1 },
    ] as [ControlPoint, ControlPoint],
    hint: "轻微过冲 · thumb 物理感（CSS 近似，非真弹簧）",
  },
] as const;

const DURATION_OPTIONS = [
  { key: "instant", token: "--duration-instant" },
  { key: "fast", token: "--duration-fast" },
  { key: "base", token: "--duration-base" },
  { key: "slow", token: "--duration-slow" },
] as const;

type DurationKey = (typeof DURATION_OPTIONS)[number]["key"];

/* Canvas geometry in SVG user units. Margins are derived so the y=1.4
 * overshoot handle (ring r≈8) and the y=-0.1 undershoot both stay inside the
 * viewBox — nothing ever clips. The band above y=1 is tinted as 过冲区. */
const VB_W = 264;
const VB_H = 316;
const BOX_LEFT = 36;
const PLOT = 180;
const BOX_BOTTOM = 282;
const BOX_TOP = BOX_BOTTOM - PLOT;
const BOX_RIGHT = BOX_LEFT + PLOT;

const X_MIN = 0;
const X_MAX = 1;
const Y_MIN = -0.1;
const Y_MAX = 1.4;

const toSvgX = (x: number) => BOX_LEFT + x * PLOT;
const toSvgY = (y: number) => BOX_BOTTOM - y * PLOT;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const formatValue = (value: number) => String(Math.round(value * 1000) / 1000);

const ACTIVE_PRESET_DEFAULT = PRESETS[3];

const RUN_WINDOW_MS = 900;

export default function EasingPlayground() {
  const [p1, setP1] = useState<ControlPoint>(ACTIVE_PRESET_DEFAULT.points[0]);
  const [p2, setP2] = useState<ControlPoint>(ACTIVE_PRESET_DEFAULT.points[1]);
  const [activePreset, setActivePreset] = useState<string | null>(ACTIVE_PRESET_DEFAULT.key);
  const [durationKey, setDurationKey] = useState<DurationKey>("base");
  const [reduced, setReduced] = useState(false);
  const [running, setRunning] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [dragging, setDragging] = useState<HandleId | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const durationToken = DURATION_OPTIONS.find((option) => option.key === durationKey)?.token;
  const bezierCss = `cubic-bezier(${formatValue(p1.x)}, ${formatValue(p1.y)}, ${formatValue(p2.x)}, ${formatValue(p2.y)})`;
  const snippet = `transition: transform var(${durationToken}) ${bezierCss});`;

  /* 播放 → 动画结束后无过渡归位，静止态保持干净的起点。 */
  const replay = useCallback(() => {
    setRunning(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setRunning(true);
        window.setTimeout(() => {
          setRunning(false);
        }, RUN_WINDOW_MS);
      });
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(replay, 400);
    return () => window.clearTimeout(timer);
  }, [replay]);

  const applyPreset = (preset: (typeof PRESETS)[number]) => {
    setP1(preset.points[0]);
    setP2(preset.points[1]);
    setActivePreset(preset.key);
    replay();
  };

  const eventToSvg = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return null;
    }
    return {
      x: ((event.clientX - rect.left) / rect.width) * VB_W,
      y: ((event.clientY - rect.top) / rect.height) * VB_H,
    };
  };

  const movePoint = (handle: HandleId, next: ControlPoint) => {
    if (handle === "p1") {
      setP1(next);
    } else {
      setP2(next);
    }
  };

  const startDrag = (handle: HandleId) => (event: ReactPointerEvent<SVGCircleElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(handle);
    setActivePreset(null);
  };

  const onSvgPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!dragging) {
      return;
    }
    const point = eventToSvg(event);
    if (!point) {
      return;
    }
    movePoint(dragging, {
      x: clamp((point.x - BOX_LEFT) / PLOT, X_MIN, X_MAX),
      y: clamp((BOX_BOTTOM - point.y) / PLOT, Y_MIN, Y_MAX),
    });
  };

  const nudgePoint = (handle: HandleId) => (event: ReactKeyboardEvent<SVGCircleElement>) => {
    const step = event.shiftKey ? 0.05 : 0.01;
    const current = handle === "p1" ? p1 : p2;
    let next = current;

    switch (event.key) {
      case "ArrowLeft":
        next = { ...current, x: clamp(current.x - step, X_MIN, X_MAX) };
        break;
      case "ArrowRight":
        next = { ...current, x: clamp(current.x + step, X_MIN, X_MAX) };
        break;
      case "ArrowUp":
        next = { ...current, y: clamp(current.y + step, Y_MIN, Y_MAX) };
        break;
      case "ArrowDown":
        next = { ...current, y: clamp(current.y - step, Y_MIN, Y_MAX) };
        break;
      default:
        return;
    }

    event.preventDefault();
    setActivePreset(null);
    movePoint(handle, next);
  };

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopyFailed(false);
      setCopied(true);
      window.setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      setCopyFailed(true);
    }
  };

  /* 入场：静止在左，播放滑到右；退场：静止在右，播放滑向左。 */
  const trackStyle = (direction: "entrance" | "exit") => ({
    transform:
      direction === "entrance"
        ? running
          ? "translateX(calc(100% - 26px))"
          : "translateX(0)"
        : running
          ? "translateX(0)"
          : "translateX(calc(100% - 26px))",
    transitionDuration: running ? (reduced ? "1ms" : `var(${durationToken})`) : "0ms",
    transitionProperty: "transform",
    transitionTimingFunction: bezierCss,
  });

  const curvePath = `M ${toSvgX(0)} ${toSvgY(0)} C ${toSvgX(p1.x)} ${toSvgY(p1.y)}, ${toSvgX(p2.x)} ${toSvgY(p2.y)}, ${toSvgX(1)} ${toSvgY(1)}`;

  const activeHint = PRESETS.find((preset) => preset.key === activePreset)?.hint;

  return (
    <div className="ui-motion-ep">
      <div className="ui-motion-ep__canvas">
        <svg
          aria-label="缓动曲线编辑器：拖动两个控制点调整 cubic-bezier"
          className="ui-motion-ep__svg"
          onPointerCancel={() => setDragging(null)}
          onPointerMove={onSvgPointerMove}
          onPointerUp={() => setDragging(null)}
          ref={svgRef}
          role="img"
          viewBox={`0 0 ${VB_W} ${VB_H}`}
        >
          {/* overshoot band above y=1 — the headroom is a named region, not blank space */}
          <rect
            fill="rgb(29 110 84 / 5%)"
            height={toSvgY(1) - toSvgY(Y_MAX)}
            width={PLOT}
            x={BOX_LEFT}
            y={toSvgY(Y_MAX)}
          />
          <text
            fill="rgb(29 110 84 / 55%)"
            font-size="9"
            letter-spacing="0.12em"
            text-anchor="end"
            x={BOX_RIGHT - 6}
            y={toSvgY(Y_MAX) + 14}
          >
            过冲区
          </text>

          {/* quarter grid inside the unit box */}
          {[0.25, 0.5, 0.75].map((step) => (
            <g key={step}>
              <line
                stroke="var(--clawbot-doc-border)"
                stroke-width="1"
                x1={toSvgX(step)}
                x2={toSvgX(step)}
                y1={toSvgY(0)}
                y2={toSvgY(1)}
              />
              <line
                stroke="var(--clawbot-doc-border)"
                stroke-width="1"
                x1={toSvgX(0)}
                x2={toSvgX(1)}
                y1={toSvgY(step)}
                y2={toSvgY(step)}
              />
            </g>
          ))}

          {/* unit box + dashed linear reference */}
          <rect
            fill="none"
            height={PLOT}
            stroke="var(--clawbot-doc-border-strong)"
            stroke-width="1.5"
            width={PLOT}
            x={BOX_LEFT}
            y={toSvgY(1)}
          />
          <line
            stroke="var(--clawbot-doc-subtle)"
            stroke-dasharray="4 5"
            stroke-width="1"
            x1={toSvgX(0)}
            x2={toSvgX(1)}
            y1={toSvgY(0)}
            y2={toSvgY(1)}
          />

          {/* control arms */}
          <line
            stroke="rgb(29 110 84 / 30%)"
            stroke-width="1.5"
            x1={toSvgX(0)}
            x2={toSvgX(p1.x)}
            y1={toSvgY(0)}
            y2={toSvgY(p1.y)}
          />
          <line
            stroke="rgb(29 110 84 / 30%)"
            stroke-width="1.5"
            x1={toSvgX(1)}
            x2={toSvgX(p2.x)}
            y1={toSvgY(1)}
            y2={toSvgY(p2.y)}
          />

          {/* the curve */}
          <path
            d={curvePath}
            fill="none"
            stroke="var(--color-accent, #1d6e54)"
            stroke-linecap="round"
            stroke-width="2.5"
          />

          {/* axis labels */}
          <text
            fill="var(--clawbot-doc-subtle)"
            font-family="var(--clawbot-doc-mono)"
            font-size="10"
            text-anchor="end"
            x={BOX_LEFT - 8}
            y={toSvgY(0) + 3}
          >
            0
          </text>
          <text
            fill="var(--clawbot-doc-subtle)"
            font-family="var(--clawbot-doc-mono)"
            font-size="10"
            text-anchor="end"
            x={BOX_LEFT - 8}
            y={toSvgY(1) + 3}
          >
            1
          </text>
          <text
            fill="var(--clawbot-doc-subtle)"
            font-family="var(--clawbot-doc-mono)"
            font-size="10"
            text-anchor="middle"
            x={toSvgX(1)}
            y={toSvgY(0) + 16}
          >
            1
          </text>

          {/* draggable handles */}
          <circle
            cx={toSvgX(p1.x)}
            cy={toSvgY(p1.y)}
            fill="var(--clawbot-doc-surface)"
            r="6.5"
            stroke="var(--color-accent, #1d6e54)"
            stroke-width="2.5"
          />
          <circle
            aria-label="控制点 1（方向键微调，Shift 加速）"
            cx={toSvgX(p1.x)}
            cy={toSvgY(p1.y)}
            cursor={dragging === "p1" ? "grabbing" : "grab"}
            fill="transparent"
            onPointerDown={startDrag("p1")}
            onKeyDown={nudgePoint("p1")}
            r="16"
            tabIndex={0}
          />
          <circle
            cx={toSvgX(p2.x)}
            cy={toSvgY(p2.y)}
            fill="var(--clawbot-doc-surface)"
            r="6.5"
            stroke="var(--color-accent, #1d6e54)"
            stroke-width="2.5"
          />
          <circle
            aria-label="控制点 2（方向键微调，Shift 加速）"
            cx={toSvgX(p2.x)}
            cy={toSvgY(p2.y)}
            cursor={dragging === "p2" ? "grabbing" : "grab"}
            fill="transparent"
            onPointerDown={startDrag("p2")}
            onKeyDown={nudgePoint("p2")}
            r="16"
            tabIndex={0}
          />
        </svg>
      </div>

      <div className="ui-motion-ep__side">
        <div className="ui-motion-ep__group">
          <span className="ui-motion-ep__group-label">库内曲线</span>
          <div className="ui-motion-ep__chips">
            {PRESETS.map((preset) => (
              <button
                aria-pressed={activePreset === preset.key}
                className="ui-motion-ep__chip"
                key={preset.key}
                onClick={() => applyPreset(preset)}
                type="button"
              >
                {preset.label}
              </button>
            ))}
          </div>
          {activeHint ? <span className="ui-motion-ep__chip-hint">{activeHint}</span> : null}
        </div>

        <div className="ui-motion-ep__group">
          <span className="ui-motion-ep__group-label">时长</span>
          <div className="ui-motion-ep__chips">
            {DURATION_OPTIONS.map((option) => (
              <button
                aria-pressed={durationKey === option.key}
                className="ui-motion-ep__chip"
                key={option.key}
                onClick={() => {
                  setDurationKey(option.key);
                  replay();
                }}
                type="button"
              >
                {option.key}
              </button>
            ))}
          </div>
        </div>

        <div className="ui-motion-ep__controls-row">
          <button className="ui-motion-ep__play" onClick={replay} type="button">
            播放
          </button>
          <label className="ui-motion-ep__toggle">
            <input
              checked={reduced}
              onChange={(event) => setReduced(event.target.checked)}
              type="checkbox"
            />
            模拟 reduced-motion
          </label>
        </div>

        <div className="ui-motion-ep__tracks">
          <div className="ui-motion-ep__track-row">
            <span className="ui-motion-ep__track-label">入场 · entrance 语义</span>
            <div className="ui-motion-ep__track">
              <div className="ui-motion-ep__travel" style={trackStyle("entrance")}>
                <span className="ui-motion-ep__dot" />
              </div>
            </div>
          </div>
          <div className="ui-motion-ep__track-row">
            <span className="ui-motion-ep__track-label">退场 · exit 语义（从右侧离开）</span>
            <div className="ui-motion-ep__track">
              <div className="ui-motion-ep__travel" style={trackStyle("exit")}>
                <span className="ui-motion-ep__dot" />
              </div>
            </div>
          </div>
        </div>

        <div className="ui-motion-ep__output">
          <div className="ui-motion-ep__code">
            <pre>{snippet}</pre>
            <button className="ui-motion-ep__copy" onClick={copySnippet} type="button">
              复制
            </button>
          </div>
          <span className="ui-motion-ep__copy-status">
            {copyFailed ? "复制失败，请手动选择代码" : copied ? "已复制到剪贴板" : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
