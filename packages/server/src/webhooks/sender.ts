import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import {
  resolveWeixinAccount,
  sendMessageWeixin,
  sendWeixinMediaFile,
} from "weixin-agent-sdk";
import { log } from "../logger.js";
import type { NormalizedWebhookMessage } from "./payload.js";

const IMAGE_EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
};

function resolveImageExtension(imageUrl: string, contentType: string | null): string {
  const normalizedContentType = contentType?.split(";")[0].trim().toLowerCase() ?? "";
  if (normalizedContentType in IMAGE_EXTENSION_BY_CONTENT_TYPE) {
    return IMAGE_EXTENSION_BY_CONTENT_TYPE[normalizedContentType];
  }

  try {
    const pathname = new URL(imageUrl).pathname;
    const extension = extname(pathname).toLowerCase();
    if (extension) {
      return extension;
    }
  } catch {
    // URL validity is checked earlier.
  }

  return ".jpg";
}

async function downloadRemoteImage(imageUrl: string): Promise<string> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type");
  if (contentType && !contentType.toLowerCase().startsWith("image/")) {
    throw new Error(`Image URL did not return an image content-type: ${contentType}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  const extension = resolveImageExtension(imageUrl, contentType);
  const filePath = join(tmpdir(), `clawbot-webhook-${randomUUID()}${extension}`);
  await writeFile(filePath, bytes);
  return filePath;
}

export async function sendWebhookMessage(params: {
  accountId: string;
  conversationId: string;
  contextToken: string;
  message: NormalizedWebhookMessage;
}): Promise<{ messageId: string }> {
  const account = resolveWeixinAccount(params.accountId);
  if (!account.configured || !account.token) {
    throw new Error(`Account ${params.accountId} not configured`);
  }

  const opts = {
    baseUrl: account.baseUrl,
    token: account.token,
    contextToken: params.contextToken,
  };

  if (params.message.messageType === "text") {
    const result = await sendMessageWeixin({
      to: params.conversationId,
      text: params.message.text,
      opts,
    });
    log.send(params.accountId, params.conversationId, params.message.text);
    return result;
  }

  let filePath: string | null = null;
  try {
    filePath = await downloadRemoteImage(params.message.imageUrl);
    const result = await sendWeixinMediaFile({
      filePath,
      to: params.conversationId,
      text: params.message.text,
      opts,
      cdnBaseUrl: account.cdnBaseUrl,
    });
    log.send(
      params.accountId,
      params.conversationId,
      params.message.text || `[image] ${params.message.imageUrl}`,
    );
    return result;
  } finally {
    if (filePath) {
      await unlink(filePath).catch(() => undefined);
    }
  }
}
