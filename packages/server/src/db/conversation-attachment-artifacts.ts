import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma.js";

/**
 * Phase 5：attachment source ref → immutable MEDIA_ASSET 制品映射表访问。
 *
 * 同 ref 重复资产化幂等（upsert 语义，ON CONFLICT DO NOTHING——先登记的映射
 * 是权威版本）；查询供 AttachmentArtifactResolver 批量解析。
 */

export interface AttachmentArtifactMapping {
  artifactId: string;
  mimeType?: string;
}

export async function recordAttachmentArtifactMapping(
  input: {
    accountId: string;
    sourceRef: string;
    artifactId: string;
    mimeType?: string;
  },
  injectedPrisma?: PrismaClient,
): Promise<void> {
  const prisma = injectedPrisma ?? getPrisma();
  await prisma.conversationAttachmentArtifact.upsert({
    where: {
      accountId_sourceRef: {
        accountId: input.accountId,
        sourceRef: input.sourceRef,
      },
    },
    create: {
      accountId: input.accountId,
      sourceRef: input.sourceRef,
      artifactId: input.artifactId,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    },
    // 已登记的映射是权威版本，不因重复资产化改写。
    update: {},
  });
}

export async function findAttachmentArtifactMappings(
  accountId: string,
  sourceRefs: string[],
  injectedPrisma?: PrismaClient,
): Promise<Map<string, AttachmentArtifactMapping>> {
  if (sourceRefs.length === 0) return new Map();
  const prisma = injectedPrisma ?? getPrisma();
  const rows = await prisma.conversationAttachmentArtifact.findMany({
    where: { accountId, sourceRef: { in: sourceRefs } },
  });
  return new Map(
    rows.map((row) => [
      row.sourceRef,
      {
        artifactId: row.artifactId,
        ...(row.mimeType ? { mimeType: row.mimeType } : {}),
      },
    ]),
  );
}
