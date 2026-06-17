import type { HTMLAttributes } from "react";

export type PaginationProps = Omit<HTMLAttributes<HTMLElement>, "onChange"> & {
  defaultPage?: number;
  disabled?: boolean;
  onPageChange?: (page: number) => void;
  page?: number;
  pageSize?: number;
  siblingCount?: number;
  total: number;
};

export type PaginationClassNameOptions = {
  className?: string;
};
