import { Switch } from "../index.js";
import { StoryBook, useControls, useSetControl } from "../../Playground/index.js";
import type { SwitchSize, SwitchTone } from "../index.js";

export default function SwitchPlayground() {
  const controls = useControls({
    checked: true,
    size: {
      options: [
        { label: "small", value: "sm" },
        { label: "medium", value: "md" },
      ],
      value: "md",
    },
    tone: {
      options: [
        { label: "accent", value: "accent" },
        { label: "success", value: "success" },
        { label: "ink", value: "ink" },
      ],
      value: "accent",
    },
    disabled: false,
    label: "启用 Agent",
  });
  const setControl = useSetControl();

  return (
    <StoryBook>
      <div className="ui-demo-switch">
        <span>{controls.label}</span>
        <Switch
          checked={controls.checked}
          disabled={controls.disabled}
          label={controls.label}
          onCheckedChange={(checked) => setControl("checked", checked)}
          size={controls.size as SwitchSize}
          tone={controls.tone as SwitchTone}
        />
      </div>
    </StoryBook>
  );
}
