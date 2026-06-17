import type { ButtonHTMLAttributes, HTMLAttributes } from "react";
import { Button } from "../Button/index.js";
import { cn } from "../utils/cn.js";
import { useDialogContext } from "./context.js";
import { sectionPadding, splitFooterPadding } from "./style.js";
import type { DialogActionVariant, DialogLayout } from "./type.js";

export function DialogBody({
  className,
  layout,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  layout?: DialogLayout;
}) {
  const context = useDialogContext("DialogBody");
  const resolvedLayout = layout ?? context.layout;

  return (
    <div
      className={cn(
        "cb-dialog-body",
        sectionPadding,
        resolvedLayout === "panel" && "cb-dialog-body--panel",
        resolvedLayout === "split" && "cb-dialog-body--split",
        className,
      )}
      {...props}
    />
  );
}

export function DialogFooter({
  className,
  layout,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  layout?: DialogLayout;
}) {
  const context = useDialogContext("DialogFooter");
  const resolvedLayout = layout ?? context.layout;

  return (
    <div
      className={cn(
        "cb-dialog-footer",
        sectionPadding,
        resolvedLayout === "split" && splitFooterPadding,
        resolvedLayout !== "dialog" && "cb-dialog-footer--framed",
        className,
      )}
      {...props}
    />
  );
}

export function DialogAction({
  children,
  closeOnClick,
  onClick,
  variant = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  closeOnClick?: boolean;
  variant?: DialogActionVariant;
}) {
  const context = useDialogContext("DialogAction");

  return (
    <Button
      size="sm"
      variant={variant}
      onClick={(event) => {
        onClick?.(event);
        if (closeOnClick && !event.defaultPrevented) {
          context.onOpenChange(false);
        }
      }}
      {...props}
    >
      {children}
    </Button>
  );
}
