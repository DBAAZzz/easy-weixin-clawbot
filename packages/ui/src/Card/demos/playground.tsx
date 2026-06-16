import { Badge, Card } from "@clawbot/ui";
import { StoryBook, useControls } from "../../Playground/index.js";

export default function CardPlayground() {
  const controls = useControls({
    title: "微信助手",
    description: "会话、记忆和工具调用运行正常。",
    tone: {
      options: ["online", "offline", "warning", "error", "muted"],
      value: "online",
    },
    status: "运行中",
  });

  return (
    <StoryBook>
      <Card className="ui-demo-card">
        <div className="ui-demo-card-header">
          <div>
            <h3 className="ui-demo-title">{controls.title}</h3>
            <p className="ui-demo-description">{controls.description}</p>
          </div>
          <Badge tone={controls.tone as "error" | "muted" | "offline" | "online" | "warning"}>
            {controls.status}
          </Badge>
        </div>
      </Card>
    </StoryBook>
  );
}
