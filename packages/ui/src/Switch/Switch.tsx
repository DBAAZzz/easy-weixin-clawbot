import { Switch as BaseSwitch } from "@base-ui/react/switch";
import { switchClassName } from "./style.js";
import type { SwitchProps } from "./type.js";

export { switchClassName } from "./style.js";
export type { SwitchClassNameOptions, SwitchProps, SwitchSize, SwitchTone } from "./type.js";

export function Switch({
  "aria-label": ariaLabel,
  className,
  label,
  size = "md",
  tone = "accent",
  onClick,
  onMouseDown,
  onPointerDown,
  ...props
}: SwitchProps) {
  return (
    <span
      className="cb-switch-container"
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event as any);
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        onMouseDown?.(event as any);
      }}
      onPointerDown={(event) => {
        event.stopPropagation();
        onPointerDown?.(event as any);
      }}
    >
      <BaseSwitch.Root
        aria-label={ariaLabel ?? label}
        className={switchClassName({ className, size, tone })}
        {...props}
      >
        <BaseSwitch.Thumb className="cb-switch-thumb" />
      </BaseSwitch.Root>
    </span>
  );
}
