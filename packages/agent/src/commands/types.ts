import type { ChatResponse } from "../types.js";

export interface CommandContext {
  accountId: string;
  conversationId: string;
  /** 命令后的参数文本，如 /echo hello 中的 "hello" */
  args: string;
  /** 消息到达时间戳，用于耗时统计 */
  startedAt: number;
  /** 所有已注册命令的只读快照，供 /help 使用 */
  commands: ReadonlyArray<Pick<Command, "name" | "description">>;
  /**
   * 轮转到新会话：旧会话在 DB 中存档，新消息写入新 conversationId。
   * 仅 /reset 命令调用。
   */
  rotateSession(): Promise<void>;
}

export interface Command {
  /** 命令名（不含 /），如 "reset" */
  name: string;
  /** 一行描述，用于 /help 展示 */
  description: string;
  execute(ctx: CommandContext): Promise<ChatResponse>;
}
