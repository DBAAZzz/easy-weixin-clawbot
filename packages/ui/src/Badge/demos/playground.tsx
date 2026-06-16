import { Badge } from "../index.js";
import { StoryBook, useControls } from "../../Playground/index.js";

export default function BadgePlayground() {
  const controls = useControls({
    tone: {
      options: ["online", "offline", "muted", "warning", "error"],
      value: "online",
    },
    children: "运行中",
  });

  return (
    <StoryBook>
      <Badge tone={controls.tone as "error" | "muted" | "offline" | "online" | "warning"}>
        {controls.children}
      </Badge>
    </StoryBook>
  );
}
