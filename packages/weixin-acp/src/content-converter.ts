import fs from "node:fs/promises";

import type { ChatRequest } from "@clawbot/weixin-agent-sdk";
import type { ContentBlock } from "@agentclientprotocol/sdk";

/**
 * Convert a ChatRequest into ACP ContentBlock[].
 */
export async function convertRequestToContentBlocks(
  request: ChatRequest,
): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];

  if (request.text) {
    blocks.push({ type: "text", text: request.text });
  }

  if (request.media) {
    const data = await fs.readFile(request.media.filePath);
    const base64 = data.toString("base64");
    const mimeType = request.media.mimeType;

    switch (request.media.type) {
      case "image":
        blocks.push({ type: "image", data: base64, mimeType });
        break;
      case "audio":
        blocks.push({ type: "audio", data: base64, mimeType });
        break;
      case "video":
      case "file": {
        const uri = `file://${request.media.filePath}`;
        blocks.push({
          type: "resource",
          resource: { uri, blob: base64, mimeType },
        });
        break;
      }
    }
  }

  return blocks;
}
