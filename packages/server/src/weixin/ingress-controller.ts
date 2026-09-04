import {
  createDeliveryId,
  createOutboundFactEventId,
  createRunEventId,
  createRunId,
  FactLedgerIdConflictError,
  FactLedgerIdempotencyConflictError,
  type AgentRunStore,
  type ConversationEventStore,
} from "@clawbot/agent";
import {
  weixinIngressAppendTotal,
  weixinIngressDispatchTotal,
  weixinIngressIdentityTotal,
} from "@clawbot/observability";
import type { ValidatedWeixinInbound, WeixinIngressLifecycle } from "@clawbot/weixin-agent-sdk";
import { createModuleLogger, getErrorFields } from "../logger.js";

import type { ServerWeixinAgent } from "../agent.js";
import { PrismaAgentRunStore } from "../db/agent-run-store.impl.js";
import { PrismaConversationEventStore } from "../db/conversation-event-store.impl.js";
import { WeixinIngressDispatchStore } from "../db/weixin-ingress-dispatch-store.js";
import { mapWeixinInboundEvent } from "./inbound-mapper.js";

const controllerLogger = createModuleLogger("ingress-controller");

type IngressDispatchControllerStore = Pick<
  WeixinIngressDispatchStore,
  "createAndClaim" | "get" | "settle"
>;

export function createWeixinIngressLifecycle(deps: {
  accountId: string;
  /** Startup snapshot from WeixinIngressRolloutStore. Disabled lifecycle wiring fails closed. */
  rolloutEnabled: boolean;
  /** Startup snapshot from RunLedgerRolloutStore: enables outbound delivery fact recording. */
  runLedgerEnabled?: boolean;
  agent: ServerWeixinAgent;
  eventStore?: ConversationEventStore;
  dispatchStore?: IngressDispatchControllerStore;
  agentRunStore?: AgentRunStore;
}): WeixinIngressLifecycle {
  const eventStore = deps.eventStore ?? new PrismaConversationEventStore();
  const dispatchStore = deps.dispatchStore ?? new WeixinIngressDispatchStore();
  const agentRunStore = deps.agentRunStore ?? new PrismaAgentRunStore();

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

    async settle({ receiptId, outcome, errorCode, deliveryReport }) {
      await dispatchStore.settle(receiptId, outcome, errorCode);
      weixinIngressDispatchTotal.inc({ result: outcome });
      if (!deps.runLedgerEnabled || !deliveryReport) return;
      await recordDeliveryFacts({
        accountId: deps.accountId,
        receiptId,
        deliveryReport,
        eventStore,
        agentRunStore,
      });
    },
  };
}

/**
 * Outbound delivery facts (Phase 4 design §6.3). Delivery run events are only
 * appended when the deterministic `delivery_requested` event exists — degraded
 * runs keep a closed chain — while the outbound conversation fact is always
 * recorded because platform delivery truth is independent of ledger health.
 */
async function recordDeliveryFacts(input: {
  accountId: string;
  receiptId: string;
  deliveryReport: {
    ok: boolean;
    channelMessageId?: string;
    textSent?: string;
    error?: string;
  };
  eventStore: ConversationEventStore;
  agentRunStore: AgentRunStore;
}): Promise<void> {
  const { accountId, receiptId, deliveryReport } = input;
  const source = await input.eventStore.getById(receiptId).catch(() => null);
  if (!source || source.accountId !== accountId) return;

  const runId = createRunId(accountId, receiptId);
  const deliveryId = createDeliveryId(accountId, receiptId);
  const now = new Date();
  const occurredAt = now.toISOString();

  if (deliveryReport.ok) {
    const requested = await input.agentRunStore
      .getById(
        createRunEventId(accountId, runId, "delivery_requested", deliveryId),
      )
      .catch(() => null);
    if (requested) {
      await input.agentRunStore
        .append({
          eventType: "delivery_succeeded",
          schemaVersion: 1,
          accountId,
          conversationStreamId: source.streamId,
          runId,
          occurredAt,
          causationId: deliveryId,
          correlationId: receiptId,
          eventId: createRunEventId(accountId, runId, "delivery_succeeded", deliveryId),
          payload: {
            deliveryId,
            ...(deliveryReport.channelMessageId
              ? { channelMessageId: deliveryReport.channelMessageId }
              : {}),
          },
        })
        .catch((error) => {
          controllerLogger.warn({ ...getErrorFields(error), runId }, "delivery_succeeded append failed");
        });
    }
  } else {
    const requested = await input.agentRunStore
      .getById(createRunEventId(accountId, runId, "delivery_requested", deliveryId))
      .catch(() => null);
    if (requested) {
      await input.agentRunStore
        .append({
          eventType: "delivery_failed",
          schemaVersion: 1,
          accountId,
          conversationStreamId: source.streamId,
          runId,
          occurredAt,
          causationId: deliveryId,
          correlationId: receiptId,
          eventId: createRunEventId(accountId, runId, "delivery_failed", deliveryId),
          payload: { deliveryId, error: deliveryReport.error ?? "delivery_failed", retryable: false },
        })
        .catch((error) => {
          controllerLogger.warn({ ...getErrorFields(error), runId }, "delivery_failed append failed");
        });
    }
  }

  const outboundFact = deliveryReport.ok
    ? ({
        eventId: createOutboundFactEventId(accountId, receiptId, "delivered"),
        accountId,
        streamId: source.streamId,
        eventType: "outbound_message_delivered" as const,
        schemaVersion: 1 as const,
        occurredAt,
        receivedAt: occurredAt,
        actor: { kind: "agent" as const, id: accountId },
        causationId: receiptId,
        correlationId: receiptId,
        payload: {
          deliveryId,
          channel: "weixin",
          ...(deliveryReport.channelMessageId
            ? { channelMessageId: deliveryReport.channelMessageId }
            : {}),
          text: deliveryReport.textSent ?? "",
          attachmentRefs: [],
        },
      })
    : ({
        eventId: createOutboundFactEventId(accountId, receiptId, "delivery_failed"),
        accountId,
        streamId: source.streamId,
        eventType: "outbound_message_delivery_failed" as const,
        schemaVersion: 1 as const,
        occurredAt,
        receivedAt: occurredAt,
        actor: { kind: "agent" as const, id: accountId },
        causationId: receiptId,
        correlationId: receiptId,
        payload: {
          deliveryId,
          channel: "weixin",
          reason: deliveryReport.error ?? "delivery_failed",
          retryable: false,
        },
      });
  await input.eventStore.append(outboundFact).catch((error) => {
    controllerLogger.warn(
      { ...getErrorFields(error), receiptId },
      "outbound delivery fact append failed",
    );
  });
}
