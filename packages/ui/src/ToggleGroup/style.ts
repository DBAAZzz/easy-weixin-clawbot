import { cn } from "../utils/cn.js";
import type { ToggleGroupClassNameOptions, ToggleGroupVariant, ToggleSize } from "./type.js";

const toggleGroupPaddingClassName: Record<ToggleSize, string> = {
  md: "cb-toggle-group--padded-md",
  sm: "cb-toggle-group--padded-sm",
};

const toggleGroupSizeClassName: Record<ToggleSize, string> = {
  md: "cb-toggle-group--md",
  sm: "cb-toggle-group--sm",
};

const toggleGroupVariantClassName: Record<ToggleGroupVariant, string> = {
  attached: "cb-toggle-group--attached",
  line: "cb-toggle-group--line",
  segmented: "cb-toggle-group--segmented",
};

export function toggleGroupClassName(options?: ToggleGroupClassNameOptions) {
  const orientation = options?.orientation ?? "horizontal";
  const size = options?.size ?? "md";
  const variant = options?.variant ?? "segmented";

  return cn(
    "cb-toggle-group",
    toggleGroupSizeClassName[size],
    options?.fullWidth ? "cb-toggle-group--full-width" : null,
    orientation === "vertical" ? "cb-toggle-group--vertical" : "cb-toggle-group--horizontal",
    variant !== "line" ? toggleGroupPaddingClassName[size] : null,
    toggleGroupVariantClassName[variant],
    options?.className,
  );
}
