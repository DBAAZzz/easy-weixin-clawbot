import {
  createContext,
  useContext,
  useEffect,
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn.js";
import { XIcon } from "./icons.js";

type DialogContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titleId: string;
};

const DialogContext = createContext<DialogContextValue | null>(null);

function useDialogContext(componentName: string) {
  const context = useContext(DialogContext);

  if (!context) {
    throw new Error(`${componentName} must be used within Dialog`);
  }

  return context;
}

export function Dialog(props: {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
}) {
  const titleId = useId();

  return (
    <DialogContext.Provider
      value={{
        open: props.open,
        onOpenChange: props.onOpenChange ?? (() => {}),
        titleId,
      }}
    >
      {props.children}
    </DialogContext.Provider>
  );
}

export function DialogPortal(props: { children: ReactNode }) {
  const { open, onOpenChange } = useDialogContext("DialogPortal");

  useEffect(() => {
    if (!open || typeof document === "undefined") return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onOpenChange(false);
      }
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  if (typeof document === "undefined") {
    return <>{props.children}</>;
  }

  return createPortal(props.children, document.body);
}

export function DialogOverlay({ className, onClick, ...props }: HTMLAttributes<HTMLDivElement>) {
  const { onOpenChange } = useDialogContext("DialogOverlay");

  return (
    <div
      aria-hidden="true"
      className={cn("fixed inset-0 z-50 bg-overlay backdrop-blur-[8px]", className)}
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
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
}) {
  const { titleId } = useDialogContext("DialogContent");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 md:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-dialog border border-modal-border bg-card-hover shadow-modal",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </div>
  );
}

export function DialogHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-b border-line px-5 py-4 md:px-6", className)} {...props} />;
}

export function DialogBody({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex-1 overflow-y-auto px-5 py-5 md:px-6", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("border-t border-line px-5 py-4 md:px-6", className)} {...props} />;
}

export function DialogTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  const { titleId } = useDialogContext("DialogTitle");

  return (
    <h2
      id={titleId}
      className={cn("text-5xl font-semibold tracking-heading text-ink", className)}
      {...props}
    />
  );
}

export function DialogDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-md leading-6 text-muted-strong", className)} {...props} />;
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
    <button
      type={type}
      aria-label={label}
      className={cn(
        "inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-line bg-white/80 text-muted-strong transition hover:border-line-strong hover:text-ink",
        className,
      )}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) {
          onOpenChange(false);
        }
      }}
      {...props}
    >
      {children ?? <XIcon className="size-4" />}
    </button>
  );
}
