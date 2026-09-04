import { Prisma, type PrismaClient } from "@prisma/client";
import { appendConversationEventInTransaction } from "./conversation-event-store.impl.js";
import { conversationEventFromRow } from "./fact-ledger/codec.js";
import { clearMessagesInTransaction } from "./message-store.impl.js";
import { waitForConversationMessageWrites } from "./messages.js";
import { getPrisma } from "./prisma.js";
import { buildSessionBoundaryEvent } from "../weixin/session-boundary.js";

export type ClearIngressSessionStep =
  | "command_marked"
  | "messages_cleared"
  | "route_deleted"
  | "boundary_appended";

export interface ClearIngressSessionResult {
  boundaryEventId: string;
  boundaryStreamSeq: number;
  deletedMessageCount: number;
}

export interface ClearIngressSessionOptions {
  prisma?: PrismaClient;
  afterStep?: (step: ClearIngressSessionStep) => void | Promise<void>;
  /** Admin-only repair path for an already terminal source receipt. */
  allowTerminalRepair?: boolean;
  /** Admin audit recorded on the receipt inside the same transaction; repair must always supply it. */
  audit?: { operator: string; reason: string };
}

async function recordClearAudit(
  tx: Prisma.TransactionClient,
  receiptId: string,
  audit: { operator: string; reason: string } | undefined,
): Promise<void> {
  if (!audit) return;
  await tx.weixinIngressDispatch.update({
    where: { eventId: receiptId },
    data: {
      recoveryOperator: audit.operator.trim(),
      recoveryReason: audit.reason.trim(),
      recoveredAt: new Date(),
    },
  });
}

function isRetryableTransactionError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
}

export async function clearIngressSession(
  input: {
    accountId: string;
    receiptId: string;
    wechatConversationId: string;
    effectiveConversationId: string;
  },
  options: ClearIngressSessionOptions = {},
): Promise<ClearIngressSessionResult> {
  await waitForConversationMessageWrites(input.accountId, input.effectiveConversationId);
  const prisma = options.prisma ?? getPrisma();
  let attempts = 0;

  while (true) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<
            Array<{ accountId: string; status: string }>
          >(Prisma.sql`
          SELECT "account_id" AS "accountId", "status"
          FROM "weixin_ingress_dispatches"
          WHERE "event_id" = ${input.receiptId}
          FOR UPDATE
        `);
          const receipt = locked[0];
          const validStatus =
            receipt?.status === "processing" ||
            (options.allowTerminalRepair &&
              (receipt?.status === "completed" || receipt?.status === "failed"));
          if (receipt?.accountId !== input.accountId || !validStatus) {
            throw new Error("invalid_ingress_clear_receipt");
          }

          const sourceRow = await tx.conversationEvent.findUnique({
            where: { eventId: input.receiptId },
          });
          if (!sourceRow || sourceRow.accountId !== input.accountId) {
            throw new Error("invalid_ingress_clear_source_event");
          }
          const source = conversationEventFromRow(sourceRow);
          if (
            source.eventType !== "inbound_message_received" ||
            source.streamId !== input.wechatConversationId
          ) {
            throw new Error("invalid_ingress_clear_source_event");
          }

          const route = await tx.sessionRoute.findUnique({
            where: {
              accountId_wechatConvId: {
                accountId: input.accountId,
                wechatConvId: input.wechatConversationId,
              },
            },
          });
          const storedEffective = route?.effectiveConvId ?? input.wechatConversationId;
          if (storedEffective !== input.effectiveConversationId) {
            throw new Error("ingress_clear_route_changed");
          }

          // The boundary is committed in the same transaction as every side
          // effect below, so its presence proves this receipt already cleared.
          // Re-running (crash retry before settle, repeated repair) must not
          // delete messages that arrived after the existing boundary.
          const existingBoundary = await tx.conversationEvent.findFirst({
            where: {
              accountId: input.accountId,
              eventType: "session_rotated",
              causationId: input.receiptId,
            },
            select: { eventId: true, streamSeq: true },
          });
          if (existingBoundary) {
            await recordClearAudit(tx, input.receiptId, options.audit);
            return {
              boundaryEventId: existingBoundary.eventId,
              boundaryStreamSeq: existingBoundary.streamSeq,
              deletedMessageCount: 0,
            };
          }

          const marked = await tx.weixinIngressDispatch.updateMany({
            where: {
              eventId: input.receiptId,
              accountId: input.accountId,
              ...(options.allowTerminalRepair ? {} : { status: "processing" }),
            },
            data: { commandName: "clear" },
          });
          if (marked.count !== 1) throw new Error("invalid_ingress_clear_receipt");
          await recordClearAudit(tx, input.receiptId, options.audit);
          await options.afterStep?.("command_marked");

          const deletedMessageCount = await clearMessagesInTransaction(
            tx,
            input.accountId,
            input.effectiveConversationId,
          );
          await options.afterStep?.("messages_cleared");

          await tx.sessionRoute.deleteMany({
            where: {
              accountId: input.accountId,
              wechatConvId: input.wechatConversationId,
            },
          });
          await options.afterStep?.("route_deleted");

          const boundary = await appendConversationEventInTransaction(
            tx,
            buildSessionBoundaryEvent(source),
          );
          await options.afterStep?.("boundary_appended");
          return {
            boundaryEventId: boundary.value.eventId,
            boundaryStreamSeq: boundary.value.streamSeq,
            deletedMessageCount,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      attempts += 1;
      if (!isRetryableTransactionError(error) || attempts >= 3) throw error;
    }
  }
}

/** Admin repair accepts only a source receipt id plus operator audit; all fact content is derived from storage. */
export async function repairIngressClear(
  receiptId: string,
  audit: { operator: string; reason: string },
  injectedPrisma?: PrismaClient,
): Promise<ClearIngressSessionResult> {
  const operator = audit.operator.trim();
  const reason = audit.reason.trim();
  if (!receiptId.trim() || !operator || !reason || reason.length > 500) {
    throw new Error("invalid_ingress_clear_repair_input");
  }
  const prisma = injectedPrisma ?? getPrisma();
  const receipt = await prisma.weixinIngressDispatch.findUnique({
    where: { eventId: receiptId },
    include: { event: true },
  });
  if (!receipt || receipt.event.eventType !== "inbound_message_received") {
    throw new Error("invalid_ingress_clear_repair_receipt");
  }
  const route = await prisma.sessionRoute.findUnique({
    where: {
      accountId_wechatConvId: {
        accountId: receipt.accountId,
        wechatConvId: receipt.event.streamId,
      },
    },
  });
  return clearIngressSession(
    {
      accountId: receipt.accountId,
      receiptId,
      wechatConversationId: receipt.event.streamId,
      effectiveConversationId: route?.effectiveConvId ?? receipt.event.streamId,
    },
    { prisma, allowTerminalRepair: true, audit: { operator, reason } },
  );
}
