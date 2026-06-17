import { Input, SearchIcon, TerminalIcon } from "@clawbot/ui";
import { StoryBook, useControls, useSetControl } from "../../Playground/index.js";
import type { InputSize } from "../index.js";

export default function InputPlayground() {
  const controls = useControls({
    size: {
      options: [
        { label: "small", value: "sm" },
        { label: "medium", value: "md" },
      ],
      value: "md",
    },
    placeholder: "例如 gpt-5-mini",
    value: "",
    leftIcon: true,
    rightIcon: false,
    disabled: false,
  });
  const setControl = useSetControl();

  return (
    <StoryBook>
      <div className="ui-demo-input">
        <Input
          disabled={controls.disabled}
          leftIcon={controls.leftIcon ? <SearchIcon /> : undefined}
          onChange={(event) => setControl("value", event.target.value)}
          placeholder={controls.placeholder}
          rightIcon={controls.rightIcon ? <TerminalIcon /> : undefined}
          size={controls.size as InputSize}
          value={controls.value}
        />
      </div>
    </StoryBook>
  );
}
