import React from "react";
import { Toaster, toast } from "sonner";
import { buttonClassName } from "../Button/index.js";

const toasterClassNames = {
  toast: "cb-toaster-toast",
  title: "cb-toaster-title",
  description: "cb-toaster-description",
  closeButton: "cb-toaster-close-button",
  actionButton: buttonClassName({ size: "sm" }),
  cancelButton: buttonClassName({ size: "sm", variant: "secondary" }),
  success: "cb-toaster-success",
  error: "cb-toaster-error",
  info: "cb-toaster-info",
  warning: "cb-toaster-warning",
  loading: "cb-toaster-loading",
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
