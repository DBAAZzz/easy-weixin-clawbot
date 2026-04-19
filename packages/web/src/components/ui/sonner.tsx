import React from "react";
import { Toaster, toast } from "sonner";
import { buttonClassName } from "./button.js";

const toasterClassNames = {
  toast: "rounded-panel border border-line-strong bg-panel-strong text-ink shadow-popover",
  title: "text-md font-medium tracking-body text-ink",
  description: "text-base leading-5 text-muted-strong",
  closeButton:
    "border-line-strong bg-white/80 text-muted-strong shadow-btn-soft hover:bg-hover-bg hover:text-ink",
  actionButton: buttonClassName({ size: "sm" }),
  cancelButton: buttonClassName({ size: "sm", variant: "outline" }),
  success: "border-notice-success-border bg-notice-success-bg text-accent-strong",
  error: "border-notice-error-border bg-notice-error-bg text-red-700",
  info: "border-line bg-detail-bg text-ink-soft",
  warning: "border-slate-border-strong bg-detail-bg text-ink-soft",
  loading: "border-line bg-card-hover text-ink-soft",
} as const;

export function AppToaster() {
  return (
    <Toaster
      closeButton
      theme="light"
      position="top-right"
      containerAriaLabel="Clawbot 通知"
      offset={16}
      mobileOffset={16}
      toastOptions={{
        duration: 4000,
        classNames: toasterClassNames,
      }}
    />
  );
}

export { toast };
