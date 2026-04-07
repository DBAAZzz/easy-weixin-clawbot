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

export function PulseIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 12h4l2.2-4.5 4.1 9 2.1-4.5H21" />
      <path d="M6 5h12" opacity="0.35" />
      <path d="M6 19h12" opacity="0.35" />
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

export function BoltIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M13 2 5 13h5l-1 9 8-11h-5l1-9Z" />
    </BaseIcon>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6 4.5h9.5A2.5 2.5 0 0 1 18 7v12.5H8.5A2.5 2.5 0 0 0 6 22V4.5Z" />
      <path d="M6 4.5A2.5 2.5 0 0 0 3.5 7v11A2.5 2.5 0 0 0 6 20.5H18" />
      <path d="M9 8h5" />
      <path d="M9 11h5" />
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

export function LogOutIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </BaseIcon>
  );
}

export function WebhookIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M18 16.98h-5.99c-1.1 0-1.95.94-2.48 1.9A4 4 0 0 1 2 17c.01-.7.2-1.4.57-2" />
      <path d="m6 17 3.13-5.78c.53-.97.43-2.17-.26-3.1a4 4 0 0 1 6.92-4.02c.35.6.56 1.28.57 2" />
      <path d="m12 6 3.13 5.73C15.66 12.7 16.9 13 18 13a4 4 0 0 1 .8 7.93" />
      <path d="M12 6 8.87 11.73" />
    </BaseIcon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </BaseIcon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </BaseIcon>
  );
}

export function RefreshIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M8 16H3v5" />
    </BaseIcon>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </BaseIcon>
  );
}

export function KeyIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m21 2-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </BaseIcon>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V8a4 4 0 1 1 8 0v3" />
    </BaseIcon>
  );
}

export function ClockIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 3" />
    </BaseIcon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m6 9 6 6 6-6" />
    </BaseIcon>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m18 15-6-6-6 6" />
    </BaseIcon>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M12 7v5l4 2" />
    </BaseIcon>
  );
}

export function AlertCircleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </BaseIcon>
  );
}

export function CheckCircleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </BaseIcon>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 5l14 7-14 7V5z" />
    </BaseIcon>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="6" y="4" width="4" height="16" />
      <rect x="14" y="4" width="4" height="16" />
    </BaseIcon>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <path d="M16 2v4" />
      <path d="M8 2v4" />
      <path d="M3 10h18" />
    </BaseIcon>
  );
}

export function CpuIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 1v3" />
      <path d="M15 1v3" />
      <path d="M9 20v3" />
      <path d="M15 20v3" />
      <path d="M20 9h3" />
      <path d="M20 14h3" />
      <path d="M1 9h3" />
      <path d="M1 14h3" />
    </BaseIcon>
  );
}
