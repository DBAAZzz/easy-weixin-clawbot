import type { SelectSize, SelectVariant } from "./type.js";

export const selectTriggerSizeClassName: Record<SelectSize, string> = {
  default: "cb-select-trigger-size--default",
  sm: "cb-select-trigger-size--sm",
};

export const selectTriggerVariantClassName: Record<SelectVariant, string> = {
  default: "cb-select-trigger-variant--default",
  subtle: "cb-select-trigger-variant--subtle",
};

export const selectPopupSideOffset = 8;
