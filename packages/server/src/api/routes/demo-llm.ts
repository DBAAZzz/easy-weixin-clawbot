import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";

/**
 * Mock OpenAI-compatible endpoint for demo mode.
 *
 * The seeded demo provider template points at this endpoint
 * (`http://127.0.0.1:${API_PORT}/demo-llm/v1`), so agent runs (scheduled
 * tasks, heartbeats, …) produce real streamed replies without calling an
 * external LLM. It lives outside `/api/*` on purpose: that way the JWT
 * middleware does not apply, mirroring how a real LLM API would be called
 * with a bearer key rather than the admin session.
 *
 * Two protocols are implemented because the openai provider of AI SDK 6
 * defaults to the Responses API (`POST /responses`) while custom
 * OpenAI-compatible providers use `POST /chat/completions`:
 * - `/demo-llm/v1/responses`          — OpenAI Responses API (used by the agent)
 * - `/demo-llm/v1/chat/completions`   — classic Chat Completions API
 * - `/demo-llm/v1/models`             — model list (provider "ping" probe)
 */

export const DEMO_MODEL_ID = "clawbot-demo-chat";

interface ChatCompletionRequest {
  messages?: Array<{ role?: string; content?: unknown }>;
  stream?: boolean;
  model?: string;
}

interface ResponsesRequest {
  input?: unknown;
  stream?: boolean;
  model?: string;
  /** Present when the caller requests structured output (AI SDK `text.format`). */
  text?: { format?: { type?: string } };
}

function partText(part: unknown): string {
  if (typeof part === "string") return part;
  if (part && typeof part === "object") {
    const value = (part as { text?: unknown }).text;
    if (typeof value === "string") return value;
  }
  return "";
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(partText).filter(Boolean).join(" ");
  }
  return "";
}

function lastUserTextFromMessages(messages: Array<{ role?: string; content?: unknown }>): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "user") continue;
    const text = contentToText(message.content).trim();
    if (text) return text;
  }
  return "";
}

function lastUserTextFromResponsesInput(input: unknown): string {
  if (typeof input === "string") return input.trim();
  if (!Array.isArray(input)) return "";
  for (let i = input.length - 1; i >= 0; i--) {
    const item = input[i] as { role?: string; content?: unknown } | null;
    if (!item || item.role !== "user") continue;
    const text = contentToText(item.content).trim();
    if (text) return text;
  }
  return "";
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3));
}

function buildDemoReply(userText: string): string {
  const excerpt = userText.length > 80 ? `${userText.slice(0, 80)}……` : userText;
  return [
    "收到！这是一条来自演示模式的模拟回复，没有调用真实的大模型。",
    "",
    excerpt ? `你刚才说的是：「${excerpt}」。` : "",
    "",
    "当前环境里的账号、会话、消息和记忆都是预置的演示数据；你可以继续浏览各个页面，也可以在「定时任务」里启用一个任务，观察它由内置模拟模型真实执行一轮的完整过程。",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function chunkReply(text: string): string[] {
  const pieces = text.match(/[\s\S]{1,24}/g) ?? [text];
  return pieces.flatMap((piece) => piece.match(/[^\n]*\n|.+/g) ?? [piece]).filter(Boolean);
}

export function registerDemoLlmRoutes(app: Hono) {
  app.get("/demo-llm/v1/models", (c) =>
    c.json({
      object: "list",
      data: [
        {
          id: DEMO_MODEL_ID,
          object: "model",
          created: Math.floor(Date.now() / 1000),
          owned_by: "clawbot-demo",
        },
      ],
    }),
  );

  // ── Classic Chat Completions API ─────────────────────────────────────

  app.post("/demo-llm/v1/chat/completions", async (c) => {
    const body = (await c.req.json().catch(() => null)) as ChatCompletionRequest | null;
    if (!body || !Array.isArray(body.messages)) {
      return c.json(
        {
          error: {
            message: "invalid request body: messages[] is required",
            type: "invalid_request_error",
          },
        },
        400,
      );
    }

    const userText = lastUserTextFromMessages(body.messages);
    const reply = buildDemoReply(userText);
    const promptTokens = estimateTokens(userText || "ping");
    const completionTokens = estimateTokens(reply);
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    };
    const id = `chatcmpl-demo-${Date.now().toString(36)}`;
    const created = Math.floor(Date.now() / 1000);
    const model = typeof body.model === "string" && body.model.trim() ? body.model : DEMO_MODEL_ID;

    if (!body.stream) {
      return c.json({
        id,
        object: "chat.completion",
        created,
        model,
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: reply },
            finish_reason: "stop",
          },
        ],
        usage,
      });
    }

    return streamSSE(c, async (stream) => {
      const first = {
        id,
        object: "chat.completion.chunk",
        created,
        model,
        choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }],
      };
      await stream.writeSSE({ data: JSON.stringify(first) });

      for (const piece of chunkReply(reply)) {
        await stream.writeSSE({
          data: JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created,
            model,
            choices: [{ index: 0, delta: { content: piece }, finish_reason: null }],
          }),
        });
        await stream.sleep(60);
      }

      await stream.writeSSE({
        data: JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage,
        }),
      });
      await stream.writeSSE({ data: "[DONE]" });
    });
  });

  // ── OpenAI Responses API (default protocol of @ai-sdk/openai) ───────

  app.post("/demo-llm/v1/responses", async (c) => {
    const body = (await c.req.json().catch(() => null)) as ResponsesRequest | null;
    if (body === null || body.input === undefined) {
      return c.json(
        {
          error: {
            message: "invalid request body: input is required",
            type: "invalid_request_error",
          },
        },
        400,
      );
    }

    // Structured-output callers (tape extraction, …) parse the reply as JSON.
    // The only such call path in demo scope is the memory extractor, whose
    // schema allows an empty memories list.
    const formatType = body.text?.format?.type;
    const jsonMode = formatType === "json" || formatType === "json_schema";
    const userText = lastUserTextFromResponsesInput(body.input);
    const reply = jsonMode ? '{"memories":[]}' : buildDemoReply(userText);
    const usage = {
      input_tokens: estimateTokens(userText || "ping"),
      output_tokens: estimateTokens(reply),
    };
    const id = `resp_demo_${Date.now().toString(36)}`;
    const createdAt = Math.floor(Date.now() / 1000);
    const model = typeof body.model === "string" && body.model.trim() ? body.model : DEMO_MODEL_ID;
    const messageId = `msg_${id}`;

    const messageItem = {
      type: "message",
      role: "assistant",
      id: messageId,
      status: "completed",
      content: [{ type: "output_text", text: reply, annotations: [] }],
    };
    const responseObject = {
      id,
      object: "response",
      created_at: createdAt,
      model,
      status: "completed",
      output: [messageItem],
      usage: {
        input_tokens: usage.input_tokens,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: usage.output_tokens,
        output_tokens_details: { reasoning_tokens: 0 },
      },
    };

    if (!body.stream) {
      return c.json(responseObject);
    }

    return streamSSE(c, async (stream) => {
      await stream.writeSSE({
        event: "response.created",
        data: JSON.stringify({
          type: "response.created",
          response: { id, created_at: createdAt, model },
        }),
      });
      await stream.writeSSE({
        event: "response.output_item.added",
        data: JSON.stringify({
          type: "response.output_item.added",
          output_index: 0,
          item: { type: "message", id: messageId, role: "assistant", status: "in_progress", content: [] },
        }),
      });

      for (const piece of chunkReply(reply)) {
        await stream.writeSSE({
          event: "response.output_text.delta",
          data: JSON.stringify({
            type: "response.output_text.delta",
            item_id: messageId,
            delta: piece,
          }),
        });
        await stream.sleep(60);
      }

      await stream.writeSSE({
        event: "response.output_item.done",
        data: JSON.stringify({
          type: "response.output_item.done",
          output_index: 0,
          item: messageItem,
        }),
      });
      await stream.writeSSE({
        event: "response.completed",
        data: JSON.stringify({ type: "response.completed", response: responseObject }),
      });
    });
  });
}
