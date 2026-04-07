import { Input } from "../ui/input.js";
import { Button } from "../ui/button.js";
import { RefreshIcon, SearchIcon } from "../ui/icons.js";

function selectClassName(disabled = false) {
  return [
    "h-10 w-full rounded-[14px] border border-[var(--line-strong)] bg-[rgba(255,255,255,0.82)] px-3.5 text-[12px] text-[var(--ink)] outline-none transition duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] focus:border-[var(--accent)] focus:ring-[3px] focus:ring-[rgba(21,110,99,0.14)]",
    disabled ? "cursor-not-allowed opacity-60" : "",
  ].join(" ");
}

interface Option {
  value: string;
  label: string;
}

export function MemoryFilters(props: {
  accountOptions: Option[];
  branchOptions: Option[];
  selectedAccountId: string;
  selectedBranch: string;
  query: string;
  loading: boolean;
  onAccountChange(accountId: string): void;
  onBranchChange(branch: string): void;
  onQueryChange(query: string): void;
  onRefresh(): void;
}) {
  const disabled = props.loading || props.accountOptions.length === 0;

  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_auto] xl:items-end">
      <label className="space-y-1.5">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">账号</span>
        <select
          className={selectClassName(disabled)}
          value={props.selectedAccountId}
          disabled={disabled}
          onChange={(event) => props.onAccountChange(event.target.value)}
        >
          {props.accountOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1.5">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">分支</span>
        <select
          className={selectClassName(disabled)}
          value={props.selectedBranch}
          disabled={disabled}
          onChange={(event) => props.onBranchChange(event.target.value)}
        >
          {props.branchOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <label className="space-y-1.5">
        <span className="text-[10px] uppercase tracking-[0.18em] text-[var(--muted)]">搜索</span>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
          <Input
            value={props.query}
            disabled={disabled}
            onChange={(event) => props.onQueryChange(event.target.value)}
            placeholder="按 key、值或分支过滤"
            className="pl-10"
          />
        </div>
      </label>

      <div className="flex items-end xl:justify-end">
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-center gap-1.5 xl:min-w-[88px] xl:w-auto"
          onClick={props.onRefresh}
          disabled={disabled}
        >
          <RefreshIcon className="size-4" />
          刷新
        </Button>
      </div>
    </div>
  );
}
