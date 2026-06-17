import { Input as BaseInput } from "@base-ui/react/input";
import { cn } from "../utils/cn.js";
import type { InputProps } from "./type.js";

export type { InputProps, InputSize } from "./type.js";

export function Input({
  className,
  disabled,
  inputClassName,
  leftIcon,
  rightIcon,
  size = "md",
  ...props
}: InputProps) {
  const hasLeftIcon = Boolean(leftIcon);
  const hasRightIcon = Boolean(rightIcon);

  return (
    <span
      className={cn(
        "cb-input-wrapper",
        size === "sm" ? "cb-input-wrapper--sm" : "cb-input-wrapper--md",
        className,
      )}
      data-disabled={disabled ? "" : undefined}
    >
      {hasLeftIcon ? (
        <span className="cb-input-icon cb-input-icon--left" aria-hidden="true">
          {leftIcon}
        </span>
      ) : null}
      <BaseInput
        className={cn(
          "cb-input",
          size === "sm" ? "cb-input--sm" : "cb-input--md",
          hasLeftIcon ? "cb-input--with-left-icon" : null,
          hasRightIcon ? "cb-input--with-right-icon" : null,
          inputClassName,
        )}
        disabled={disabled}
        {...props}
      />
      {hasRightIcon ? (
        <span className="cb-input-icon cb-input-icon--right" aria-hidden="true">
          {rightIcon}
        </span>
      ) : null}
    </span>
  );
}
