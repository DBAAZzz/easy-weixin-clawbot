import {
  createAgentRunner,
  createSkillInstaller,
  createSkillRegistry,
  createToolInstaller,
  createToolRegistry,
} from "@clawbot/agent";
import {
  getModel,
  type AssistantMessage,
  type ImageContent,
  type Message,
  type Model,
  type TextContent,
  type ToolResultMessage,
  type UserMessage,
} from "@mariozechner/pi-ai";
import { readFileSync } from "node:fs";
import type { ChatResponse } from "weixin-agent-sdk";
import { ensureHistoryLoaded, getHistory, nextSeq, rollbackMessages } from "./conversation.js";
import { queuePersistMessage } from "./db/messages.js";
import { ensurePrismaUrls } from "./db/prisma.js";
import { log } from "./logger.js";
import {
  SKILLS_BUILTIN_DIR,
  SKILLS_USER_DIR,
  TOOLS_BUILTIN_DIR,
  TOOLS_USER_DIR,
} from "./paths.js";
import { detectImageMime } from "./utils/index.js";

const PROVIDER = process.env.LLM_PROVIDER ?? "anthropic";
const MODEL_ID = process.env.LLM_MODEL ?? "claude-sonnet-4-20250514";
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ?? "你是一个微信智能助手，回答简洁、友好。";

/**
 * Explicit API key from .env (LLM_API_KEY or legacy KEY).
 * Passed directly to complete() so pi-ai skips its own env-var lookup.
 */
const EXPLICIT_API_KEY = process.env.LLM_API_KEY ?? process.env.KEY;

/** Validate required env vars at startup and print a summary. */
export function validateConfig() {
  const lines = [
    `  provider : ${PROVIDER}`,
    `  model    : ${MODEL_ID}`,
    `  api key  : ${EXPLICIT_API_KEY ? `${EXPLICIT_API_KEY.slice(0, 6)}…` : "(none — using provider env var)"}`,
    `  api port : ${process.env.API_PORT ?? "3001"}`,
  ];
  console.log("[config]\n" + lines.join("\n"));

  if (!EXPLICIT_API_KEY) {
    const envMap: Record<string, string> = {
      anthropic: "ANTHROPIC_API_KEY",
      openai: "OPENAI_API_KEY",
      "kimi-coding": "KIMI_API_KEY",
      google: "GOOGLE_API_KEY",
    };
    const expected = envMap[PROVIDER];
    if (expected && !process.env[expected]) {
      console.warn(
        `[config] WARNING: LLM_API_KEY not set and ${expected} is missing — API calls will fail`
      );
    }
  }

  if (!process.env.DATABASE_URL && !process.env.SUPABASE_PASSWORD) {
    console.warn(
      "[config] WARNING: Prisma database env vars missing — persistence/API queries will fail"
    );
  }

  if (!process.env.API_SECRET) {
    console.warn("[config] WARNING: API_SECRET missing — web API auth will reject all requests");
  }

  try {
    ensurePrismaUrls();
  } catch (error) {
    console.warn(`[config] WARNING: ${(error as Error).message}`);
  }
}

function buildMoonshotModel(): Model<"openai-completions"> {
  const id = MODEL_ID;
  const baseUrl =
    PROVIDER === "kimi"
      ? "https://api.kimi.ai/v1"
      : "https://api.moonshot.cn/v1";
  return {
    id,
    name: `Moonshot ${id}`,
    api: "openai-completions",
    provider: "moonshot",
    baseUrl,
    reasoning: false,
    input: ["text", "image"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const model: Model<any> = (() => {
  const resolvedModel =
    PROVIDER === "moonshot" || PROVIDER === "kimi"
      ? buildMoonshotModel()
      : (getModel as any)(PROVIDER, MODEL_ID);
  if (!resolvedModel) {
    throw new Error(
      `[ai] Unknown provider/model: LLM_PROVIDER="${PROVIDER}" LLM_MODEL="${MODEL_ID}". ` +
        `Check .env — for Moonshot use LLM_PROVIDER=moonshot, for Kimi K2 use LLM_PROVIDER=kimi-coding with LLM_MODEL=kimi-k2-thinking or k2p5.`
    );
  }
  return resolvedModel;
})();

export const toolRegistry = createToolRegistry();
export const toolInstaller = createToolInstaller(toolRegistry);
export const skillRegistry = createSkillRegistry();
export const skillInstaller = createSkillInstaller(skillRegistry);

const loadedTools = await toolInstaller.initialize(TOOLS_BUILTIN_DIR, TOOLS_USER_DIR);
const loadedSkills = await skillInstaller.initialize(SKILLS_BUILTIN_DIR, SKILLS_USER_DIR);

console.log(`[tools] loaded: ${loadedTools.loaded.join(", ") || "(none)"}`);
for (const failure of loadedTools.failed) {
  console.warn(`[tools] compile-error ${failure.filePath}: ${failure.error}`);
}

console.log(`[skills] loaded: ${loadedSkills.loaded.join(", ") || "(none)"}`);
for (const failure of loadedSkills.failed) {
  console.warn(`[skills] compile-error ${failure.filePath}: ${failure.error}`);
}

const runner = createAgentRunner(
  {
    model,
    systemPrompt: SYSTEM_PROMPT,
    apiKey: EXPLICIT_API_KEY,
  },
  toolRegistry,
  skillRegistry,
);

function extractAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function extractToolResultText(message: ToolResultMessage): string {
  const text = message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text || "[non-text tool result]";
}

function finalizeReply(text: string, fallback: string): ChatResponse {
  return { text: text || fallback };
}

export async function chat(
  accountId: string,
  conversationId: string,
  text: string,
  media?: {
    type: "image" | "audio" | "video" | "file";
    filePath: string;
    mimeType: string;
    fileName?: string;
  },
): Promise<ChatResponse> {
  await ensureHistoryLoaded(accountId, conversationId);
  const history = getHistory(accountId, conversationId);

  const userContent: (TextContent | ImageContent)[] = [
    { type: "text", text: text || "(no text)" },
  ];

  if (media?.type === "image") {
    const buf = readFileSync(media.filePath);
    const mimeType = detectImageMime(buf) ?? media.mimeType;
    const data = buf.toString("base64");
    if (mimeType !== media.mimeType) {
      console.log(`[ai] image mimeType corrected: ${media.mimeType} → ${mimeType}`);
    }
    userContent.push({
      type: "image",
      data,
      mimeType: mimeType as ImageContent["mimeType"],
    });
  }

  const userMessage: UserMessage = {
    role: "user",
    content: userContent,
    timestamp: Date.now(),
  };

  history.push(userMessage);
  queuePersistMessage({
    accountId,
    conversationId,
    message: userMessage,
    seq: nextSeq(accountId, conversationId),
    mediaSourcePath: media?.type === "image" ? media.filePath : undefined,
  });

  const pendingToolArgs = new Map<string, Record<string, unknown>>();
  const startedAt = Date.now();
  let rounds = 0;
  let messagesAddedInRun = 0;

  const result = await runner.run(history, {
    onRoundStart(round) {
      rounds = round;
      log.llm(accountId, round);
    },

    onMessage(message: Message) {
      // Skip persisting empty assistant messages (error responses from provider)
      const isEmptyAssistant =
        message.role === "assistant" && message.content.length === 0;

      history.push(message);
      messagesAddedInRun++;

      if (!isEmptyAssistant) {
        queuePersistMessage({
          accountId,
          conversationId,
          message,
          seq: nextSeq(accountId, conversationId),
        });
      }

      if (message.role === "assistant") {
        for (const block of message.content) {
          if (block.type === "toolCall") {
            pendingToolArgs.set(block.id, block.arguments);
          }
        }
        return;
      }

      if (message.role === "toolResult") {
        log.tool(
          message.toolName,
          pendingToolArgs.get(message.toolCallId) ?? {},
          extractToolResultText(message),
        );
        pendingToolArgs.delete(message.toolCallId);
      }
    },
  });

  if (result.status !== "aborted") {
    log.done(accountId, rounds, Date.now() - startedAt);
  }

  switch (result.status) {
    case "completed": {
      const msg = result.finalMessage;
      const text = extractAssistantText(msg);

      // If the LLM returned an error or completely empty response, roll back
      // ALL messages added during this run (including the user message) from
      // both memory and DB so the conversation stays clean.
      if (!text && msg.stopReason !== "stop") {
        console.warn(
          `[ai] error response — rolling back ${messagesAddedInRun} message(s) from memory + DB. ` +
          `stopReason: ${msg.stopReason} | errorMessage: ${(msg as any).errorMessage ?? "(none)"}`,
        );
        await rollbackMessages(accountId, conversationId, messagesAddedInRun);
      }

      return finalizeReply(text, "抱歉，出了点问题，请稍后再试。");
    }
    case "max_rounds":
      return finalizeReply(extractAssistantText(result.lastMessage), "抱歉，这次问题我还没处理完。");
    case "aborted":
      return { text: "请求已取消。" };
  }
}
