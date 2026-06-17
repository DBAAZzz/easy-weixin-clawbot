import { ScrollArea } from "@clawbot/ui";
import { StoryBook, useControls } from "../../Playground/index.js";

export default function Demo() {
  const controls = useControls({
    count: {
      max: 24,
      min: 4,
      step: 1,
      value: 12,
    },
  });

  return (
    <StoryBook>
      <ScrollArea className="ui-demo-scroll">
        <div className="ui-demo-scroll-content">
          {Array.from({ length: controls.count }, (_, index) => (
            <p key={index}>会话事件 #{index + 1} 已写入 Tape 记忆。</p>
          ))}
        </div>
      </ScrollArea>
    </StoryBook>
  );
}
