import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "../Icons/index.js";
import { cn } from "../utils/cn.js";
import {
  selectPopupSideOffset,
  selectTriggerSizeClassName,
  selectTriggerVariantClassName,
} from "./style.js";
import type { SelectOption, SelectProps } from "./type.js";

function renderDefaultValue(option: SelectOption) {
  return (
    <span className="cb-select-value">
      {option.icon}
      <span className="cb-select-value-label">{option.label}</span>
      {option.suffix ? <span className="cb-select-value-suffix">{option.suffix}</span> : null}
    </span>
  );
}

function renderDefaultOption(option: SelectOption) {
  return (
    <>
      {option.icon ? <span className="cb-select-item-icon">{option.icon}</span> : null}
      <BaseSelect.ItemText className="cb-select-item-text">{option.label}</BaseSelect.ItemText>
      {option.suffix ? <span className="cb-select-item-suffix">{option.suffix}</span> : null}
    </>
  );
}

export function Select({
  value,
  options,
  onChange,
  placeholder = "请选择",
  className,
  disabled = false,
  fullWidth = true,
  size = "default",
  variant = "default",
  prefix,
  renderValue,
  renderOption,
  showIndicator = true,
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
        className={cn(
          "cb-select-trigger",
          fullWidth ? "cb-select-trigger--full-width" : "cb-select-trigger--fit-content",
          selectTriggerSizeClassName[size],
          selectTriggerVariantClassName[variant],
          className,
        )}
      >
        <span className="cb-select-trigger-content">
          {prefix ? <span className="cb-select-prefix">{prefix}</span> : null}
          <span className={cn("cb-select-trigger-text", !selected && "cb-select-placeholder")}>
            {selected ? (renderValue?.(selected) ?? renderDefaultValue(selected)) : placeholder}
          </span>
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
                {renderOption ? (
                  <BaseSelect.ItemText className="cb-select-item-custom">
                    {renderOption(option)}
                  </BaseSelect.ItemText>
                ) : (
                  renderDefaultOption(option)
                )}
                {showIndicator ? (
                  <BaseSelect.ItemIndicator className="cb-select-indicator">
                    <CheckIcon />
                  </BaseSelect.ItemIndicator>
                ) : null}
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
