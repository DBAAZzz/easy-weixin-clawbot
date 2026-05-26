import { generateText } from "ai";
import { MESSAGE_ROLE } from "@clawbot/shared";
import type { AgentMessage, AssistantMessage, UserMessage } from "../llm/types.js";
import { resolveConfiguredModel, resolveModel } from "../model-resolver.js";
import { getPromptAssets } from "../prompts/port.js";
import { PROMPT_PROFILES } from "../prompts/profiles.js";
import { getHistory } from "./history.js";
import { extractAssistantText, extractTextContent } from "../utils/chat-utils.js";

const TITLE_MAX_CHARS = 20;
const TITLE_TIMEOUT_MS = 15_000;
const TITLE_MAX_OUTPUT_TOKENS = 64;
const FALLBACK_TITLE = "未命名会话";

export interface ConversationTitleTurn {
  userText: string;
  assistantText: string;
}

function truncateTitle(title: string): string {
  return Array.from(title).slice(0, TITLE_MAX_CHARS).join("");
}

function normalizeTitle(raw: string): string | null {
  const firstLine = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  if (!firstLine) {
    return null;
  }

  const cleaned = firstLine
    .replace(/^["'“”‘’「」『』《》]+|["'“”‘’「」『』《》。！？!?,，、：:；;]+$/g, "")
    .replace(/^标题\s*[:：]\s*/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned === FALLBACK_TITLE) {
    return null;
  }

  return truncateTitle(cleaned);
}

function buildFirstExchangePrompt(userText: string, assistantText: string): string {
  return [
    "请为以下第一次完整会话生成标题。",
    "",
    "用户：",
    userText || "(空)",
    "",
    "助手：",
    assistantText || "(空)",
  ].join("\n");
}

function extractUserText(message: UserMessage): string {
  return typeof message.content === "string"
    ? message.content.trim()
    : extractTextContent(message.content);
}

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === MESSAGE_ROLE.ASSISTANT;
}

export async function generateConversationTitle(
  accountId: string,
  conversationId: string,
  turn?: ConversationTitleTurn,
): Promise<string | null> {
  let userText = turn?.userText.trim() ?? "";
  let assistantText = turn?.assistantText.trim() ?? "";

  if (!userText || !assistantText) {
    const history = getHistory(accountId, conversationId);
    const firstUser = history.find((message) => message.role === MESSAGE_ROLE.USER);
    if (!firstUser) {
      return null;
    }

    const firstAssistant = history.find(
      (message): message is AssistantMessage =>
        isAssistantMessage(message) &&
        message.timestamp >= firstUser.timestamp &&
        extractAssistantText(message).length > 0,
    );
    if (!firstAssistant) {
      return null;
    }

    userText = userText || extractUserText(firstUser);
    assistantText = assistantText || extractAssistantText(firstAssistant);
  }

  if (!userText && !assistantText) {
    return null;
  }

  const extractionModel = await resolveConfiguredModel(accountId, conversationId, "extraction");
  const model = extractionModel ?? (await resolveModel(accountId, conversationId, "chat"));
  const systemPrompt = getPromptAssets().get(PROMPT_PROFILES.conversation_title.systemPromptKey);

  const result = await generateText({
    model: model.model,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: buildFirstExchangePrompt(userText, assistantText),
      },
    ],
    maxOutputTokens: TITLE_MAX_OUTPUT_TOKENS,
    abortSignal: AbortSignal.timeout(TITLE_TIMEOUT_MS),
  });

  return normalizeTitle(result.text);
}
