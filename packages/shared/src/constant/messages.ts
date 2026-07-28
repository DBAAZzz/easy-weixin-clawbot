export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  TOOL_RESULT: "toolResult",
  /**
   * A system-originated instruction that produced the following assistant
   * message — e.g. a fired reminder. Recorded so history shows why the agent
   * spoke unprompted; sent to the model as a marked user turn.
   */
  TRIGGER: "trigger",
} as const;

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

export const MESSAGE_CONTENT_TYPE = {
  TEXT: "text",
  IMAGE: "image",
  THINKING: "thinking",
  TOOL_CALL: "toolCall",
} as const;

export type MessageContentType =
  (typeof MESSAGE_CONTENT_TYPE)[keyof typeof MESSAGE_CONTENT_TYPE];

export const MESSAGE_STOP_REASON = {
  STOP: "stop",
  TOOL_USE: "toolUse",
} as const;

export type MessageStopReason =
  (typeof MESSAGE_STOP_REASON)[keyof typeof MESSAGE_STOP_REASON];
