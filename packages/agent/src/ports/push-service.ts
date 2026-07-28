/**
 * PushService — agent-defined interface for proactive message pushing.
 *
 * Implemented by server (WeChat SDK bridge) and injected at startup.
 */

import { createPortSlot } from "./slot.js";

export interface PushOptions {
  /**
   * Whether to append the pushed text to conversation history.
   * Defaults to true. Pass false when the caller already ran chat() in the
   * target conversation — the assistant message is persisted there, and
   * appending again would duplicate it.
   */
  recordHistory?: boolean;
}

export interface PushService {
  sendProactiveMessage(
    accountId: string,
    conversationId: string,
    text: string,
    opts?: PushOptions,
  ): Promise<void>;
}

export const { set: setPushService, get: getPushService } =
  createPortSlot<PushService>("PushService", "setPushService");
