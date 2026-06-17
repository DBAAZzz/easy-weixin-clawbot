import { Badge, type BadgeSize, type BadgeTone } from "../index.js";
import { StoryBook, useControls } from "../../Playground/index.js";

export default function BadgePlayground() {
  const controls = useControls({
    tone: {
      options: ["online", "offline", "muted", "warning", "error"],
      value: "online",
    },
    size: {
      options: ["md", "sm"],
      value: "md",
    },
    bordered: true,
    children: "运行中",
  });

  return (
    <StoryBook>
      <Badge
        bordered={controls.bordered}
        size={controls.size as BadgeSize}
        tone={controls.tone as BadgeTone}
      >
        {controls.children}
      </Badge>
    </StoryBook>
  );
}
