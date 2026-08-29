import {
  FactLedgerIdConflictError,
  FactLedgerIdempotencyConflictError,
  type ConversationEventStore,
} from "@clawbot/agent";
import {
  weixinIngressAppendTotal,
  weixinIngressDispatchTotal,
  weixinIngressIdentityTotal,
} from "@clawbot/observability";
import type { ValidatedWeixinInbound, WeixinIngressLifecycle } from "@clawbot/weixin-agent-sdk";
import type { ServerWeixinAgent } from "../agent.js";
import { PrismaConversationEventStore } from "../db/conversation-event-store.impl.js";
import { WeixinIngressDispatchStore } from "../db/weixin-ingress-dispatch-store.js";
import { mapWeixinInboundEvent } from "./inbound-mapper.js";

type IngressDispatchControllerStore = Pick<
  WeixinIngressDispatchStore,
  "createAndClaim" | "get" | "settle"
>;

export function createWeixinIngressLifecycle(deps: {
  accountId: string;
  /** Startup snapshot from WeixinIngressRolloutStore. Disabled lifecycle wiring fails closed. */
  rolloutEnabled: boolean;
  agent: ServerWeixinAgent;
  eventStore?: ConversationEventStore;
  dispatchStore?: IngressDispatchControllerStore;
}): WeixinIngressLifecycle {
  const eventStore = deps.eventStore ?? new PrismaConversationEventStore();
  const dispatchStore = deps.dispatchStore ?? new WeixinIngressDispatchStore();

  return {
    async accept(input: ValidatedWeixinInbound) {
      // Returning skip here would advance the SDK cursor and silently drop a
      // message. A wiring error must therefore fail closed instead.
      if (!deps.rolloutEnabled) throw new Error("weixin_ingress_rollout_disabled");
      weixinIngressIdentityTotal.inc({
        source: input.messageId === undefined ? "client_id_seq" : "message_id",
      });
      const eventInput = mapWeixinInboundEvent(deps.accountId, input);
      try {
        const appended = await eventStore.append(eventInput);
        weixinIngressAppendTotal.inc({ result: appended.appended ? "appended" : "duplicate" });
        const claimed = await dispatchStore.createAndClaim(appended.value.eventId, deps.accountId);
        if (!claimed) weixinIngressDispatchTotal.inc({ result: "skipped" });
        return {
          receiptId: appended.value.eventId,
          disposition: claimed ? "process" : "skip",
        };
      } catch (error) {
        const conflict =
          error instanceof FactLedgerIdConflictError ||
          error instanceof FactLedgerIdempotencyConflictError;
        weixinIngressAppendTotal.inc({ result: conflict ? "conflict" : "failed" });
        if (conflict) weixinIngressIdentityTotal.inc({ source: "conflict" });
        throw error;
      }
    },

    async invokeAgent({ receiptId, request }) {
      const receipt = await dispatchStore.get(receiptId);
      if (!receipt || receipt.accountId !== deps.accountId || receipt.status !== "processing") {
        throw new Error("invalid_ingress_receipt");
      }
      const source = await eventStore.getById(receipt.eventId);
      if (!source || source.accountId !== deps.accountId) {
        throw new Error("invalid_ingress_source_event");
      }
      return deps.agent.chatFromIngress(request, source);
    },

    async invokeClear({ receiptId, conversationId }) {
      const receipt = await dispatchStore.get(receiptId);
      if (!receipt || receipt.accountId !== deps.accountId || receipt.status !== "processing") {
        throw new Error("invalid_ingress_receipt");
      }
      await deps.agent.clearFromIngress(receipt.eventId, conversationId);
    },

    async settle({ receiptId, outcome, errorCode }) {
      await dispatchStore.settle(receiptId, outcome, errorCode);
      weixinIngressDispatchTotal.inc({ result: outcome });
    },
  };
}
