import type { McpServerInfo } from "@clawbot/shared";
import { LinkIcon } from "@clawbot/ui";
import { cn } from "../../lib/cn.js";

export function ServerAvatar(props: { status: McpServerInfo["status"] }) {
  return (
    <span
      className={cn(
        "flex size-10 shrink-0 items-center justify-center rounded-lg border bg-frost-92",
        props.status === "connected"
          ? "border-notice-success-border text-accent-strong"
          : "border-line text-ink",
      )}
    >
      <LinkIcon className="size-[18px]" />
    </span>
  );
}
