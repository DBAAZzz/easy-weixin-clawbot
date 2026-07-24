import type { SkillProvisionLog } from "@clawbot/shared";
import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn.js";

const levelClassName: Record<SkillProvisionLog["level"], string> = {
  info: "text-ink-soft",
  warn: "text-account-warning-fg",
  error: "text-danger-strong",
};

function formatLogTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("zh-CN", { hour12: false });
}

function statusLabel(props: { busy: boolean; failed: boolean; hasLogs: boolean }) {
  if (props.busy) return { text: "安装中", className: "text-accent" };
  if (props.failed) return { text: "失败", className: "text-danger-strong" };
  if (props.hasLogs) return { text: "已完成", className: "text-account-success-fg" };
  return null;
}

export function ProvisionConsole(props: { logs: SkillProvisionLog[]; busy: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  // 供给流在抛错前必定先发一条 error 日志，用它判定本次安装是否失败
  const status = statusLabel({
    busy: props.busy,
    failed: props.logs.at(-1)?.level === "error",
    hasLogs: props.logs.length > 0,
  });

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    viewport.scrollTop = viewport.scrollHeight;
  }, [props.logs.length]);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs tracking-label text-muted">安装日志</p>
        {status ? (
          <span className={cn("flex items-center gap-1.5 text-sm font-semibold", status.className)}>
            {props.busy ? <span className="status-dot size-1.5 rounded-full bg-accent" /> : null}
            {status.text}
          </span>
        ) : null}
      </div>

      <div
        ref={viewportRef}
        role="log"
        aria-live="polite"
        className="mt-2.5 max-h-64 overflow-auto rounded-panel border border-line bg-white/78 px-4 py-3"
      >
        {props.logs.length === 0 ? (
          <p className="font-mono text-xs text-muted">暂无日志</p>
        ) : (
          props.logs.map((log, index) => (
            <p
              key={`${log.timestamp}-${index}`}
              className={cn("flex gap-3 font-mono text-xs leading-5", levelClassName[log.level])}
            >
              <span className="shrink-0 text-muted">{formatLogTime(log.timestamp)}</span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{log.message}</span>
            </p>
          ))
        )}
      </div>
    </div>
  );
}
