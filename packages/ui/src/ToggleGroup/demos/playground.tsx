import { ActivityIcon, ChatIcon, GridIcon, QueueIcon, Toggle, ToggleGroup } from "@clawbot/ui";
import { StoryBook, useControls, useSetControl } from "../../Playground/index.js";
import type { ToggleGroupVariant, ToggleSize, ToggleTone } from "../index.js";

const options = [
  { icon: <QueueIcon />, label: "列表", value: "list" },
  { icon: <GridIcon />, label: "网格", value: "grid" },
  { icon: <ActivityIcon />, label: "监控", value: "ops" },
];

export default function ToggleGroupPlayground() {
  const controls = useControls({
    variant: {
      options: [
        { label: "segmented", value: "segmented" },
        { label: "attached", value: "attached" },
        { label: "line", value: "line" },
      ],
      value: "segmented",
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
    selection: "grid",
    multiple: false,
    fullWidth: false,
    disabled: false,
  });
  const setControl = useSetControl();
  const value = String(controls.selection)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return (
    <StoryBook>
      <div className="ui-demo-toggle-group">
        <ToggleGroup
          disabled={controls.disabled}
          fullWidth={controls.fullWidth}
          multiple={controls.multiple}
          onValueChange={(nextValue) => setControl("selection", nextValue.join(","))}
          size={controls.size as ToggleSize}
          tone={controls.tone as ToggleTone}
          value={value}
          variant={controls.variant as ToggleGroupVariant}
        >
          {options.map((option) => (
            <Toggle key={option.value} value={option.value}>
              {option.icon}
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>

        <ToggleGroup defaultValue={["chat"]} tone="ink" variant="line">
          <Toggle value="chat">
            <ChatIcon />
            对话
          </Toggle>
          <Toggle value="memory">记忆</Toggle>
          <Toggle value="tools">工具</Toggle>
        </ToggleGroup>
      </div>
    </StoryBook>
  );
}
