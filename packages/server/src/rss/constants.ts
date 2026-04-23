import { XMLParser } from "fast-xml-parser";

export const COLLECT_INTERVAL_MS = 5 * 60 * 1000;
export const ENTRY_RETENTION_DAYS = 14;
export const SOURCE_PREVIEW_LIMIT = 10;
export const TASK_ENTRY_QUERY_LIMIT = 200;
export const DEFAULT_DIGEST_MAX_ITEMS = 8;
export const DEFAULT_BRIEF_MAX_ITEMS = 4;
export const MAX_TASK_ITEMS = 20;
export const MAX_TITLE_LENGTH = 200;
export const MAX_SUMMARY_LENGTH = 400;
export const MAX_CONTENT_LENGTH = 2000;
export const RSS_USER_AGENT = "ClawbotRSS/1.0 (+https://clawbot.local)";

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseTagValue: false,
  trimValues: false,
  cdataPropName: "cdata",
  processEntities: false,
  // RSS 的 description / content 节点经常直接内嵌 HTML；这里必须保留原始字符串，
  // 后续再统一走 sanitizeText 清洗，否则解析器会把内部标签当成 XML 节点吞掉后续字段。
  stopNodes: ["*.description", "*.summary", "*.subtitle", "*.content", "*.content:encoded"],
});
