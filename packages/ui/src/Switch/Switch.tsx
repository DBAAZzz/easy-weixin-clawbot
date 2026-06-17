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
  ...props
}: SwitchProps) {
  return (
    <BaseSwitch.Root
      aria-label={ariaLabel ?? label}
      className={switchClassName({ className, size, tone })}
      {...props}
    >
      <BaseSwitch.Thumb className="cb-switch-thumb" />
    </BaseSwitch.Root>
  );
}
