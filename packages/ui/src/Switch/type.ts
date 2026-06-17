import type { Switch as BaseSwitchPrimitive } from "@base-ui/react/switch";

export type SwitchSize = "sm" | "md";
export type SwitchTone = "accent" | "ink" | "success";

export type SwitchProps = Omit<BaseSwitchPrimitive.Root.Props, "children" | "className"> & {
  className?: string;
  label?: string;
  size?: SwitchSize;
  tone?: SwitchTone;
};

export type SwitchClassNameOptions = {
  className?: string;
  size?: SwitchSize;
  tone?: SwitchTone;
};
