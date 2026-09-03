/**
 * Proactive outbound fact writes (Phase 6 design §5.2).
 *
 * heartbeat / scheduler engines record push outcomes into the fact ledger via
 * ports (L4 → L1 is a legal edge). Two different streams are involved and must
 * never be conflated:
 *
 * - run events (delivery_succeeded / delivery_failed) belong to the trigger
 *   run's **execution stream** (heartbeat: pulse.conversationId, scheduler:
 *   the isolated `scheduler:{seq}` session);
 * - the outbound conversation fact belongs to the **real target conversation**
 *   (identical for heartbeat; task.conversationId for scheduler).
 *
 * Every write is fail-open: a ledger failure only costs the fact, never the
 * push (which already happened) and never the turn.
 */

import { proactiveOutboundTotal } from "@clawbot/observability";
import type { ConversationEventStore } from "../ports/conversation-event-store.js";
import type { AgentRunStore } from "../ports/agent-run-store.js";
import { getConversationEventStore } from "../ports/conversation-event-store.js";
import { getAgentRunStore } from "../ports/agent-run-store.js";
import {
  AGENT_RUN_EVENT_TYPE,
  CONVERSATION_EVENT_TYPE,
} from "../shared/fact-ledger/contracts.js";
import {
  createDeliveryId,
  createOutboundFactEventId,
  createRunEventId,
} from "../shared/fact-ledger/ids.js";

export interface ProactiveOutboundInput {
  accountId: string;
  /** trigger run 的执行流（run 事件 streamId）。 */
  executionStreamId: string;
  /** 用户真实目标会话（outbound conversation fact 的 streamId）。 */
  targetConversationId: string;
  /** ChatExecutionResult.runId；缺失 → skipped_no_run（回落 Phase 5 行为）。 */
  runId?: string;
  /** push 的实际发送文本（markdown 转换由 push 侧完成，存实发文本）。 */
  text: string;
  pushSucceeded: boolean;
  /** push 失败原因（仅入账本，不进日志正文）。 */
  failureReason?: string;
}

/**
 * Append the delivery run events + outbound conversation fact for one
 * proactive push. Resolves when the attempt has been recorded (or skipped);
 * never throws.
 */
export async function recordProactiveOutbound(
  input: ProactiveOutboundInput,
  stores?: {
    agentRunStore?: AgentRunStore;
    conversationEventStore?: ConversationEventStore;
  },
): Promise<void> {
  const { accountId, executionStreamId, targetConversationId, runId, text, pushSucceeded } = input;
  if (!runId) {
    proactiveOutboundTotal.inc({ result: "skipped_no_run" });
    return;
  }
  const agentRunStore = stores?.agentRunStore ?? getAgentRunStore();
  const conversationEventStore = stores?.conversationEventStore ?? getConversationEventStore();

  const deliveryId = createDeliveryId(accountId, runId);
  const occurredAt = new Date().toISOString();

  try {
    // The terminal marker must exist before delivery facts reference the run —
    // a degraded run (interrupted, no delivery_requested) stays Phase-5 silent.
    const requested = await agentRunStore.getById(
      createRunEventId(accountId, runId, AGENT_RUN_EVENT_TYPE.DELIVERY_REQUESTED, deliveryId),
    );
    if (!requested) {
      proactiveOutboundTotal.inc({ result: "skipped_no_run" });
      return;
    }

    const deliveryRunEvent = pushSucceeded
      ? ({
          eventType: AGENT_RUN_EVENT_TYPE.DELIVERY_SUCCEEDED,
          schemaVersion: 1,
          accountId,
          conversationStreamId: executionStreamId,
          runId,
          occurredAt,
          causationId: deliveryId,
          correlationId: runId,
          eventId: createRunEventId(
            accountId,
            runId,
            AGENT_RUN_EVENT_TYPE.DELIVERY_SUCCEEDED,
            deliveryId,
          ),
          payload: { deliveryId },
        } as const)
      : ({
          eventType: AGENT_RUN_EVENT_TYPE.DELIVERY_FAILED,
          schemaVersion: 1,
          accountId,
          conversationStreamId: executionStreamId,
          runId,
          occurredAt,
          causationId: deliveryId,
          correlationId: runId,
          eventId: createRunEventId(
            accountId,
            runId,
            AGENT_RUN_EVENT_TYPE.DELIVERY_FAILED,
            deliveryId,
          ),
          payload: {
            deliveryId,
            error: input.failureReason ?? "delivery_failed",
            retryable: false,
          },
        } as const);
    await agentRunStore.append(deliveryRunEvent);

    await conversationEventStore.append(
      pushSucceeded
        ? {
            eventId: createOutboundFactEventId(accountId, runId, "proactive"),
            accountId,
            // Outbound facts land in the user's real target conversation —
            // for scheduler this differs from the execution stream (§5.2).
            streamId: targetConversationId,
            eventType: CONVERSATION_EVENT_TYPE.OUTBOUND_MESSAGE_DELIVERED,
            schemaVersion: 1,
            occurredAt,
            receivedAt: occurredAt,
            actor: { kind: "agent", id: accountId },
            causationId: runId,
            correlationId: runId,
            payload: {
              deliveryId,
              channel: "weixin",
              text,
              attachmentRefs: [],
            },
          }
        : {
            eventId: createOutboundFactEventId(accountId, runId, "proactive_failed"),
            accountId,
            streamId: targetConversationId,
            eventType: CONVERSATION_EVENT_TYPE.OUTBOUND_MESSAGE_DELIVERY_FAILED,
            schemaVersion: 1,
            occurredAt,
            receivedAt: occurredAt,
            actor: { kind: "agent", id: accountId },
            causationId: runId,
            correlationId: runId,
            payload: {
              deliveryId,
              channel: "weixin",
              reason: input.failureReason ?? "delivery_failed",
              retryable: false,
            },
          },
    );
    proactiveOutboundTotal.inc({ result: "appended" });
  } catch (error) {
    // fail-open：事实缺失由对账暴露，不影响推送结果（§5.2/§13）。
    proactiveOutboundTotal.inc({ result: "failed" });
    console.warn(
      `[proactive-outbound] fact write failed for run ${runId}: ${(error as Error).message}`,
    );
  }
}
