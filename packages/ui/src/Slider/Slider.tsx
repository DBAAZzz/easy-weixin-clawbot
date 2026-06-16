import { Slider as BaseSlider } from "@base-ui/react/slider";
import type { HTMLAttributes } from "react";
import { cn } from "../utils/cn.js";

type SliderProps = Omit<HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange"> & {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onValueChange?: (value: number) => void;
  disabled?: boolean;
};

export function Slider({
  value,
  min = 0,
  max = 1,
  step = 0.01,
  onValueChange,
  disabled = false,
  className,
  ...props
}: SliderProps) {
  return (
    <BaseSlider.Root
      value={value}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
      onValueChange={(nextValue) => onValueChange?.(Number(nextValue.toFixed(4)))}
      className={cn("cb-slider", disabled && "cb-slider--disabled", className)}
      {...props}
    >
      <BaseSlider.Control className="cb-slider-control">
        <BaseSlider.Track className="cb-slider-track">
          <BaseSlider.Indicator className="cb-slider-indicator" />
        </BaseSlider.Track>
        <BaseSlider.Thumb className="cb-slider-thumb" />
      </BaseSlider.Control>
    </BaseSlider.Root>
  );
}
