import type { AttachmentArtifactResolver, ResolvedAttachmentArtifact } from "@clawbot/agent";
import { findAttachmentArtifactMappings } from "./conversation-attachment-artifacts.js";
import type { ArtifactRevisionStore } from "@clawbot/agent";
import type { PrismaClient } from "@prisma/client";

/**
 * Phase 5：真实的 AttachmentArtifactResolver 实现（设计 §7.2）。
 *
 * sourceRefs → 映射表批量查询 → artifactId → Artifact Store 验证存在。
 * 无映射 / 制品缺失的 ref 不进入返回 Map——compiler 既有逻辑自动把它们
 * 降级为 unresolved，不猜测、不伪造。
 */
export function createPrismaAttachmentArtifactResolver(deps: {
  artifactRevisionStore: ArtifactRevisionStore;
  injectedPrisma?: PrismaClient;
}): AttachmentArtifactResolver {
  return {
    async resolve({ accountId, sourceRefs }) {
      const uniqueRefs = [...new Set(sourceRefs)];
      const mappings = await findAttachmentArtifactMappings(accountId, uniqueRefs, deps.injectedPrisma);

      const resolved = new Map<string, ResolvedAttachmentArtifact>();
      for (const [sourceRef, mapping] of mappings) {
        // 映射指向的制品必须真实存在于不可变 Artifact Store，否则视为未映射。
        const artifact = await deps.artifactRevisionStore.getById(mapping.artifactId);
        if (!artifact) continue;
        resolved.set(sourceRef, {
          artifactId: mapping.artifactId,
          ...(mapping.mimeType ? { mimeType: mapping.mimeType } : {}),
        });
      }
      return resolved;
    },
  };
}
