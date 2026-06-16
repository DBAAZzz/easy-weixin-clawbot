import { ActivityIcon, ChatIcon, Select } from "@clawbot/ui";
import { StoryBook, useControls, useSetControl } from "../../Playground/index.js";
import type { SelectSize } from "../index.js";

const options = [
  { value: "chat", label: "对话 Agent", icon: <ChatIcon /> },
  { value: "ops", label: "运维 Agent", icon: <ActivityIcon /> },
  { value: "memory", label: "记忆 Agent" },
];

export default function SelectPlayground() {
  const controls = useControls({
    value: {
      options: options.map((option) => ({ label: option.label, value: option.value })),
      value: "chat",
    },
    size: {
      options: [
        { label: "default", value: "default" },
        { label: "small", value: "sm" },
      ],
      value: "default",
    },
    disabled: false,
  });
  const setControl = useSetControl();

  return (
    <StoryBook>
      <div className="ui-demo-select">
        <Select
          disabled={controls.disabled}
          onChange={(nextValue) => setControl("value", nextValue)}
          options={options}
          size={controls.size as SelectSize}
          value={controls.value}
        />
      </div>
    </StoryBook>
  );
}
