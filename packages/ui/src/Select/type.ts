import type { ReactNode } from "react";

export type SelectSize = "default" | "sm";
export type SelectVariant = "default" | "subtle";

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
  suffix?: ReactNode;
}

export interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  fullWidth?: boolean;
  size?: SelectSize;
  variant?: SelectVariant;
  prefix?: ReactNode;
  renderValue?: (option: SelectOption) => ReactNode;
  renderOption?: (option: SelectOption) => ReactNode;
  showIndicator?: boolean;
}
