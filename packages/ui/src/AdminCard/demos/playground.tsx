import { useState } from "react";
import {
  ActivityIcon,
  Card,
  CardOverflowMenu,
  CardToggle,
  IconTag,
  MetricGrid,
  PencilIcon,
  SearchIcon,
  TrashIcon,
} from "@clawbot/ui";
import { StoryBook, useControls } from "../../Playground/index.js";

export default function Demo() {
  const [enabled, setEnabled] = useState(true);
  const controls = useControls({
    title: "RSS 摘要 Agent",
    description: "自动读取订阅源并生成摘要。",
    tone: {
      options: ["online", "offline", "warning", "error", "muted"],
      value: "online",
    },
    status: "active",
  });

  return (
    <StoryBook>
      <Card className="group ui-demo-admin-card">
        <div className="ui-demo-admin-card-header">
          <div>
            <h3 className="ui-demo-title">{controls.title}</h3>
            <p className="ui-demo-description ui-demo-admin-description">{controls.description}</p>
          </div>
          <div className="ui-demo-admin-card-actions">
            <CardToggle enabled={enabled} label="启用订阅" onToggle={() => setEnabled(!enabled)} />
            <CardOverflowMenu
              items={[
                { label: "编辑", icon: <PencilIcon />, onClick: () => {} },
                { label: "删除", icon: <TrashIcon />, onClick: () => {} },
              ]}
            />
          </div>
        </div>
        <MetricGrid
          columns={3}
          items={[
            { icon: <ActivityIcon />, label: "运行", value: "24 次" },
            { icon: <SearchIcon />, label: "来源", value: "8 个" },
            { icon: <PencilIcon />, label: "草稿", value: "13 篇" },
          ]}
        />
        <div className="ui-demo-admin-card-tags">
          <IconTag
            icon={<ActivityIcon />}
            tone={controls.tone as "error" | "muted" | "offline" | "online" | "warning"}
          >
            {controls.status}
          </IconTag>
        </div>
      </Card>
    </StoryBook>
  );
}
