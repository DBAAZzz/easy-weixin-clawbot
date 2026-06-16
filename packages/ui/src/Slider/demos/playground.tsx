import { Slider } from "../index.js";
import { StoryBook, useControls, useSetControl } from "../../Playground/index.js";

export default function SliderPlayground() {
  const controls = useControls({
    value: {
      min: 0,
      max: 1,
      step: 0.01,
      value: 0.72,
    },
    disabled: false,
  });
  const setControl = useSetControl();

  return (
    <StoryBook>
      <div className="ui-demo-slider">
        <div className="ui-demo-slider-header">
          <span>回复随机性</span>
          <span>{Number(controls.value).toFixed(2)}</span>
        </div>
        <Slider
          disabled={controls.disabled}
          onValueChange={(nextValue) => setControl("value", nextValue)}
          value={controls.value}
        />
      </div>
    </StoryBook>
  );
}
