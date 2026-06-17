import type { IPreviewerProps } from "dumi";
import DefaultPreviewer from "dumi/theme-default/builtins/Previewer";
import "../../style.css";

type PreviewerProps = IPreviewerProps & {
  center?: boolean;
  nopadding?: boolean;
  pure?: boolean;
};

export default function Previewer({ center, nopadding, pure, ...props }: PreviewerProps) {
  return (
    <div
      className="clawbot-previewer"
      data-center={center ? "true" : undefined}
      data-nopadding={nopadding ? "true" : undefined}
      data-pure={pure ? "true" : undefined}
    >
      <DefaultPreviewer {...props} />
    </div>
  );
}
