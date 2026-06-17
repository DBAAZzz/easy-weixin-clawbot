import { Children, isValidElement } from "react";
import { Toggle as BaseToggle } from "@base-ui/react/toggle";
import { useToggleGroupContext } from "../ToggleGroup/context.js";
import { toggleClassName } from "./style.js";
import type { ToggleProps } from "./type.js";

export { toggleClassName } from "./style.js";
export type {
  ToggleClassNameOptions,
  ToggleGroupVariant,
  ToggleProps,
  ToggleSize,
  ToggleTone,
  ToggleVariant,
} from "./type.js";

export function Toggle<Value extends string = string>({
  className,
  children,
  fullWidth,
  size,
  tone,
  type = "button",
  variant,
  ...props
}: ToggleProps<Value>) {
  const groupContext = useToggleGroupContext();
  const childrenArray = Children.toArray(children).filter(
    (child) => child !== null && child !== undefined,
  );
  const iconOnly = childrenArray.length === 1 && isValidElement(childrenArray[0]);
  const resolvedFullWidth = fullWidth ?? groupContext?.fullWidth ?? false;
  const resolvedSize = size ?? groupContext?.size ?? "md";
  const resolvedTone = tone ?? groupContext?.tone ?? "accent";
  const resolvedVariant = variant ?? "soft";

  return (
    <BaseToggle
      type={type}
      className={toggleClassName({
        className,
        fullWidth: resolvedFullWidth,
        groupVariant: groupContext?.variant,
        iconOnly,
        size: resolvedSize,
        tone: resolvedTone,
        variant: resolvedVariant,
      })}
      {...props}
    >
      {children}
    </BaseToggle>
  );
}
