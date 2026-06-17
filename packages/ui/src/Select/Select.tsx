import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "../Icons/index.js";
import { cn } from "../utils/cn.js";
import { selectPopupSideOffset, selectTriggerSizeClassName } from "./style.js";
import type { SelectProps } from "./type.js";

export function Select({
  value,
  options,
  onChange,
  placeholder = "请选择",
  className,
  disabled = false,
  size = "default",
}: SelectProps) {
  const selected = options.find((option) => option.value === value);

  return (
    <BaseSelect.Root
      value={value}
      onValueChange={(nextValue) => {
        if (typeof nextValue === "string") {
          onChange(nextValue);
        }
      }}
      items={options}
      disabled={disabled}
      modal={false}
    >
      <BaseSelect.Trigger
        className={cn("cb-select-trigger", selectTriggerSizeClassName[size], className)}
      >
        <span className={cn("cb-truncate", !selected && "cb-select-placeholder")}>
          {selected ? (
            <span className="cb-select-value">
              {selected.icon}
              {selected.label}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <BaseSelect.Icon className="cb-select-icon">
          <ChevronDownIcon />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>

      <BaseSelect.Portal>
        <BaseSelect.Positioner
          alignItemWithTrigger={false}
          sideOffset={selectPopupSideOffset}
          className="cb-z-50"
        >
          <BaseSelect.Popup className="cb-select-popup">
            {options.map((option) => (
              <BaseSelect.Item
                key={option.value}
                value={option.value}
                label={option.label}
                className="cb-select-item"
              >
                {option.icon ? <span className="cb-select-item-icon">{option.icon}</span> : null}
                <BaseSelect.ItemText className="cb-select-item-text">
                  {option.label}
                </BaseSelect.ItemText>
                <BaseSelect.ItemIndicator className="cb-select-indicator">
                  <CheckIcon />
                </BaseSelect.ItemIndicator>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
