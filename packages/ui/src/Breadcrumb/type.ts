import type { HTMLAttributes, ReactNode } from "react";

export type BreadcrumbItem = {
  current?: boolean;
  href?: string;
  label: ReactNode;
};

export type BreadcrumbProps = HTMLAttributes<HTMLElement> & {
  backHref?: string;
  backLabel?: string;
  items: BreadcrumbItem[];
};
