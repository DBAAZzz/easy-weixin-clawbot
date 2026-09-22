import { Suspense } from "react";
import type { IPreviewerProps } from "dumi";
import DefaultPreviewer from "dumi/theme-default/builtins/Previewer";
import "../../style.css";

type PreviewerProps = IPreviewerProps & {
  center?: boolean;
  nopadding?: boolean;
  pure?: boolean;
};

/** demo chunk 懒加载期间的画布占位，避免 Playground 区域空白。 */
function DemoSkeleton() {
  return (
    <div aria-hidden="true" className="clawbot-demo-skeleton">
      <span className="clawbot-demo-skeleton__pill clawbot-skeleton" />
      <span className="clawbot-demo-skeleton__line clawbot-skeleton" />
      <span className="clawbot-demo-skeleton__block clawbot-skeleton" />
    </div>
  );
}

export default function Previewer({ center, children, nopadding, pure, ...props }: PreviewerProps) {
  return (
    <div
      className="clawbot-previewer"
      data-center={center ? "true" : undefined}
      data-nopadding={nopadding ? "true" : undefined}
      data-pure={pure ? "true" : undefined}
    >
      <DefaultPreviewer {...props}>
        <Suspense fallback={<DemoSkeleton />}>{children}</Suspense>
      </DefaultPreviewer>
    </div>
  );
}
