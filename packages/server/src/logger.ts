import { getTraceId } from "@clawbot/observability";

const RESET = "\x1b[0m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

function ts() {
  return DIM + new Date().toLocaleTimeString("zh-CN", { hour12: false }) + RESET;
}

function prefix(color: string, tag: string) {
  const traceId = getTraceId();
  const traceSuffix =
    traceId === "no-trace" ? `${DIM}[trace:none]${RESET}` : `${DIM}[trace:${traceId.slice(-8)}]${RESET}`;
  return `${ts()} ${color}[${tag}]${RESET} ${traceSuffix}`;
}

function acct(accountId: string) {
  return `${DIM}(${accountId.slice(-6)})${RESET}`;
}

export const log = {
  /** 收到用户消息 */
  recv(accountId: string, conversationId: string, text: string, mediaType?: string) {
    const media = mediaType ? ` ${DIM}+${mediaType}${RESET}` : "";
    console.log(
      `${prefix(CYAN, "RECV")} ${acct(accountId)} ${DIM}${conversationId}${RESET}${media} ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`
    );
  },

  /** 开始调用 LLM（含账号上下文） */
  llm(accountId: string, round: number) {
    console.log(`${prefix(YELLOW, "LLM ")} ${acct(accountId)} round ${round}`);
  },

  /** 工具调用 */
  tool(name: string, args: Record<string, unknown>, result: string) {
    console.log(
      `${prefix(MAGENTA, "TOOL")} ${name}(${JSON.stringify(args)}) → ${result.slice(0, 120)}`
    );
  },

  /** 回复用户 */
  send(accountId: string, conversationId: string, text: string) {
    console.log(
      `${prefix(GREEN, "SEND")} ${acct(accountId)} ${DIM}${conversationId}${RESET} ${text.slice(0, 80)}${text.length > 80 ? "…" : ""}`
    );
  },

  /** 清除会话 */
  clear(accountId: string, conversationId: string) {
    console.log(`${prefix(DIM, "CLR ")} ${acct(accountId)} ${conversationId}`);
  },

  /** LLM 完成（含耗时） */
  done(accountId: string, rounds: number, ms: number) {
    console.log(`${prefix(GREEN, "DONE")} ${acct(accountId)} ${rounds} round(s) ${DIM}${ms}ms${RESET}`);
  },

  /** 错误 */
  error(context: string, err: unknown) {
    console.error(`${prefix(RED, "ERR ")} ${context}`, err);
  },
};
