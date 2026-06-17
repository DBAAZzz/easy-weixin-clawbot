import { createContext, useContext } from "react";
import type { ToggleGroupVariant, ToggleSize, ToggleTone } from "./type.js";

export type ToggleGroupContextValue = {
  fullWidth: boolean;
  size: ToggleSize;
  tone: ToggleTone;
  variant: ToggleGroupVariant;
};

export const ToggleGroupContext = createContext<ToggleGroupContextValue | null>(null);

export function useToggleGroupContext() {
  return useContext(ToggleGroupContext);
}
