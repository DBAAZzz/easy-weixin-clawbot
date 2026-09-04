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
  {
    value: "long-title",
    label:
      "超长会话标题：[当前时间: 2026/04/29 周三 11:55] <memory> ## 已知事实 - 对 AI 付费的认知误区，用户误以为使用本 AI 需要按月付费",
  },
  { value: "session-meal", label: "会话：健康饮食提醒" },
  { value: "session-weekly", label: "会话：周报汇总" },
  { value: "session-mcp", label: "会话：MCP 工具排查" },
  { value: "session-tape", label: "会话：Tape 记忆折叠" },
  { value: "session-rss", label: "会话：RSS 订阅配置" },
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
