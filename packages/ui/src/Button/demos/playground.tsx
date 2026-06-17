import { Button } from "../index.js";
import { ActivityIcon, PulseIcon } from "../../Icons/index.js";
import { StoryBook, useControls } from "../../Playground/index.js";
import type { ButtonSize, ButtonVariant } from "../index.js";

const icons = {
  activity: <ActivityIcon />,
  none: null,
  pulse: <PulseIcon />,
};

export default function ButtonPlayground() {
  const controls = useControls({
    variant: {
      options: ["primary", "ink", "secondary", "ghost", "danger"],
      value: "primary",
    },
    size: {
      options: [
        { label: "small", value: "sm" },
        { label: "medium", value: "md" },
      ],
      value: "md",
    },
    icon: {
      options: ["pulse", "activity", "none"],
      value: "pulse",
    },
    disabled: false,
    fullWidth: false,
    iconOnly: false,
    children: "刷新数据",
  });

  const icon = icons[controls.icon as keyof typeof icons];

  return (
    <StoryBook>
      <Button
        disabled={controls.disabled}
        fullWidth={controls.fullWidth}
        size={controls.size as ButtonSize}
        variant={controls.variant as ButtonVariant}
      >
        {icon}
        {controls.iconOnly ? null : controls.children}
      </Button>
    </StoryBook>
  );
}
