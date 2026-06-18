import type { ReactNode } from "react";
import { Badge, Card, GitBranchIcon, Input, RobotIcon, SearchIcon, Select } from "@clawbot/ui";

interface Option {
  value: string;
  label: string;
  suffix?: ReactNode;
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
}) {
  const disabled = props.accountOptions.length === 0;

  return (
    <Card className="flex flex-col gap-3 border border-account-line bg-account-card p-3 shadow-account-card md:flex-row md:items-center">
      <Select
        size="sm"
        variant="subtle"
        value={props.selectedAccountId}
        options={props.accountOptions}
        onChange={props.onAccountChange}
        placeholder="选择账号"
        disabled={disabled}
        fullWidth={false}
        showIndicator={false}
        prefix={
          <>
            <RobotIcon />
            <span>账号</span>
          </>
        }
        renderOption={(option) => option.label}
      />

      <Select
        size="sm"
        variant="subtle"
        value={props.selectedBranch}
        options={props.branchOptions}
        onChange={props.onBranchChange}
        placeholder="选择分支"
        disabled={disabled}
        fullWidth={false}
        showIndicator={false}
        prefix={
          <>
            <GitBranchIcon />
            <span>分支</span>
          </>
        }
        renderOption={(option) => option.label}
      />

      <Input
        value={props.query}
        disabled={disabled}
        onChange={(event) => props.onQueryChange(event.target.value)}
        placeholder="搜索节点：姓名、偏好、决策、前缀..."
        size="sm"
        leftIcon={<SearchIcon />}
        className="min-w-0 flex-1"
      />
    </Card>
  );
}

export function MemoryGlobalBadge() {
  return (
    <Badge bordered={false} showDot={false} size="sm" tone="online">
      全局
    </Badge>
  );
}
