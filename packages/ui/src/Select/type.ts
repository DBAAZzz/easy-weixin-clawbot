import type { ReactNode } from "react";

export type SelectSize = "default" | "sm";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: SelectSize;
}
