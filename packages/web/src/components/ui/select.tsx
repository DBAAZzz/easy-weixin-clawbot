import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn.js";
import { ChevronDownIcon, CheckIcon } from "./icons.js";

const VIEWPORT_PADDING = 12;
const DROPDOWN_GAP = 6;
const MAX_DROPDOWN_HEIGHT = 240;

export interface SelectOption {
  value: string;
  label: string;
  icon?: ReactNode;
}

interface SelectProps {
  value: string;
  options: SelectOption[];
  onChange(value: string): void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  size?: "default" | "sm";
}

export function Select({
  value,
  options,
  onChange,
  placeholder = "请选择",
  className,
  disabled = false,
  size = "default",
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [dropdownStyle, setDropdownStyle] = useState<React.CSSProperties>({});
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = options.find((o) => o.value === value);

  const updateDropdownPosition = useCallback(() => {
    if (!triggerRef.current) {
      return;
    }
    const rect = triggerRef.current.getBoundingClientRect();
    const availableBelow = window.innerHeight - rect.bottom - VIEWPORT_PADDING;
    const availableAbove = rect.top - VIEWPORT_PADDING;
    const openUpward = availableBelow < 160 && availableAbove > availableBelow;
    const availableHeight = openUpward
      ? availableAbove - DROPDOWN_GAP
      : availableBelow - DROPDOWN_GAP;
    const width = Math.min(rect.width, window.innerWidth - VIEWPORT_PADDING * 2);
    const left = Math.min(
      Math.max(VIEWPORT_PADDING, rect.left),
      window.innerWidth - VIEWPORT_PADDING - width,
    );

    setDropdownStyle({
      position: "fixed",
      left,
      width,
      maxHeight: Math.max(96, Math.min(MAX_DROPDOWN_HEIGHT, availableHeight)),
      ...(openUpward
        ? {
            bottom: window.innerHeight - rect.top + DROPDOWN_GAP,
          }
        : {
            top: rect.bottom + DROPDOWN_GAP,
          }),
    });
  }, []);

  // Position the dropdown relative to the trigger
  useLayoutEffect(() => {
    if (!open) return;

    updateDropdownPosition();
  }, [open, updateDropdownPosition]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        listRef.current &&
        !listRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Keep the dropdown anchored while the page or parent containers move.
  useEffect(() => {
    if (!open) return;
    function handleViewportChange() {
      updateDropdownPosition();
    }
    window.addEventListener("scroll", handleViewportChange, true);
    window.addEventListener("resize", handleViewportChange);
    return () => {
      window.removeEventListener("scroll", handleViewportChange, true);
      window.removeEventListener("resize", handleViewportChange);
    };
  }, [open, updateDropdownPosition]);

  // Reset highlight when opening
  useEffect(() => {
    if (open) {
      const idx = options.findIndex((o) => o.value === value);
      setHighlightIndex(idx >= 0 ? idx : 0);
    }
  }, [open, options, value]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || highlightIndex < 0) return;
    const list = listRef.current;
    if (!list) return;
    const item = list.children[highlightIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, open]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled) return;

      if (!open) {
        if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
          e.preventDefault();
          setOpen(true);
        }
        return;
      }

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setHighlightIndex((i) => (i + 1) % options.length);
          break;
        case "ArrowUp":
          e.preventDefault();
          setHighlightIndex((i) => (i - 1 + options.length) % options.length);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          if (highlightIndex >= 0 && highlightIndex < options.length) {
            onChange(options[highlightIndex].value);
            setOpen(false);
          }
          break;
        case "Escape":
          e.preventDefault();
          setOpen(false);
          break;
      }
    },
    [open, disabled, highlightIndex, options, onChange],
  );

  const dropdown = open
    ? createPortal(
        <ul
          ref={listRef}
          role="listbox"
          style={dropdownStyle}
          className={cn(
            "z-[9999] overflow-y-auto overscroll-contain rounded-panel border border-line-strong bg-white p-1 shadow-popover",
            "animate-[selectIn_0.15s_ease-out]",
          )}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value;
            const isHighlighted = index === highlightIndex;

            return (
              <li
                key={option.value}
                role="option"
                aria-selected={isSelected}
                onMouseEnter={() => setHighlightIndex(index)}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-base transition-colors duration-100",
                  isHighlighted && "bg-accent-subtle",
                  isSelected ? "font-medium text-accent-strong" : "text-ink",
                )}
              >
                {option.icon ? (
                  <span className="flex size-4 shrink-0 items-center justify-center">
                    {option.icon}
                  </span>
                ) : null}
                <span className="flex-1 truncate">{option.label}</span>
                {isSelected ? <CheckIcon className="size-3.5 shrink-0 text-accent-strong" /> : null}
              </li>
            );
          })}
        </ul>,
        document.body,
      )
    : null;

  return (
    <div ref={containerRef} className={cn("relative", className)} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        disabled={disabled}
        onClick={() => !disabled && setOpen((o) => !o)}
        className={cn(
          "inline-flex w-full items-center justify-between gap-2 rounded-card border border-line-strong bg-panel-strong text-base text-ink outline-none transition duration-200",
          "hover:border-accent hover:bg-white",
          "focus-visible:border-accent focus-visible:shadow-focus-accent",
          "disabled:pointer-events-none disabled:opacity-50",
          size === "default" && "h-10 px-3.5",
          size === "sm" && "h-9 px-3",
        )}
      >
        <span className={cn("truncate", !selected && "text-muted")}>
          {selected ? (
            <span className="flex items-center gap-2">
              {selected.icon}
              {selected.label}
            </span>
          ) : (
            placeholder
          )}
        </span>
        <ChevronDownIcon
          className={cn(
            "size-4 shrink-0 text-muted transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {dropdown}
    </div>
  );
}
