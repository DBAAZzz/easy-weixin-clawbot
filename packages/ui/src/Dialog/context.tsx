import { createContext, useContext } from "react";
import type { DialogContextValue } from "./type.js";

export const DialogContext = createContext<DialogContextValue | null>(null);

export function useDialogContext(componentName: string) {
  const context = useContext(DialogContext);

  if (!context) {
    throw new Error(`${componentName} must be used within Dialog`);
  }

  return context;
}
