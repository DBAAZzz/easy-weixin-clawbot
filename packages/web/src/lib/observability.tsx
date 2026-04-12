import type { ObservabilityTraceDetail, ObservabilityTraceSummary } from "@clawbot/shared";
import React, { type ComponentType, type SVGProps } from "react";
import { cn } from "./cn.js";
import {
  ArrowRightIcon,
  BoltIcon,
  BookIcon,
  ChatIcon,
  LockIcon,
  TerminalIcon,
} from "../components/ui/icons.js";

type TraceRecord = ObservabilityTraceSummary | ObservabilityTraceDetail;
type IconProps = SVGProps<SVGSVGElement>;
type IconComponent = ComponentType<IconProps>;

export function buildTraceDetailPath(traceId: string) {
  return `/observability/traces/${encodeURIComponent(traceId)}`;
}

export function getTraceStatus(trace: TraceRecord) {
  if (trace.error || trace.flags.includes("error")) {
    return {
      label: "error",
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }

  return {
    label: trace.stop_reason,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700",
  };
}

const SPAN_ICON_MAP: Record<string, IconComponent> = {
  "llm.call": ChatIcon,
  "tool.execute": TerminalIcon,
  "message.receive": (props) => (
    <ArrowRightIcon {...props} className={cn(props.className, "rotate-180")} />
  ),
  "message.send": ArrowRightIcon,
  "command.dispatch": BoltIcon,
  "conversation.lock": LockIcon,
  "history.load": BookIcon,
  "agent.chat": ChatIcon,
};

export function SpanGlyph(props: { name: string; className?: string }) {
  const Icon = SPAN_ICON_MAP[props.name] ?? ChatIcon;
  return <Icon className={cn("shrink-0", props.className)} />;
}
