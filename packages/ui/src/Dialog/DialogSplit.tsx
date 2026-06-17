import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn.js";
import { splitSectionPadding, splitSidebarPadding } from "./style.js";

export function DialogSplit({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
}) {
  return <div className={cn("cb-dialog-split", className)} {...props} />;
}

export function DialogMain({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("cb-dialog-main", splitSectionPadding, className)} {...props} />;
}

export function DialogSidebar({ className, ...props }: HTMLAttributes<HTMLElement>) {
  return <aside className={cn("cb-dialog-sidebar", splitSidebarPadding, className)} {...props} />;
}

export function DialogSidebarSection({
  children,
  className,
  title,
  ...props
}: HTMLAttributes<HTMLElement> & {
  title?: ReactNode;
}) {
  const sectionClassName = cn("cb-dialog-sidebar-section", className);

  return (
    <section className={sectionClassName} {...props}>
      {title ? <h3 className="cb-dialog-sidebar-section-title">{title}</h3> : null}
      <div className="cb-dialog-sidebar-section-content">{children}</div>
    </section>
  );
}
