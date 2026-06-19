import type { ReactNode } from "react";

export function MetricPanel(props: {
  items: Array<{
    icon: ReactNode;
    label: string;
    value: ReactNode;
  }>;
}) {
  return (
    <div className="bg-pane-82 mt-3 grid grid-cols-2 divide-x divide-line overflow-hidden rounded-lg border border-line/80">
      {" "}
      {props.items.map((item) => (
        <div key={item.label} className="px-3 py-2.5">
          <div className="flex items-center gap-1.5 text-sm text-muted">
            <span className="inline-flex size-3.5 items-center justify-center">{item.icon}</span>
            <span>{item.label}</span>
          </div>
          <p className="mt-1 text-md font-medium text-muted-strong">{item.value}</p>
        </div>
      ))}
    </div>
  );
}
