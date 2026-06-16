import type { Toggle as BaseTogglePrimitive } from "@base-ui/react/toggle";

export type ToggleSize = "md" | "sm";
export type ToggleTone = "accent" | "ink" | "success";
export type ToggleVariant = "soft" | "solid";
export type ToggleGroupVariant = "attached" | "line" | "segmented";

export type ToggleProps<Value extends string = string> = Omit<
  BaseTogglePrimitive.Props<Value>,
  "className"
> & {
  className?: string;
  fullWidth?: boolean;
  size?: ToggleSize;
  tone?: ToggleTone;
  variant?: ToggleVariant;
};

export type ToggleClassNameOptions = {
  className?: string;
  fullWidth?: boolean;
  groupVariant?: ToggleGroupVariant;
  iconOnly?: boolean;
  size?: ToggleSize;
  tone?: ToggleTone;
  variant?: ToggleVariant;
};
