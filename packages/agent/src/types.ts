/**
 * Agent-owned types — decoupled from any specific channel SDK.
 */

/** Response from agent chat, independent of transport layer. */
export interface ChatResponse {
  /** Reply text (may contain markdown). */
  text?: string;
  /** Reply media file. */
  media?: {
    type: "image" | "video" | "file";
    /** Local file path or HTTPS URL. */
    url: string;
    /** Filename hint (for file attachments). */
    fileName?: string;
  };
}

/** Inbound media attached to a chat message. */
export interface ChatMedia {
  type: "image" | "audio" | "video" | "file";
  filePath: string;
  mimeType: string;
  fileName?: string;
}
