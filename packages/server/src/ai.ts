import {
  createCompositeToolRegistry,
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
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { ChatResponse } from "@clawbot/weixin-agent-sdk";
import { isDebugEnabled } from "./commands/debug.js";
import { ensureHistoryLoaded, getHistory, nextSeq, rollbackMessages } from "./conversation.js";
import { queuePersistMessage } from "./db/messages.js";
import { ensurePrismaUrls } from "./db/prisma-env.js";
import { log } from "./logger.js";
import {
  DOWNLOADS_DIR,
  SKILLS_BUILTIN_DIR,
  SKILLS_USER_DIR,
  TOOLS_BUILTIN_DIR,
  TOOLS_USER_DIR,
} from "./paths.js";
import { detectImageMime } from "./utils/index.js";

mkdirSync(DOWNLOADS_DIR, { recursive: true });

const PROVIDER = process.env.LLM_PROVIDER ?? "anthropic";
const MODEL_ID = process.env.LLM_MODEL ?? "claude-sonnet-4-20250514";
const BASE_SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ?? "你是一个微信智能助手，回答简洁、友好。";

const MEDIA_SEND_INSTRUCTIONS = `
## 发送媒体文件

你可以向用户发送图片、视频或文件。当你需要发送媒体时，在回复末尾加上标记：

\`[send_file:<类型>:<文件路径>]\`

类型：image / video / file

示例：
- 发送图片：[send_file:image:/path/to/photo.jpg]
- 发送视频：[send_file:video:/path/to/video.mp4]
- 发送文件：[send_file:file:/path/to/doc.pdf]

**使用 opencli 下载内容后发送给用户的流程：**
1. 调用 opencli download 命令时，必须加 --output ${DOWNLOADS_DIR} 指定下载目录
2. 使用 -f json 获取结构化输出，从中提取实际保存的文件路径
3. 在回复中加上 [send_file:类型:文件路径] 标记将文件发给用户

注意：标记会被自动解析移除，用户不会看到。每条回复只能发送一个媒体文件。
`.trim();

const SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT}\n\n${MEDIA_SEND_INSTRUCTIONS}`;

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

export const localToolRegistry = createToolRegistry();
export const mcpToolRegistry = createToolRegistry();
export const toolRegistry = createCompositeToolRegistry(localToolRegistry, mcpToolRegistry);
export const toolInstaller = createToolInstaller(localToolRegistry);
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

const SEND_FILE_RE = /\[send_file:(image|video|file):([^\]]+)\]/;

const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif"];
const VIDEO_EXTS = [".mp4", ".mov", ".webm", ".mkv", ".avi"];
const ALL_EXTS = [...IMAGE_EXTS, ...VIDEO_EXTS, ".pdf", ".zip"];

/**
 * Resolve a file path that the LLM may have written with the wrong extension.
 * Returns the corrected path if found, or null if the file truly doesn't exist.
 */
function resolveFilePath(filePath: string): string | null {
  if (existsSync(filePath)) return filePath;

  const dir = dirname(filePath);
  const nameWithoutExt = basename(filePath, extname(filePath));

  // Try alternate extensions in the same directory
  for (const ext of ALL_EXTS) {
    const candidate = join(dir, nameWithoutExt + ext);
    if (existsSync(candidate)) return candidate;
  }

  // Fallback: scan the directory for any file starting with the stem
  try {
    const entries = readdirSync(dir);
    const match = entries.find(
      (e) => e === nameWithoutExt || e.startsWith(nameWithoutExt + "."),
    );
    if (match) return join(dir, match);
  } catch {
    // dir doesn't exist or isn't readable
  }

  return null;
}

function extractMediaFromText(text: string): {
  cleanText: string;
  media?: ChatResponse["media"];
} {
  const match = text.match(SEND_FILE_RE);
  if (!match) return { cleanText: text };

  const type = match[1] as "image" | "video" | "file";
  const url = match[2].trim();
  const cleanText = text.replace(SEND_FILE_RE, "").trim();

  // Validate the file exists before handing it to the SDK.
  // If missing, try to find a same-named file with a different extension
  // (LLM often guesses .jpg but the actual file may be .png / .webp etc.)
  const resolvedUrl = resolveFilePath(url);
  if (!resolvedUrl) {
    console.error(`[ai] send_file: path not found — ${url}`);
    const hint = `\n\n(⚠️ 文件发送失败：路径不存在 ${url})`;
    return { cleanText: cleanText + hint };
  }

  if (resolvedUrl !== url) {
    console.log(`[ai] send_file: extension corrected ${url} → ${resolvedUrl}`);
  }

  return { cleanText, media: { type, url: resolvedUrl } };
}

function finalizeReply(
  text: string,
  fallback: string,
  debug?: { accountId: string; conversationId: string; startedAt: number; rounds: number },
): ChatResponse {
  const raw = text || fallback;
  const { cleanText, media } = extractMediaFromText(raw);

  let finalText = cleanText || undefined;
  if (finalText && debug && isDebugEnabled(debug.accountId, debug.conversationId)) {
    const elapsed = Date.now() - debug.startedAt;
    finalText += `\n\n---\n⏱ ${debug.rounds} round(s), ${elapsed}ms`;
  }

  const response: ChatResponse = { text: finalText };
  if (media) response.media = media;
  return response;
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
  startedAt = Date.now(),
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

      return finalizeReply(text, "抱歉，出了点问题，请稍后再试。", { accountId, conversationId, startedAt, rounds });
    }
    case "max_rounds":
      return finalizeReply(extractAssistantText(result.lastMessage), "抱歉，这次问题我还没处理完。", { accountId, conversationId, startedAt, rounds });
    case "aborted":
      return { text: "请求已取消。" };
  }
}
