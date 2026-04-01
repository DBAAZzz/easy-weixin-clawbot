export type NormalizedWebhookTextMessage = {
  accountId: string;
  conversationId: string;
  messageType: "text";
  text: string;
};

export type NormalizedWebhookImageMessage = {
  accountId: string;
  conversationId: string;
  messageType: "image";
  imageUrl: string;
  text: string;
};

export type NormalizedWebhookMessage =
  | NormalizedWebhookTextMessage
  | NormalizedWebhookImageMessage;

type WebhookMessageType = "text" | "image";

function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }

  return value.trim();
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeMessageType(body: Record<string, unknown>): WebhookMessageType {
  const explicitType = optionalString(body.type);
  if (explicitType) {
    if (explicitType === "text" || explicitType === "image") {
      return explicitType;
    }

    throw new Error(`Unsupported webhook message type: ${explicitType}`);
  }

  return optionalString(body.imageUrl) ? "image" : "text";
}

function normalizeImageUrl(value: unknown): string {
  const imageUrl = requireNonEmptyString(value, "imageUrl");

  let parsed: URL;
  try {
    parsed = new URL(imageUrl);
  } catch {
    throw new Error("imageUrl must be a valid http or https URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("imageUrl must be a valid http or https URL");
  }

  return parsed.toString();
}

export function normalizeWebhookMessageBody(body: unknown): NormalizedWebhookMessage {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("Request body must be a JSON object");
  }

  const record = body as Record<string, unknown>;
  const accountId = requireNonEmptyString(record.accountId, "accountId");
  const conversationId = requireNonEmptyString(record.conversationId, "conversationId");
  const text = optionalString(record.text);
  const messageType = normalizeMessageType(record);

  if (text.length > 4000) {
    throw new Error("Text exceeds 4000 characters");
  }

  if (messageType === "text") {
    if (!text) {
      throw new Error("text is required for text messages");
    }

    return {
      accountId,
      conversationId,
      messageType,
      text,
    };
  }

  return {
    accountId,
    conversationId,
    messageType,
    imageUrl: normalizeImageUrl(record.imageUrl),
    text,
  };
}

export function formatWebhookLogContent(message: NormalizedWebhookMessage): string {
  if (message.messageType === "text") {
    return message.text;
  }

  return message.text
    ? `[image] ${message.text} | ${message.imageUrl}`
    : `[image] ${message.imageUrl}`;
}
