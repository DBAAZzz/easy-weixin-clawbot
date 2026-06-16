import { ToggleGroup as BaseToggleGroup } from "@base-ui/react/toggle-group";
import { ToggleGroupContext } from "./context.js";
import { toggleGroupClassName } from "./style.js";
import type { ToggleGroupProps } from "./type.js";

export { toggleGroupClassName } from "./style.js";
export type { ToggleGroupClassNameOptions, ToggleGroupProps } from "./type.js";

export function ToggleGroup<Value extends string = string>({
  children,
  className,
  fullWidth = false,
  orientation = "horizontal",
  size = "md",
  tone = "accent",
  variant = "segmented",
  ...props
}: ToggleGroupProps<Value>) {
  return (
    <ToggleGroupContext.Provider value={{ fullWidth, size, tone, variant }}>
      <BaseToggleGroup
        orientation={orientation}
        className={toggleGroupClassName({ className, fullWidth, orientation, size, variant })}
        {...props}
      >
        {children}
      </BaseToggleGroup>
    </ToggleGroupContext.Provider>
  );
}
