import { cn } from "../utils/cn.js";
import type { SwitchClassNameOptions, SwitchSize, SwitchTone } from "./type.js";

const switchSizeClassName: Record<SwitchSize, string> = {
  md: "cb-switch--md",
  sm: "cb-switch--sm",
};

const switchToneClassName: Record<SwitchTone, string> = {
  accent: "cb-switch--tone-accent",
  ink: "cb-switch--tone-ink",
  success: "cb-switch--tone-success",
};

export function switchClassName(options?: SwitchClassNameOptions) {
  const size = options?.size ?? "md";
  const tone = options?.tone ?? "accent";

  return cn("cb-switch", switchSizeClassName[size], switchToneClassName[tone], options?.className);
}
