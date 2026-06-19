import type { ModelProviderTemplatePingDto } from "../../../../shared/src/types.js";
import { cn } from "../../lib/cn.js";
import { AlertCircleIcon, CheckCircleIcon, PulseIcon, RefreshIcon } from "@clawbot/ui";
import type { ProviderPingState } from "./types.js";

export function createClientPingFailure(
  templateId: string,
  provider: string,
  message: string,
): ModelProviderTemplatePingDto {
  return {
    template_id: templateId,
    provider,
    reachable: false,
    status_code: null,
    latency_ms: null,
    checked_at: new Date().toISOString(),
    endpoint: null,
    message,
    model_count: null,
  };
}

function getPingTone(
  pingState: ProviderPingState | undefined,
): "online" | "muted" | "warning" | "error" {
  if (!pingState || pingState.phase === "idle") {
    return "muted";
  }
  if (pingState.phase === "pending") {
    return "warning";
  }
  if (pingState.result?.reachable) {
    return "online";
  }
  if (
    pingState.result?.message === "未配置 API Key" ||
    pingState.result?.message === "Azure OpenAI 需要 Base URL" ||
    pingState.result?.message === "未配置可探测的 Base URL"
  ) {
    return "warning";
  }
  return "error";
}

function getPingLabel(pingState: ProviderPingState | undefined): string {
  if (!pingState || pingState.phase === "idle") {
    return "检测供应商连通性";
  }
  if (pingState.phase === "pending") {
    return "检测中";
  }
  if (pingState.result?.reachable) {
    return pingState.result.latency_ms ? `连接正常 · ${pingState.result.latency_ms}ms` : "连接正常";
  }
  if (
    pingState.result?.message === "未配置 API Key" ||
    pingState.result?.message === "Azure OpenAI 需要 Base URL" ||
    pingState.result?.message === "未配置可探测的 Base URL"
  ) {
    return pingState.result.message;
  }
  return pingState.result?.status_code ? `连接失败 · ${pingState.result.status_code}` : "连接失败";
}

function formatPingCheckedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getPingMeta(pingState: ProviderPingState | undefined): string | null {
  if (!pingState || pingState.phase !== "resolved" || !pingState.result) {
    return null;
  }

  const parts = [`最近检测 ${formatPingCheckedAt(pingState.result.checked_at)}`];
  if (pingState.result.reachable) {
    if (pingState.result.latency_ms !== null) {
      parts.push(`${pingState.result.latency_ms}ms`);
    }
    if (pingState.result.model_count !== null) {
      parts.push(`返回 ${pingState.result.model_count} 个模型`);
    }
  } else {
    parts.push(pingState.result.message);
  }
  return parts.join(" · ");
}

export function PingStatusButton(props: { pingState?: ProviderPingState; onPing: () => void }) {
  const tone = getPingTone(props.pingState);
  const title = getPingLabel(props.pingState);
  const isPending = props.pingState?.phase === "pending";

  return (
    <button
      type="button"
      disabled={isPending}
      aria-label={title}
      title={title}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        props.onPing();
      }}
      className={cn(
        "inline-flex size-7 shrink-0 items-center justify-center rounded-full border transition duration-200 ease-expo disabled:cursor-not-allowed disabled:opacity-60",
        tone === "online" &&
          "border-emerald-200 bg-emerald-50 text-emerald-600 hover:border-emerald-300 hover:bg-emerald-100",
        tone === "warning" &&
          "border-amber-200 bg-amber-50 text-amber-600 hover:border-amber-300 hover:bg-amber-100",
        tone === "error" &&
          "border-red-200 bg-red-50 text-red-600 hover:border-red-300 hover:bg-red-100",
        tone === "muted" &&
          "border-line bg-white text-muted hover:border-line-strong hover:text-muted-strong",
      )}
    >
      {isPending ? (
        <RefreshIcon className="size-3.5 animate-spin" />
      ) : props.pingState?.result?.reachable ? (
        <CheckCircleIcon className="size-3.5" />
      ) : props.pingState?.phase === "resolved" ? (
        <AlertCircleIcon className="size-3.5" />
      ) : (
        <PulseIcon className="size-3.5" />
      )}
    </button>
  );
}
