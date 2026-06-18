import { Card } from "@clawbot/ui";
import { cn } from "../../lib/cn.js";

interface StatCardProps {
  label: string;
  englishLabel: string;
  value: number | string;
  dotClassName?: string;
  children?: React.ReactNode;
}

export function StatCard(props: StatCardProps) {
  return (
    <Card className="rounded-section border-account-line bg-account-card shadow-account-control backdrop-blur-none">
      <div className="mb-3.5 flex items-center gap-2">
        <span className={cn("size-1.5 rounded-full", props.dotClassName)} />
        <span className="text-sm font-medium text-account-muted">{props.label}</span>
        <span className="ml-auto text-sm text-account-muted-faint">{props.englishLabel}</span>
      </div>
      <div className="font-sans text-2xl font-bold leading-none tracking-title text-account-ink">
        {props.value}
      </div>
      {props.children ? (
        <div className="mt-3.5 flex items-center gap-3.5">{props.children}</div>
      ) : null}
    </Card>
  );
}

interface StatBreakdownItemProps {
  dotClassName: string;
  label: string;
  value: number;
}

export function StatBreakdownItem(props: StatBreakdownItemProps) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm text-account-muted">
      <span className={cn("size-1.5 rounded-xs", props.dotClassName)} />
      {props.label}
      <b className="font-mono font-bold text-account-ink-soft">{props.value}</b>
    </span>
  );
}

interface StatMetaProps {
  children: React.ReactNode;
}

export function StatMeta(props: StatMetaProps) {
  return <div className="text-sm text-account-muted-faint">{props.children}</div>;
}
