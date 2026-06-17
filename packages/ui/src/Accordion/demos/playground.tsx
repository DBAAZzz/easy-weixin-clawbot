import { Accordion, Badge } from "@clawbot/ui";
import { StoryBook, useControls } from "../../Playground/index.js";

export default function AccordionPlayground() {
  const controls = useControls({
    title: "工具调用详情",
    meta: "3 steps",
    defaultOpen: true,
    content: "读取上下文、调用 MCP 工具、归档执行结果。",
  });

  return (
    <StoryBook>
      <div className="ui-demo-accordion">
        <Accordion
          key={String(controls.defaultOpen)}
          defaultOpen={controls.defaultOpen}
          meta={<Badge tone="muted">{controls.meta}</Badge>}
          title={controls.title}
        >
          <div className="ui-demo-accordion-content">{controls.content}</div>
        </Accordion>
      </div>
    </StoryBook>
  );
}
