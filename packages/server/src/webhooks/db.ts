import { getPrisma } from "../db/prisma.js";
import { generateWebhookToken, hashToken, getTokenPrefix } from "./token-utils.js";

export async function createWebhookToken(params: {
  source: string;
  description?: string;
  accountIds: string[];
}): Promise<{ token: string; tokenId: bigint }> {
  const token = generateWebhookToken();
  const tokenHash = hashToken(token);
  const tokenPrefix = getTokenPrefix(token);

  const result = await getPrisma().webhookToken.create({
    data: {
      source: params.source,
      tokenHash,
      tokenPrefix,
      description: params.description,
      permissions: {
        create: params.accountIds.map((accountId) => ({ accountId })),
      },
    },
  });

  return { token, tokenId: result.id };
}

export async function verifyWebhookToken(
  token: string
): Promise<{ tokenId: bigint; accountIds: string[] } | null> {
  const tokenHash = hashToken(token);

  const result = await getPrisma().webhookToken.findFirst({
    where: { tokenHash, enabled: true },
    include: { permissions: { select: { accountId: true } } },
  });

  if (!result) return null;

  await getPrisma().webhookToken.update({
    where: { id: result.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    tokenId: result.id,
    accountIds: result.permissions.map((p) => p.accountId),
  };
}

export async function logWebhookCall(params: {
  tokenId: bigint;
  accountId: string;
  conversationId: string;
  content: string;
  status: "success" | "failed" | "rejected";
  error?: string;
  idempotencyKey?: string;
}): Promise<void> {
  await getPrisma().webhookLog.create({
    data: params,
  });
}
