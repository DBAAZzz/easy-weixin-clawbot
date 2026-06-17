import type { ReactNode } from "react";

export type DialogLayout = "dialog" | "panel" | "split";
export type DialogTone = "accent" | "danger" | "neutral" | "success";
export type DialogActionSize = "md" | "sm";
export type DialogActionVariant = "danger" | "ghost" | "ink" | "primary" | "secondary";

export type DialogContextValue = {
  layout: DialogLayout;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tone: DialogTone;
  titleId: string;
};

export type DialogFrameProps = {
  bodyClassName?: string;
  children?: ReactNode;
  closeLabel?: string;
  contentClassName?: string;
  description?: ReactNode;
  footer?: ReactNode;
  footerClassName?: string;
  footerMeta?: ReactNode;
  headerClassName?: string;
  icon?: ReactNode;
  layout?: DialogLayout;
  onOpenChange?: (open: boolean) => void;
  open: boolean;
  status?: ReactNode;
  title: ReactNode;
  titleMono?: boolean;
  tone?: DialogTone;
};

export type ConfirmDialogProps = Omit<
  DialogFrameProps,
  "footer" | "footerMeta" | "layout" | "titleMono"
> & {
  cancelText?: ReactNode;
  closeOnConfirm?: boolean;
  confirmDisabled?: boolean;
  confirmText?: ReactNode;
  confirmVariant?: DialogActionVariant;
  onConfirm?: () => void;
};

export type SplitDialogProps = Omit<DialogFrameProps, "children" | "layout"> & {
  children: ReactNode;
  sidebar: ReactNode;
};
