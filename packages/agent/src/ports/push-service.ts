/**
 * PushService — agent-defined interface for proactive message pushing.
 *
 * Implemented by server (WeChat SDK bridge) and injected at startup.
 */

export interface PushService {
  sendProactiveMessage(accountId: string, conversationId: string, text: string): Promise<void>;
}

let service: PushService | null = null;

export function setPushService(impl: PushService): void {
  service = impl;
}

export function getPushService(): PushService {
  if (!service) throw new Error("PushService not initialized — call setPushService() at startup");
  return service;
}
