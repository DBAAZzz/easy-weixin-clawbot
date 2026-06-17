import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { useId, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from "react";
import { XIcon } from "../Icons/index.js";
import { cn } from "../utils/cn.js";
import { DialogContext, useDialogContext } from "./context.js";
import type { DialogLayout, DialogTone } from "./type.js";

export function Dialog(props: {
  layout?: DialogLayout;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  tone?: DialogTone;
  children: ReactNode;
}) {
  const titleId = useId();
  const layout = props.layout ?? "dialog";
  const tone = props.tone ?? "accent";

  return (
    <BaseDialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContext.Provider
        value={{
          layout,
          open: props.open,
          onOpenChange: props.onOpenChange ?? (() => {}),
          tone,
          titleId,
        }}
      >
        {props.children}
      </DialogContext.Provider>
    </BaseDialog.Root>
  );
}

export function DialogPortal(props: { children: ReactNode }) {
  useDialogContext("DialogPortal");

  return <BaseDialog.Portal>{props.children}</BaseDialog.Portal>;
}

export function DialogOverlay({ className, onClick, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { onOpenChange } = useDialogContext("DialogOverlay");

  return (
    <BaseDialog.Backdrop
      className={cn("cb-dialog-overlay", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onOpenChange(false);
        }
      }}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  layout,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  layout?: DialogLayout;
}) {
  const context = useDialogContext("DialogContent");
  const resolvedLayout = layout ?? context.layout;

  return (
    <div className="cb-dialog-viewport">
      <BaseDialog.Popup
        aria-labelledby={context.titleId}
        className={cn("cb-dialog-content", `cb-dialog-content--${resolvedLayout}`, className)}
        {...props}
      >
        <DialogContext.Provider value={{ ...context, layout: resolvedLayout }}>
          {children}
        </DialogContext.Provider>
      </BaseDialog.Popup>
    </div>
  );
}

export function DialogClose({
  label = "关闭对话框",
  className,
  onClick,
  type = "button",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label?: string;
}) {
  const { onOpenChange } = useDialogContext("DialogClose");

  return (
    <BaseDialog.Close
      type={type}
      aria-label={label}
      className={cn("cb-dialog-close", className)}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onOpenChange(false);
        }
      }}
      {...props}
    >
      {children ?? <XIcon />}
    </BaseDialog.Close>
  );
}
