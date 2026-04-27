const dateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const fullDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const numberFormatter = new Intl.NumberFormat("zh-CN");
const decimalFormatter = new Intl.NumberFormat("zh-CN", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
const compactNumberFormatter = new Intl.NumberFormat("zh-CN", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const usdFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatDateTime(value?: string | null) {
  if (!value) return "暂无记录";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";

  return dateTimeFormatter.format(date);
}

export function formatFullDateTime(value?: string | null) {
  if (!value) return "暂无记录";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无记录";

  return fullDateTimeFormatter.format(date);
}

export function formatTime(value?: string | null) {
  if (!value) return "--:--";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";

  return timeFormatter.format(date);
}

export function formatRelativeTime(value?: string | null) {
  if (!value) return "暂无活跃";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无活跃";

  const diff = Date.now() - date.getTime();
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return "刚刚更新";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;

  return `${Math.floor(diff / day)} 天前`;
}

export function formatDuration(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";

  const totalMinutes = Math.max(0, Math.floor(value / 60_000));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`;
  return `${minutes} 分钟`;
}

export function formatCount(value: number) {
  return numberFormatter.format(value);
}

export function formatMs(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  if (value >= 1000) return `${decimalFormatter.format(value / 1000)}s`;
  return `${numberFormatter.format(Math.round(value))}ms`;
}

export function formatPercent(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return `${decimalFormatter.format(value * 100)}%`;
}

export function formatTokens(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return compactNumberFormatter.format(value);
}

export function formatUsd(value?: number | null) {
  if (typeof value !== "number" || Number.isNaN(value)) return "--";
  return usdFormatter.format(value);
}
