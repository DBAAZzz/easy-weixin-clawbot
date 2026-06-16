import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "danger" | "ghost" | "ink" | "primary" | "secondary";
export type ButtonSize = "md" | "sm";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  fullWidth?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

export type ButtonClassNameOptions = {
  className?: string;
  fullWidth?: boolean;
  iconOnly?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};
