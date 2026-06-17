import { cn } from "../utils/cn.js";
import type { ToggleClassNameOptions, ToggleGroupVariant, ToggleSize, ToggleTone } from "./type.js";

const toggleSizeClassName: Record<ToggleSize, string> = {
  md: "cb-toggle--md",
  sm: "cb-toggle--sm",
};

const toggleIconOnlyClassName: Record<ToggleSize, string> = {
  md: "cb-toggle--md cb-toggle--icon-only",
  sm: "cb-toggle--sm cb-toggle--icon-only",
};

const toggleSoftToneClassName: Record<ToggleTone, string> = {
  accent: "cb-toggle--tone-accent",
  ink: "cb-toggle--tone-ink",
  success: "cb-toggle--tone-success",
};

const toggleSolidToneClassName: Record<ToggleTone, string> = {
  accent: "cb-toggle--tone-accent",
  ink: "cb-toggle--tone-ink",
  success: "cb-toggle--tone-success",
};

const toggleLineToneClassName: Record<ToggleTone, string> = {
  accent: "cb-toggle--tone-accent",
  ink: "cb-toggle--tone-ink",
  success: "cb-toggle--tone-success",
};

const toggleGroupedVariantClassName: Record<ToggleGroupVariant, string> = {
  attached: "cb-toggle--group-attached",
  line: "cb-toggle--group-line",
  segmented: "cb-toggle--group-segmented",
};

export function toggleClassName(options?: ToggleClassNameOptions) {
  const size = options?.size ?? "md";
  const tone = options?.tone ?? "accent";
  const variant = options?.variant ?? "soft";
  const groupVariant = options?.groupVariant;

  return cn(
    "cb-toggle",
    options?.fullWidth ? "cb-toggle--full-width" : null,
    options?.iconOnly ? toggleIconOnlyClassName[size] : toggleSizeClassName[size],
    groupVariant ? toggleGroupedVariantClassName[groupVariant] : null,
    groupVariant === "line" ? toggleLineToneClassName[tone] : null,
    !groupVariant && variant === "soft"
      ? cn("cb-toggle--soft", toggleSoftToneClassName[tone])
      : null,
    !groupVariant && variant === "solid"
      ? cn("cb-toggle--solid", toggleSolidToneClassName[tone])
      : null,
    groupVariant === "attached" ? toggleSolidToneClassName[tone] : null,
    options?.className,
  );
}
