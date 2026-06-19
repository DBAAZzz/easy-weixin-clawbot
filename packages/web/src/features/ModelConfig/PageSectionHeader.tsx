import type { ReactNode } from "react";

export function PageSectionHeader(props: { title: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <h3 className="text-lg text-ink">{props.title}</h3>
      </div>

      {props.action ? <div className="flex shrink-0 flex-wrap gap-2">{props.action}</div> : null}
    </div>
  );
}
