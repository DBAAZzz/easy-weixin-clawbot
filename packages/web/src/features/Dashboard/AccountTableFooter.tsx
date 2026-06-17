import { Pagination } from "@clawbot/ui";
import { formatCount } from "../../lib/format.js";
import { PAGE_SIZE } from "./types.js";

export function AccountTableFooter({
  firstVisible,
  lastVisible,
  onPageChange,
  page,
  total,
}: {
  firstVisible: number;
  lastVisible: number;
  onPageChange: (page: number) => void;
  page: number;
  total: number;
}) {
  return (
    <div className="flex flex-col gap-3 bg-account-table-head px-5 py-3.5 md:flex-row md:items-center md:justify-between md:px-6">
      <span className="text-sm text-account-muted-soft">
        共{" "}
        <span className="font-mono font-semibold text-account-ink-soft">{formatCount(total)}</span>{" "}
        个账号 · 显示 {formatCount(firstVisible)}–{formatCount(lastVisible)}
      </span>
      <Pagination page={page} total={total} pageSize={PAGE_SIZE} onPageChange={onPageChange} />
    </div>
  );
}
