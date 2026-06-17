import type { InputHTMLAttributes, ReactNode } from "react";

export type InputSize = "sm" | "md";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  inputClassName?: string;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  size?: InputSize;
};
