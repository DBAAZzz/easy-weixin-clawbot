import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function ActivityIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 12h3l2.2-5 3.6 10 2.2-5H20" />
    </BaseIcon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </BaseIcon>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6.8 18.8 4 20l1.2-2.8A8 8 0 1 1 20 12a8 8 0 0 1-13.2 6.8Z" />
    </BaseIcon>
  );
}

export function GridIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </BaseIcon>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 10.5 12 4l8 6.5" />
      <path d="M6 9.5V20h12V9.5" />
      <path d="M10 20v-5h4v5" />
    </BaseIcon>
  );
}

export function LinkIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 1 0-7.1-7.1L10 5" />
      <path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 1 0 7.1 7.1L14 19" />
    </BaseIcon>
  );
}

export function QueueIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 7h14" />
      <path d="M5 12h10" />
      <path d="M5 17h7" />
    </BaseIcon>
  );
}

export function PuzzleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M9 4.5a2.5 2.5 0 1 1 5 0v1h2.5A1.5 1.5 0 0 1 18 7v3h-1a2.5 2.5 0 1 0 0 5h1v2a1.5 1.5 0 0 1-1.5 1.5H14v-1a2.5 2.5 0 1 0-5 0v1H6.5A1.5 1.5 0 0 1 5 17v-2h1a2.5 2.5 0 1 0 0-5H5V7a1.5 1.5 0 0 1 1.5-1.5H9z" />
    </BaseIcon>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M7 4H5a1 1 0 0 0-1 1v2" />
      <path d="M17 4h2a1 1 0 0 1 1 1v2" />
      <path d="M20 17v2a1 1 0 0 1-1 1h-2" />
      <path d="M4 17v2a1 1 0 0 0 1 1h2" />
      <path d="M4 12h16" />
    </BaseIcon>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 20h4l10.5-10.5a2.83 2.83 0 0 0-4-4L4 16v4Z" />
      <path d="m14.5 5.5 4 4" />
    </BaseIcon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M20 6 9 17l-5-5" />
    </BaseIcon>
  );
}

export function XIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </BaseIcon>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </BaseIcon>
  );
}

export function StackIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m12 4 8 4-8 4-8-4 8-4Z" />
      <path d="m4 12 8 4 8-4" />
      <path d="m4 16 8 4 8-4" />
    </BaseIcon>
  );
}

export function TerminalIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <path d="m8 10 2 2-2 2" />
      <path d="M13 15h3" />
    </BaseIcon>
  );
}
