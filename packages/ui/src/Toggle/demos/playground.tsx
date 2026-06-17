import { ActivityIcon, CheckIcon, GridIcon, PulseIcon, Toggle } from "@clawbot/ui";
import { StoryBook, useControls, useSetControl } from "../../Playground/index.js";
import type { ToggleSize, ToggleTone, ToggleVariant } from "../index.js";

const icons = {
  activity: <ActivityIcon />,
  check: <CheckIcon />,
  grid: <GridIcon />,
  none: null,
  pulse: <PulseIcon />,
};

export default function TogglePlayground() {
  const controls = useControls({
    variant: {
      options: [
        { label: "soft", value: "soft" },
        { label: "solid", value: "solid" },
      ],
      value: "soft",
    },
    tone: {
      options: [
        { label: "accent", value: "accent" },
        { label: "success", value: "success" },
        { label: "ink", value: "ink" },
      ],
      value: "accent",
    },
    size: {
      options: [
        { label: "small", value: "sm" },
        { label: "medium", value: "md" },
      ],
      value: "md",
    },
    icon: {
      options: ["pulse", "activity", "check", "grid", "none"],
      value: "pulse",
    },
    pressed: true,
    disabled: false,
    fullWidth: false,
    iconOnly: false,
    children: "收藏",
  });
  const setControl = useSetControl();
  const icon = icons[controls.icon as keyof typeof icons];

  return (
    <StoryBook>
      <div className="ui-demo-toggle">
        <Toggle
          disabled={controls.disabled}
          fullWidth={controls.fullWidth}
          onPressedChange={(nextPressed) => setControl("pressed", nextPressed)}
          pressed={controls.pressed}
          size={controls.size as ToggleSize}
          tone={controls.tone as ToggleTone}
          variant={controls.variant as ToggleVariant}
        >
          {icon}
          {controls.iconOnly ? null : controls.children}
        </Toggle>
      </div>
    </StoryBook>
  );
}
