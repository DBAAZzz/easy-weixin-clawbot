import type { ToggleGroup as BaseToggleGroupPrimitive } from "@base-ui/react/toggle-group";
import type { ToggleGroupVariant, ToggleSize, ToggleTone } from "../Toggle/index.js";

export type { ToggleGroupVariant, ToggleSize, ToggleTone };

export type ToggleGroupProps<Value extends string = string> = Omit<
  BaseToggleGroupPrimitive.Props<Value>,
  "className"
> & {
  className?: string;
  fullWidth?: boolean;
  size?: ToggleSize;
  tone?: ToggleTone;
  variant?: ToggleGroupVariant;
};

export type ToggleGroupClassNameOptions = {
  className?: string;
  fullWidth?: boolean;
  orientation?: "horizontal" | "vertical";
  size?: ToggleSize;
  variant?: ToggleGroupVariant;
};
