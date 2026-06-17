import type { RssSourceDto, RssSourcePreviewDto } from "@/api/rss.js";

export type SourceDraft = {
  id?: string;
  name: string;
  sourceType: "rsshub_route" | "rss_url";
  routePath: string;
  feedUrl: string;
  description: string;
  enabled: boolean;
};

export const EMPTY_DRAFT: SourceDraft = {
  name: "",
  sourceType: "rss_url",
  routePath: "",
  feedUrl: "",
  description: "",
  enabled: true,
};

const HTML_TAG_PATTERN = /<[a-z][\s\S]*>/i;

function normalizePreviewText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function decodePreviewHtmlEntities(value: string): string {
  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const document = parser.parseFromString(value, "text/html");
    return document.documentElement.textContent ?? value;
  }

  return value
    .replace(/&#(\d+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 10)),
    )
    .replace(/&#x([0-9a-fA-F]+);/g, (_, codePoint: string) =>
      String.fromCodePoint(Number.parseInt(codePoint, 16)),
    )
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function normalizePreviewMarkup(value?: string | null): string {
  if (!value) {
    return "";
  }

  let normalized = value.trim();
  for (let index = 0; index < 2; index += 1) {
    if (HTML_TAG_PATTERN.test(normalized)) {
      return normalized;
    }
    const decoded = decodePreviewHtmlEntities(normalized).trim();
    if (!decoded || decoded === normalized) {
      return normalized;
    }
    normalized = decoded;
  }

  return normalized;
}

export function stripHtmlToPlainText(value?: string | null): string {
  const normalizedValue = normalizePreviewMarkup(value);
  if (!normalizedValue) {
    return "";
  }

  if (typeof DOMParser !== "undefined") {
    const parser = new DOMParser();
    const document = parser.parseFromString(normalizedValue, "text/html");
    return normalizePreviewText(document.body.textContent ?? "");
  }

  return normalizePreviewText(
    normalizedValue
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

function truncatePreviewText(value: string, maxLength = 180): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1)}…`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value);
}

export function buildPreviewExcerpt(
  item: RssSourcePreviewDto["items"][number],
  maxLength = 180,
): string | null {
  const raw = item.summary_text || item.content_text;
  const text = stripHtmlToPlainText(raw);
  return text ? truncatePreviewText(text, maxLength) : null;
}

function formatPlainTextAsHtml(value: string): string {
  const paragraphs = value
    .split(/\n{2,}/)
    .map((segment) => normalizePreviewText(segment))
    .filter(Boolean);

  if (paragraphs.length === 0) {
    return "";
  }

  return paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function sanitizePreviewHtmlNode(node: ChildNode): string {
  if (node.nodeType === 3) {
    return escapeHtml(node.textContent ?? "");
  }

  if (node.nodeType !== 1) {
    return "";
  }

  const element = node as Element;
  const tag = element.tagName.toLowerCase();

  if (
    ["script", "style", "iframe", "img", "video", "audio", "source", "svg", "canvas"].includes(tag)
  ) {
    return "";
  }

  if (tag === "br") {
    return "<br />";
  }

  const content = Array.from(element.childNodes).map(sanitizePreviewHtmlNode).join("");
  const normalizedTag = tag === "b" ? "strong" : tag === "i" ? "em" : tag;

  if (normalizedTag === "a") {
    const href = element.getAttribute("href")?.trim() ?? "";
    const safeHref = /^(https?:|mailto:)/i.test(href) ? href : "";
    if (!content.trim()) {
      return "";
    }
    if (!safeHref) {
      return content;
    }
    return `<a href="${escapeHtmlAttribute(safeHref)}" target="_blank" rel="noreferrer">${content}</a>`;
  }

  if (
    ["p", "strong", "em", "ul", "ol", "li", "blockquote", "code", "pre"].includes(normalizedTag)
  ) {
    if (!content.trim()) {
      return "";
    }
    return `<${normalizedTag}>${content}</${normalizedTag}>`;
  }

  return content;
}

export function sanitizePreviewHtml(value?: string | null): string {
  const normalizedValue = normalizePreviewMarkup(value);
  const plainText = stripHtmlToPlainText(normalizedValue);
  const fallback = formatPlainTextAsHtml(plainText);

  if (!normalizedValue) {
    return fallback;
  }

  if (!HTML_TAG_PATTERN.test(normalizedValue)) {
    return fallback;
  }

  if (typeof DOMParser === "undefined") {
    return fallback;
  }

  const parser = new DOMParser();
  const document = parser.parseFromString(normalizedValue, "text/html");
  const html = Array.from(document.body.childNodes).map(sanitizePreviewHtmlNode).join("").trim();

  return html || fallback;
}

export function sourceStatusTone(
  status: RssSourceDto["status"],
): "online" | "offline" | "warning" | "error" | "muted" {
  if (status === "normal") return "online";
  if (status === "backoff") return "warning";
  if (status === "error") return "error";
  if (status === "disabled") return "offline";
  return "muted";
}

export function sourceStatusLabel(status: RssSourceDto["status"]): string {
  if (status === "normal") return "正常";
  if (status === "backoff") return "退避中";
  if (status === "error") return "异常";
  if (status === "disabled") return "停用";
  return status;
}

export function createDraft(source?: RssSourceDto | null): SourceDraft {
  if (!source) {
    return EMPTY_DRAFT;
  }

  return {
    id: source.id,
    name: source.name,
    sourceType: source.source_type,
    routePath: source.route_path ?? "",
    feedUrl: source.feed_url ?? "",
    description: source.description ?? "",
    enabled: source.enabled,
  };
}
