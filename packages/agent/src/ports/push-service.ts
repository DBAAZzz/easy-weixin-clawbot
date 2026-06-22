/**
 * PushService — agent-defined interface for proactive message pushing.
 *
 * Implemented by server (WeChat SDK bridge) and injected at startup.
 */

import { createPortSlot } from "./slot.js";

export interface PushService {
  sendProactiveMessage(accountId: string, conversationId: string, text: string): Promise<void>;
}

export const { set: setPushService, get: getPushService } =
  createPortSlot<PushService>("PushService", "setPushService");
