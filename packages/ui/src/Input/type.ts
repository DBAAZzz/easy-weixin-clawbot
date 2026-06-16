import type { InputHTMLAttributes, ReactNode } from "react";

export type InputSize = "sm" | "md";

export type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "size"> & {
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  size?: InputSize;
};
