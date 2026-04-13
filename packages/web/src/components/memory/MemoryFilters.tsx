import { Input } from "../ui/input.js";
import { Button } from "../ui/button.js";
import { Select } from "../ui/select.js";
import { RefreshIcon, SearchIcon } from "../ui/icons.js";

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
      <div className="space-y-1.5">
        <span className="text-xs uppercase tracking-caps-lg text-muted">账号</span>
        <Select
          value={props.selectedAccountId}
          options={props.accountOptions}
          onChange={props.onAccountChange}
          placeholder="选择账号"
          disabled={disabled}
        />
      </div>

      <div className="space-y-1.5">
        <span className="text-xs uppercase tracking-caps-lg text-muted">分支</span>
        <Select
          value={props.selectedBranch}
          options={props.branchOptions}
          onChange={props.onBranchChange}
          placeholder="选择分支"
          disabled={disabled}
        />
      </div>

      <label className="space-y-1.5">
        <span className="text-xs uppercase tracking-caps-lg text-muted">搜索</span>
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
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
