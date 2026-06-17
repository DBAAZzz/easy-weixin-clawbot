import { Input, SearchIcon, Select, Toggle, ToggleGroup } from "@clawbot/ui";
import { cn } from "../../lib/cn.js";
import { formatCount } from "../../lib/format.js";
import { statusOptions, sortOptions, type AccountStatus, type SortKey } from "./types.js";

export function AccountFilters({
  query,
  onQueryChange,
  sortKey,
  onSortChange,
  status,
  onStatusChange,
  tabCounts,
}: {
  query: string;
  onQueryChange: (value: string) => void;
  sortKey: SortKey;
  onSortChange: (value: SortKey) => void;
  status: AccountStatus;
  onStatusChange: (value: AccountStatus) => void;
  tabCounts: Record<AccountStatus, number>;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-account-line px-4 py-4 xl:flex-row xl:items-center xl:justify-between xl:px-5">
      <ToggleGroup
        value={[status]}
        onValueChange={(next) => {
          const [selected] = next;
          if (selected) onStatusChange(selected as AccountStatus);
        }}
        size="sm"
        tone="ink"
        variant="segmented"
      >
        {statusOptions.map((item) => (
          <Toggle
            key={item.value}
            value={item.value}
            className={cn(
              "gap-2 px-3 text-md hover:text-account-ink-soft",
              status === item.value ? "text-account-ink" : "text-account-muted",
            )}
          >
            {item.label}
            <span
              className={cn(
                "rounded-pill px-1.5 py-0.5 font-mono text-sm font-semibold text-account-muted-soft",
                status === item.value && "bg-account-filter-track text-account-muted",
              )}
            >
              {formatCount(tabCounts[item.value])}
            </span>
          </Toggle>
        ))}
      </ToggleGroup>

      <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
        <div className="w-full md:w-account-search">
          <Input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="搜索账号名称或 ID"
            leftIcon={<SearchIcon />}
            size="sm"
            inputClassName="rounded-card border-account-line-strong bg-account-card text-base placeholder:text-account-muted-faint focus:border-account-control-hover"
          />
        </div>

        <Select
          value={sortKey}
          options={sortOptions}
          onChange={(value) => onSortChange(value as SortKey)}
          size="sm"
          className="w-full border-account-line-strong bg-account-card text-md text-account-ink-soft hover:border-account-control-hover hover:bg-account-table-head md:w-account-sort"
        />
      </div>
    </div>
  );
}
