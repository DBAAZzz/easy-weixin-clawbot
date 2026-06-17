import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../utils/cn.js";
import { useDialogContext } from "./context.js";
import { sectionPadding, splitSectionPadding, toneIcon } from "./style.js";
import type { DialogLayout } from "./type.js";

export function DialogHeader({
  className,
  icon,
  layout,
  status,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  icon?: ReactNode;
  layout?: DialogLayout;
  status?: ReactNode;
}) {
  const context = useDialogContext("DialogHeader");
  const resolvedLayout = layout ?? context.layout;

  return (
    <div
      className={cn(
        "cb-dialog-header",
        sectionPadding,
        resolvedLayout === "split" && cn("cb-dialog-header--split", splitSectionPadding),
        resolvedLayout !== "dialog" && "cb-dialog-header--with-border",
        className,
      )}
      {...props}
    >
      {icon ? <span className={cn("cb-dialog-icon", toneIcon[context.tone])}>{icon}</span> : null}
      <div className="cb-min-w-0 cb-flex-1">{props.children}</div>
      {status ? <div className="cb-shrink-0 cb-pt-1">{status}</div> : null}
    </div>
  );
}

export function DialogTitle({
  className,
  mono,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & {
  mono?: boolean;
}) {
  const { layout, titleId } = useDialogContext("DialogTitle");

  return (
    <BaseDialog.Title
      id={titleId}
      className={cn(
        "cb-dialog-title",
        layout === "split" ? "cb-dialog-title--split" : "cb-dialog-title--dialog",
        mono && "cb-font-mono",
        className,
      )}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  useDialogContext("DialogDescription");

  return <BaseDialog.Description className={cn("cb-dialog-description", className)} {...props} />;
}
