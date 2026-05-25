import {
  MESSAGE_CONTENT_TYPE,
  MESSAGE_ROLE,
  MESSAGE_STOP_REASON,
  type MessageRow,
} from "@clawbot/shared";

export type MessageTimelineItem = {
  message: MessageRow;
  thoughts: MessageRow[];
  tools: MessageRow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function getPayload(message: MessageRow) {
  if (isRecord(message.payload)) {
    return message.payload;
  }

  if (typeof message.payload !== "string") {
    return {};
  }

  try {
    const parsed: unknown = JSON.parse(message.payload);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function getPayloadContent(message: MessageRow) {
  const payload = getPayload(message);
  const content = payload.content;
  return Array.isArray(content) ? content.filter(isRecord) : [];
}

function hasDisplayContent(message: MessageRow) {
  const content = getPayloadContent(message);
  if (content.length === 0) {
    return Boolean(message.content_text?.trim());
  }

  return content.some((block) => {
    if (block.type === MESSAGE_CONTENT_TYPE.TEXT) {
      return typeof block.text === "string" && block.text.trim().length > 0;
    }

    return message.role === MESSAGE_ROLE.USER && block.type === MESSAGE_CONTENT_TYPE.IMAGE;
  });
}

function isToolUseAssistant(message: MessageRow) {
  if (message.role !== MESSAGE_ROLE.ASSISTANT) return false;

  const payload = getPayload(message);
  const content = getPayloadContent(message);
  return (
    payload.stopReason === MESSAGE_STOP_REASON.TOOL_USE ||
    content.some((block) => block.type === MESSAGE_CONTENT_TYPE.TOOL_CALL)
  );
}

export function buildMessageTimeline(messages: MessageRow[]): MessageTimelineItem[] {
  const items: MessageTimelineItem[] = [];
  let pendingThoughts: MessageRow[] = [];
  let pendingTools: MessageRow[] = [];

  for (const message of messages) {
    if (message.role === MESSAGE_ROLE.TOOL_RESULT) {
      pendingTools.push(message);
      continue;
    }

    if (message.role === MESSAGE_ROLE.ASSISTANT) {
      if (isToolUseAssistant(message)) {
        pendingThoughts.push(message);
        continue;
      }

      if (hasDisplayContent(message)) {
        items.push({ message, thoughts: pendingThoughts, tools: pendingTools });
      } else if (pendingTools.length > 0 && items.length > 0) {
        items[items.length - 1].tools.push(...pendingTools);
      } else if (pendingThoughts.length > 0 && items.length > 0) {
        items[items.length - 1].thoughts.push(...pendingThoughts);
      }

      pendingThoughts = [];
      pendingTools = [];
      continue;
    }

    if (pendingTools.length > 0 && items.length > 0) {
      items[items.length - 1].tools.push(...pendingTools);
      pendingTools = [];
    }

    if (pendingThoughts.length > 0 && items.length > 0) {
      items[items.length - 1].thoughts.push(...pendingThoughts);
      pendingThoughts = [];
    }

    items.push({ message, thoughts: [], tools: [] });
  }

  if (pendingTools.length > 0 && items.length > 0) {
    items[items.length - 1].tools.push(...pendingTools);
  }

  if (pendingThoughts.length > 0 && items.length > 0) {
    items[items.length - 1].thoughts.push(...pendingThoughts);
  }

  return items;
}
