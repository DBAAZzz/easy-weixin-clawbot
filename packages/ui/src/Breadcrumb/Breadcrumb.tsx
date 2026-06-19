import { ChevronLeftIcon } from "../Icons/index.js";
import { cn } from "../utils/cn.js";
import type { BreadcrumbItem, BreadcrumbProps } from "./type.js";

export type { BreadcrumbItem, BreadcrumbProps } from "./type.js";

export function Breadcrumb({
  backHref,
  backLabel = "返回",
  className,
  items,
  ...props
}: BreadcrumbProps) {
  const visibleItems = items.filter((item) => hasVisibleLabel(item.label));

  return (
    <nav aria-label="面包屑" className={cn("cb-breadcrumb text-xl", className)} {...props}>
      {backHref ? (
        <a className="cb-breadcrumb-back" href={backHref} aria-label={backLabel}>
          <ChevronLeftIcon />
        </a>
      ) : null}

      <ol className="cb-breadcrumb-list">
        {visibleItems.map((item, index) => {
          const current = item.current ?? index === visibleItems.length - 1;

          return (
            <li key={getItemKey(item, index)} className="cb-breadcrumb-item">
              {index > 0 ? (
                <span className="cb-breadcrumb-separator" aria-hidden="true">
                  /
                </span>
              ) : null}
              {item.href && !current ? (
                <a className="cb-breadcrumb-link" href={item.href}>
                  {item.label}
                </a>
              ) : (
                <span
                  className={cn("cb-breadcrumb-link", current && "cb-breadcrumb-link--current")}
                  aria-current={current ? "page" : undefined}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function getItemKey(item: BreadcrumbItem, index: number) {
  if (typeof item.label === "string") {
    return item.label;
  }

  return item.href ?? String(index);
}

function hasVisibleLabel(label: BreadcrumbItem["label"]) {
  if (label === null || label === undefined || label === false) {
    return false;
  }

  if (typeof label === "string") {
    return label.trim().length > 0;
  }

  return true;
}
