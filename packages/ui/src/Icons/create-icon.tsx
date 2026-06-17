import { forwardRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import type { SVGProps } from "react";
import type { IconSvgElement } from "@hugeicons/react";

export type IconProps = SVGProps<SVGSVGElement> & {
  absoluteStrokeWidth?: boolean;
  disableSecondaryOpacity?: boolean;
  primaryColor?: string;
  secondaryColor?: string;
  size?: number | string;
};

export function createIcon(icon: IconSvgElement, displayName: string) {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function ClawbotIcon(
    { color = "currentColor", strokeWidth = 1.8, ...props },
    ref,
  ) {
    const normalizedStrokeWidth =
      typeof strokeWidth === "string" ? Number(strokeWidth) : strokeWidth;

    return (
      <HugeiconsIcon
        ref={ref}
        color={color}
        icon={icon}
        strokeWidth={Number.isFinite(normalizedStrokeWidth) ? normalizedStrokeWidth : undefined}
        {...props}
      />
    );
  });

  Icon.displayName = displayName;

  return Icon;
}
