import { cn } from "../utils/cn.js";
import type { ButtonClassNameOptions, ButtonSize, ButtonVariant } from "./type.js";

const buttonSizeClassName: Record<ButtonSize, string> = {
  md: "cb-button--md",
  sm: "cb-button--sm",
};

const buttonIconOnlyClassName: Record<ButtonSize, string> = {
  md: "cb-button--md cb-button--icon-only",
  sm: "cb-button--sm cb-button--icon-only",
};

const buttonVariantClassName: Record<ButtonVariant, string> = {
  danger: "cb-button--danger",
  ghost: "cb-button--ghost",
  ink: "cb-button--ink",
  primary: "cb-button--primary",
  secondary: "cb-button--secondary",
};

export function buttonClassName(options?: ButtonClassNameOptions) {
  const size = options?.size ?? "md";
  const variant = options?.variant ?? "primary";

  return cn(
    "cb-button",
    options?.fullWidth ? "cb-button--full-width" : null,
    options?.iconOnly ? buttonIconOnlyClassName[size] : buttonSizeClassName[size],
    buttonVariantClassName[variant],
    options?.className,
  );
}
