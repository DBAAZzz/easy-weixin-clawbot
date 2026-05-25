import { MESSAGE_CONTENT_TYPE, type MessageRow, type PaginatedResponse } from "@clawbot/shared";
import { requestPaginated } from "./core/client";
import { fetchAppSettings } from "./settings";
import { toQueryString } from "./core/query";

type MessageContentBlock = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function encodeAssetPath(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function joinAssetUrl(baseUrl: string, filePath: string): string {
  return `${baseUrl.replace(/\/$/, "")}/${encodeAssetPath(filePath.replace(/^\//, ""))}`;
}

function isTextBlock(block: MessageContentBlock): block is MessageContentBlock & { text: string } {
  return block.type === MESSAGE_CONTENT_TYPE.TEXT && typeof block.text === "string";
}

function imageBlockToMarkdown(block: MessageContentBlock, r2BaseUrl: string | null): string {
  const filePath = typeof block.filePath === "string" ? block.filePath : "";
  if (/^https?:\/\//iu.test(filePath)) {
    return `![图片](${filePath})`;
  }

  if (r2BaseUrl && filePath && block.storageProvider === "s3-compatible") {
    return `![图片](${joinAssetUrl(r2BaseUrl, filePath)})`;
  }

  return filePath ? `[图片](${filePath})` : "[图片]";
}

function contentTextFromPayload(message: MessageRow, r2BaseUrl: string | null): string | null {
  const content = isRecord(message.payload) ? message.payload.content : null;
  if (!Array.isArray(content)) {
    return message.content_text;
  }

  const parts = content
    .map((block) => {
      if (!isRecord(block)) {
        return "";
      }

      if (isTextBlock(block)) {
        return block.text;
      }

      if (block.type === MESSAGE_CONTENT_TYPE.IMAGE) {
        return imageBlockToMarkdown(block, r2BaseUrl);
      }

      return "";
    })
    .filter(Boolean);

  return parts.length > 0 ? parts.join("\n\n") : message.content_text;
}

function withDisplayAssetUrls(message: MessageRow, r2BaseUrl: string | null): MessageRow {
  const content = isRecord(message.payload) ? message.payload.content : null;
  if (!Array.isArray(content)) {
    return message;
  }

  return {
    ...message,
    payload: {
      ...message.payload,
      content: content.map((block) => {
        if (!isRecord(block) || block.type !== MESSAGE_CONTENT_TYPE.IMAGE) {
          return block;
        }

        const filePath = typeof block.filePath === "string" ? block.filePath : "";
        if (!r2BaseUrl || !filePath || block.storageProvider !== "s3-compatible") {
          return block;
        }

        return {
          ...block,
          filePath: joinAssetUrl(r2BaseUrl, filePath),
        };
      }),
    },
  };
}

function withDisplayImageUrls(
  page: PaginatedResponse<MessageRow>,
  r2BaseUrl: string | null,
): PaginatedResponse<MessageRow> {
  return {
    ...page,
    data: page.data.map((message) => {
      const displayMessage = withDisplayAssetUrls(message, r2BaseUrl);

      return {
        ...displayMessage,
        content_text: contentTextFromPayload(displayMessage, r2BaseUrl),
      };
    }),
  };
}

export async function fetchMessages(
  accountId: string,
  conversationId: string,
  options?: { before?: number; limit?: number },
): Promise<PaginatedResponse<MessageRow>> {
  const suffix = toQueryString({
    limit: options?.limit,
    before: options?.before,
  });

  const [page, settings] = await Promise.all([
    requestPaginated<MessageRow>(
      `/api/accounts/${encodeURIComponent(accountId)}/conversations/${encodeURIComponent(conversationId)}/messages${suffix}`,
    ),
    fetchAppSettings().catch(() => null),
  ]);
  const r2BaseUrl =
    settings?.asset_storage_provider === "s3-compatible"
      ? (settings.asset_s3_public_base_url?.trim() ?? null)
      : null;

  return withDisplayImageUrls(page, r2BaseUrl);
}
