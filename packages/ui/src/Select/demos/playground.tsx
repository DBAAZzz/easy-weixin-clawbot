import { ActivityIcon, Badge, ChatIcon, NetworkIcon, Select, StackIcon } from "@clawbot/ui";
import { StoryBook, useControls, useSetControl } from "../../Playground/index.js";
import type { SelectSize, SelectVariant } from "../index.js";

const options = [
  {
    value: "main",
    label: "main",
    icon: <NetworkIcon />,
    suffix: (
      <Badge size="sm" tone="online">
        全局
      </Badge>
    ),
  },
  {
    value: "support-east",
    label: "客服-华东",
    icon: <ChatIcon />,
    suffix: (
      <Badge size="sm" tone="muted">
        账号
      </Badge>
    ),
  },
  { value: "ops", label: "运维 Agent", icon: <ActivityIcon /> },
];

export default function SelectPlayground() {
  const controls = useControls({
    value: {
      options: options.map((option) => ({ label: option.label, value: option.value })),
      value: "main",
    },
    size: {
      options: [
        { label: "default", value: "default" },
        { label: "small", value: "sm" },
      ],
      value: "default",
    },
    variant: {
      options: [
        { label: "default", value: "default" },
        { label: "subtle", value: "subtle" },
      ],
      value: "subtle",
    },
    disabled: false,
    fullWidth: true,
    showIndicator: true,
  });
  const setControl = useSetControl();

  return (
    <StoryBook>
      <div className="ui-demo-select">
        <Select
          disabled={controls.disabled}
          fullWidth={controls.fullWidth}
          onChange={(nextValue) => setControl("value", nextValue)}
          options={options}
          prefix={
            <>
              <StackIcon />
              <span>分支</span>
            </>
          }
          renderOption={(option) => (
            <span className="cb-select-option-content">
              {option.icon ? <span className="cb-select-item-icon">{option.icon}</span> : null}
              <span className="cb-select-option-title">{option.label}</span>
              {option.suffix}
            </span>
          )}
          renderValue={(option) => (
            <span className="cb-select-value">
              <span className="cb-select-value-label">{option.label}</span>
              {option.suffix ? (
                <span className="cb-select-value-suffix">{option.suffix}</span>
              ) : null}
            </span>
          )}
          size={controls.size as SelectSize}
          showIndicator={controls.showIndicator}
          value={controls.value}
          variant={controls.variant as SelectVariant}
        />
      </div>
    </StoryBook>
  );
}
