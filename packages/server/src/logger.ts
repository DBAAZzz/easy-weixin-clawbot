import { getTraceId } from "@clawbot/observability";
import pino from "pino";
import type { Logger } from "pino";

const isProduction = process.env.NODE_ENV === "production";
const level = process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug");

export const logger = pino({
  base: null,
  level,
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin() {
    const traceId = getTraceId();
    return traceId === "no-trace" ? {} : { traceId };
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "hono-pino/debug-log",
          options: {
            colorEnabled: true,
            normalLogFormat: "[{time}] {levelLabel} - {msg} {bindings}",
            httpLogFormat:
              "[{time}] {levelLabel} {req.method} {req.url} {res.status} ({responseTime}ms) - {msg} {bindings}",
          },
        },
      }),
});

export function createModuleLogger(module: string): Logger {
  return logger.child({ module });
}

export function getErrorFields(error: unknown): Record<string, unknown> {
  return error instanceof Error ? { err: error } : { error };
}

function preview(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const chatLogger = createModuleLogger("chat");

export const log = {
  recv(accountId: string, conversationId: string, text: string, mediaType?: string) {
    chatLogger.info(
      {
        event: "recv",
        accountId,
        conversationId,
        mediaType: mediaType ?? null,
        textLength: text.length,
        textPreview: preview(text, 80),
      },
      "收到用户消息",
    );
  },

  llm(accountId: string, round: number) {
    chatLogger.info({ event: "llm", accountId, round }, "开始调用大模型");
  },

  tool(name: string, args: Record<string, unknown>, result: string) {
    chatLogger.info(
      {
        event: "tool",
        toolName: name,
        args,
        resultLength: result.length,
        resultPreview: preview(result, 120),
      },
      "工具调用完成",
    );
  },

  send(accountId: string, conversationId: string, text: string) {
    chatLogger.info(
      {
        event: "send",
        accountId,
        conversationId,
        textLength: text.length,
        textPreview: preview(text, 80),
      },
      "消息发送完成",
    );
  },

  clear(accountId: string, conversationId: string) {
    chatLogger.info(
      { event: "clear", accountId, conversationId },
      "会话已清空",
    );
  },

  done(accountId: string, rounds: number, ms: number) {
    chatLogger.info(
      { event: "done", accountId, rounds, durationMs: ms },
      "对话处理完成",
    );
  },

  error(context: string, error: unknown) {
    chatLogger.error(
      { event: "error", context, ...getErrorFields(error) },
      "服务操作失败",
    );
  },
};
