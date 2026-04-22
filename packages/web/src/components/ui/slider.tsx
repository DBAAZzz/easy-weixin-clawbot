import { useState, useEffect, useRef, type HTMLAttributes } from "react";
import { cn } from "../../lib/cn.js";

type SliderProps = HTMLAttributes<HTMLDivElement> & {
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
  const [isDragging, setIsDragging] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);

  const percentage = ((value - min) / (max - min)) * 100;

  function handleValueFromPosition(clientX: number) {
    if (!trackRef.current) return;

    const rect = trackRef.current.getBoundingClientRect();
    const rawPosition = (clientX - rect.left) / rect.width;
    const clampedPosition = Math.max(0, Math.min(1, rawPosition));
    const rawValue = min + clampedPosition * (max - min);
    const steppedValue = Math.round(rawValue / step) * step;
    const clampedValue = Math.max(min, Math.min(max, steppedValue));

    onValueChange?.(Number(clampedValue.toFixed(4)));
  }

  function handleMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    setIsDragging(true);
    handleValueFromPosition(event.clientX);
  }

  function handleMouseMove(event: MouseEvent) {
    if (!isDragging) return;
    handleValueFromPosition(event.clientX);
  }

  function handleMouseUp() {
    setIsDragging(false);
  }

  useEffect(() => {
    if (isDragging) {
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };
    }
  }, [isDragging]);

  return (
    <div
      ref={trackRef}
      className={cn(
        "relative flex h-5 w-full cursor-pointer touch-none select-none items-center",
        disabled && "cursor-not-allowed opacity-50",
        className,
      )}
      onMouseDown={handleMouseDown}
      {...props}
    >
      {/* Track */}
      <div className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-pane-74">
        {/* Fill */}
        <div
          className="absolute h-full rounded-full bg-accent transition-all duration-75"
          style={{ width: `${percentage}%` }}
        />
      </div>

      {/* Thumb */}
      <div
        className={cn(
          "absolute h-4 w-4 -translate-x-1/2 rounded-full border border-line bg-white shadow-sm transition-all",
          "hover:border-accent hover:shadow-md",
          isDragging && "scale-110 border-accent shadow-md",
        )}
        style={{ left: `${percentage}%` }}
      />
    </div>
  );
}
