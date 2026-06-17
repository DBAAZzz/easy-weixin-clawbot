export type AccountStatus = "all" | "active" | "deprecated";
export type SortKey = "created" | "conversations" | "name";

export const PAGE_SIZE = 10;

export const statusOptions: Array<{ value: AccountStatus; label: string }> = [
  { value: "all", label: "全部" },
  { value: "active", label: "活跃" },
  { value: "deprecated", label: "已废弃" },
];

export const sortOptions: Array<{ value: SortKey; label: string }> = [
  { value: "created", label: "最新创建" },
  { value: "conversations", label: "会话最多" },
  { value: "name", label: "名称排序" },
];

export type AccountStat = {
  label: string;
  value: string;
  meta: string;
  dotClassName: string;
  valueClassName: string;
};
