import { Button as BaseButton } from "@base-ui/react/button";
import { useMemo, useState } from "react";
import { ChevronLeftIcon, ChevronRightIcon } from "../Icons/index.js";
import { cn } from "../utils/cn.js";
import { paginationClassName } from "./style.js";
import type { PaginationProps } from "./type.js";

type PaginationItem = "ellipsis" | number;

export { paginationClassName } from "./style.js";
export type { PaginationClassNameOptions, PaginationProps } from "./type.js";

export function Pagination({
  className,
  defaultPage = 1,
  disabled = false,
  onPageChange,
  page,
  pageSize = 10,
  siblingCount = 1,
  total,
  ...props
}: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const [uncontrolledPage, setUncontrolledPage] = useState(() => clampPage(defaultPage, pageCount));
  const currentPage = clampPage(page ?? uncontrolledPage, pageCount);
  const items = useMemo(
    () => getPaginationItems(currentPage, pageCount, siblingCount),
    [currentPage, pageCount, siblingCount],
  );

  function changePage(nextPage: number) {
    const resolvedPage = clampPage(nextPage, pageCount);

    if (resolvedPage === currentPage || disabled) {
      return;
    }

    setUncontrolledPage(resolvedPage);
    onPageChange?.(resolvedPage);
  }

  return (
    <nav
      aria-label="分页"
      className={paginationClassName({ className })}
      data-disabled={disabled || undefined}
      {...props}
    >
      <PaginationButton
        aria-label="上一页"
        disabled={disabled || currentPage <= 1}
        onClick={() => changePage(currentPage - 1)}
      >
        <ChevronLeftIcon />
      </PaginationButton>

      {items.map((item, index) =>
        item === "ellipsis" ? (
          <span key={`ellipsis-${index}`} className="cb-pagination-ellipsis" aria-hidden="true">
            ...
          </span>
        ) : (
          <PaginationButton
            key={item}
            aria-current={item === currentPage ? "page" : undefined}
            aria-label={`第 ${item} 页`}
            disabled={disabled}
            selected={item === currentPage}
            onClick={() => changePage(item)}
          >
            {item}
          </PaginationButton>
        ),
      )}

      <PaginationButton
        aria-label="下一页"
        disabled={disabled || currentPage >= pageCount}
        onClick={() => changePage(currentPage + 1)}
      >
        <ChevronRightIcon />
      </PaginationButton>
    </nav>
  );
}

function PaginationButton({
  className,
  selected = false,
  ...props
}: React.ComponentPropsWithoutRef<"button"> & { selected?: boolean }) {
  return (
    <BaseButton
      type="button"
      className={cn(
        "cb-pagination-button",
        selected && "cb-pagination-button--selected",
        className,
      )}
      data-selected={selected || undefined}
      {...props}
    />
  );
}

function clampPage(page: number, pageCount: number) {
  if (!Number.isFinite(page)) {
    return 1;
  }

  return Math.min(Math.max(Math.trunc(page), 1), pageCount);
}

function getPaginationItems(page: number, pageCount: number, siblingCount: number) {
  const resolvedSiblingCount = Math.max(0, Math.trunc(siblingCount));
  const totalVisiblePages = resolvedSiblingCount * 2 + 5;

  if (pageCount <= totalVisiblePages) {
    return range(1, pageCount);
  }

  const leftSibling = Math.max(page - resolvedSiblingCount, 2);
  const rightSibling = Math.min(page + resolvedSiblingCount, pageCount - 1);
  const items: PaginationItem[] = [1];

  if (leftSibling > 2) {
    items.push("ellipsis");
  }

  items.push(...range(leftSibling, rightSibling));

  if (rightSibling < pageCount - 1) {
    items.push("ellipsis");
  }

  items.push(pageCount);

  return items;
}

function range(start: number, end: number) {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}
