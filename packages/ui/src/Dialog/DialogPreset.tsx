import { cn } from "../utils/cn.js";
import { Dialog, DialogClose, DialogContent, DialogOverlay, DialogPortal } from "./Dialog.js";
import { DialogAction, DialogBody, DialogFooter } from "./DialogBody.js";
import { DialogDescription, DialogHeader, DialogTitle } from "./DialogHeader.js";
import { DialogMain, DialogSidebar, DialogSplit } from "./DialogSplit.js";
import type {
  ConfirmDialogProps,
  DialogActionVariant,
  DialogFrameProps,
  SplitDialogProps,
} from "./type.js";

function DialogFrameTitle(props: {
  status?: DialogFrameProps["status"];
  title: DialogFrameProps["title"];
}) {
  return (
    <span className="cb-dialog-frame-title">
      <span className="cb-dialog-frame-title-text">{props.title}</span>
      {props.status ? <span className="cb-dialog-frame-status">{props.status}</span> : null}
    </span>
  );
}

export function DialogFrame({
  bodyClassName,
  children,
  closeLabel,
  contentClassName,
  description,
  footer,
  footerClassName,
  footerMeta,
  headerClassName,
  icon,
  layout = "dialog",
  onOpenChange,
  open,
  status,
  title,
  titleMono,
  tone,
}: DialogFrameProps) {
  const hasFooter = Boolean(footer || footerMeta);

  return (
    <Dialog layout={layout} open={open} onOpenChange={onOpenChange} tone={tone}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent className={contentClassName} layout={layout}>
          <DialogClose className="cb-dialog-close--floating" label={closeLabel} />
          <DialogHeader className={headerClassName} icon={icon}>
            <DialogTitle mono={titleMono}>
              <DialogFrameTitle status={status} title={title} />
            </DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          { children ? <DialogBody className={bodyClassName}>{children}</DialogBody> : null }

          {hasFooter ? (
            <DialogFooter
              className={cn(
                footerMeta ? "cb-dialog-footer--between" : "cb-dialog-footer--end",
                !footer && "cb-dialog-footer--start",
                footerClassName,
              )}
            >
              {footerMeta ? <span className="cb-dialog-footer-meta">{footerMeta}</span> : null}
              {footer}
            </DialogFooter>
          ) : null}
        </DialogContent>
      </DialogPortal>
    </Dialog>
  );
}

export function ConfirmDialog({
  cancelText = "取消",
  closeOnConfirm = true,
  confirmDisabled,
  confirmText = "确定",
  confirmVariant,
  onConfirm,
  onOpenChange,
  tone = "accent",
  ...props
}: ConfirmDialogProps) {
  const resolvedConfirmVariant: DialogActionVariant =
    confirmVariant ?? (tone === "danger" ? "danger" : "primary");

  return (
    <DialogFrame
      {...props}
      footer={
        <div className="cb-dialog-footer-actions">
          <DialogAction closeOnClick>{cancelText}</DialogAction>
          <DialogAction
            closeOnClick={closeOnConfirm}
            disabled={confirmDisabled}
            onClick={onConfirm}
            variant={resolvedConfirmVariant}
          >
            {confirmText}
          </DialogAction>
        </div>
      }
      layout="dialog"
      onOpenChange={onOpenChange}
      tone={tone}
    />
  );
}

export function SplitDialog({
  children,
  footer,
  footerMeta,
  sidebar,
  titleMono = true,
  ...props
}: SplitDialogProps) {
  return (
    <DialogFrame
      {...props}
      footer={footer}
      footerMeta={footerMeta}
      layout="split"
      titleMono={titleMono}
    >
      <DialogSplit>
        <DialogMain>{children}</DialogMain>
        <DialogSidebar>{sidebar}</DialogSidebar>
      </DialogSplit>
    </DialogFrame>
  );
}
