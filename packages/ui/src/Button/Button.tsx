import { Children, isValidElement } from "react";
import { Button as BaseButton } from "@base-ui/react/button";
import { buttonClassName } from "./style.js";
import type { ButtonProps } from "./type.js";

export { buttonClassName } from "./style.js";
export type { ButtonClassNameOptions, ButtonProps, ButtonSize, ButtonVariant } from "./type.js";

export function Button({
  className,
  children,
  fullWidth,
  variant = "primary",
  size = "md",
  type = "button",
  ...props
}: ButtonProps) {
  const childrenArray = Children.toArray(children).filter(
    (child) => child !== null && child !== undefined,
  );
  const iconOnly = childrenArray.length === 1 && isValidElement(childrenArray[0]);

  return (
    <BaseButton
      type={type}
      className={buttonClassName({ className, fullWidth, iconOnly, variant, size })}
      {...props}
    >
      {children}
    </BaseButton>
  );
}
