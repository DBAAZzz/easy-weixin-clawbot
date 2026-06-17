import { cn } from "../../lib/cn.js";

export function CompactMetaStrip(props: {
  items: Array<{ label: string; value: string; mono?: boolean }>;
}) {
  return (
    <div className="mt-5 overflow-hidden rounded-panel border border-line bg-white/72">
      <dl className="grid gap-0 md:grid-cols-2 xl:grid-cols-4">
        {props.items.map((item, index) => (
          <div
            key={item.label}
            className={cn(
              "px-4 py-3.5",
              index > 0 && "border-t border-line",
              index % 2 === 1 && "md:border-l",
              index < 2 && "md:border-t-0",
              index > 0 && "xl:border-l",
              index > 1 && "xl:border-t-0",
            )}
          >
            <dt className="text-xs tracking-label text-muted">{item.label}</dt>
            <dd
              className={cn(
                "mt-1.5 text-md font-medium text-ink",
                item.mono && "font-mono text-sm tracking-mono text-ink-soft",
              )}
            >
              {item.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
