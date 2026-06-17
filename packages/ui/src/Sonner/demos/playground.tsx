import { AppToaster, Button, toast } from "@clawbot/ui";
import { StoryBook, useControls } from "../../Playground/index.js";

export default function Demo() {
  const controls = useControls({
    type: {
      options: ["success", "info", "warning", "error", "loading"],
      value: "success",
    },
    message: "配置已保存",
    description: "新的模型参数会应用到下一轮对话。",
  });

  function showToast() {
    const options = {
      description: controls.description,
    };

    switch (controls.type) {
      case "error":
        toast.error(controls.message, options);
        break;
      case "info":
        toast.info(controls.message, options);
        break;
      case "loading":
        toast.loading(controls.message, options);
        break;
      case "warning":
        toast.warning(controls.message, options);
        break;
      default:
        toast.success(controls.message, options);
    }
  }

  return (
    <StoryBook>
      <div className="ui-demo-sonner-actions">
        <Button onClick={showToast}>触发通知</Button>
        <AppToaster />
      </div>
    </StoryBook>
  );
}
