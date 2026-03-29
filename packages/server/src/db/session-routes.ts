import { getPrisma } from "./prisma.js";

/**
 * Retrieve the persisted effectiveConvId for a given (accountId, wechatConvId).
 * Returns null if no route has been saved (i.e. no /reset has happened yet).
 */
export async function getRoute(
  accountId: string,
  wechatConvId: string,
): Promise<string | null> {
  const row = await getPrisma().sessionRoute.findUnique({
    where: {
      accountId_wechatConvId: { accountId, wechatConvId },
    },
    select: { effectiveConvId: true },
  });
  return row?.effectiveConvId ?? null;
}

/**
 * Persist (or update) the active effectiveConvId for a wechat conversation.
 * Called on /reset so that a server restart reconnects to the new session.
 */
export async function upsertRoute(
  accountId: string,
  wechatConvId: string,
  effectiveConvId: string,
): Promise<void> {
  await getPrisma().sessionRoute.upsert({
    where: {
      accountId_wechatConvId: { accountId, wechatConvId },
    },
    update: { effectiveConvId },
    create: { accountId, wechatConvId, effectiveConvId },
  });
}

/**
 * Remove the route record for a wechat conversation (e.g. on clearSession).
 * After deletion, the next message will use the raw wechatConvId as usual.
 */
export async function deleteRoute(
  accountId: string,
  wechatConvId: string,
): Promise<void> {
  await getPrisma().sessionRoute.deleteMany({
    where: { accountId, wechatConvId },
  });
}
