import { Breadcrumb } from "../index.js";
import { StoryBook, useControls } from "../../Playground/index.js";

export default function BreadcrumbPlayground() {
  const controls = useControls({
    showBack: true,
    first: "技能库",
    second: "builtin",
    third: "healthy-meal-reminder",
  });

  return (
    <StoryBook>
      <Breadcrumb
        backHref={controls.showBack ? "#" : undefined}
        items={[
          { href: "#", label: controls.first },
          { href: "#", label: controls.second },
          { current: true, label: controls.third },
        ]}
      />
    </StoryBook>
  );
}
