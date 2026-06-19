import { AlertCircleIcon } from "../../Icons/index.js";
import { StoryBook, useControls } from "../../Playground/index.js";
import { Tooltip, type TooltipPlacement } from "../index.js";

export default function TooltipPlayground() {
  const controls = useControls({
    placement: {
      options: ["top", "bottom", "left", "right"],
      value: "top",
    },
    delay: 400,
    title: "这是一条提示信息",
  });

  return (
    <StoryBook>
      <div className="flex items-center gap-4">
        <Tooltip
          title={controls.title}
          placement={controls.placement as TooltipPlacement}
          delay={controls.delay}
        >
          <AlertCircleIcon />
        </Tooltip>
        <span className="text-base text-muted-strong">将鼠标悬停在图标上查看提示</span>
      </div>
    </StoryBook>
  );
}
