import type { ReactNode } from "react";
import { cn } from "../utils/cn.js";

export function DialogMetaItem(props: {
  label: ReactNode;
  value: ReactNode;
  className?: string;
  mono?: boolean;
}) {
  return (
    <div className={cn("cb-min-w-0", props.className)}>
      <dt className="cb-dialog-meta-label">{props.label}</dt>
      <dd className={cn("cb-dialog-meta-value", props.mono && "cb-font-mono")}>{props.value}</dd>
    </div>
  );
}

export function DialogParamItem(props: {
  name: ReactNode;
  required?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("cb-dialog-param", props.className)}>
      <span className="cb-dialog-param-name">{props.name}</span>
      <span
        className={cn(
          "cb-dialog-param-badge",
          props.required ? "cb-dialog-param-badge--required" : "cb-dialog-param-badge--optional",
        )}
      >
        {props.required ? "必填" : "可选"}
      </span>
    </div>
  );
}
