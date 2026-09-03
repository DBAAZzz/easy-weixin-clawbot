import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import type { ArtifactRevisionStore } from "@clawbot/agent";
import { createPrismaAttachmentArtifactResolver } from "../../src/db/prisma-attachment-artifact-resolver.js";

/**
 * 业务需求（Phase 5 设计 §7.2）：
 * 用户发过的图片消息，只要登记过媒体制品映射，就必须能找回不可变制品；
 * 没登记过 / 制品已不存在的 ref，绝不能被假装成"已解析"。
 */

function fakePrisma(
  mappings: Array<{ accountId: string; sourceRef: string; artifactId: string; mimeType?: string }>,
): PrismaClient {
  return {
    conversationAttachmentArtifact: {
      findMany: async (args: { where: { accountId: string; sourceRef: { in: string[] } } }) =>
        mappings.filter(
          (mapping) =>
            mapping.accountId === args.where.accountId &&
            args.where.sourceRef.in.includes(mapping.sourceRef),
        ),
    },
  } as unknown as PrismaClient;
}

function artifactStore(
  existing: string[],
): ArtifactRevisionStore {
  return {
    async put() {
      throw new Error("not used");
    },
    async getById(artifactId: string) {
      return existing.includes(artifactId)
        ? ({
            artifactId,
            kind: "media_asset",
            sha256: "a".repeat(64),
            schemaVersion: 1,
            contentLocation: "external",
            storageRef: { provider: "local", key: artifactId },
            createdAt: "2026-08-30T00:00:00.000Z",
          } as never)
        : null;
    },
    async getByContent() {
      return null;
    },
  };
}

test("登记过的媒体 ref 解析出制品与 MIME 类型", async () => {
  const resolver = createPrismaAttachmentArtifactResolver({
    artifactRevisionStore: artifactStore(["media-asset-v1:photo"]),
    injectedPrisma: fakePrisma([
      {
        accountId: "account-1",
        sourceRef: "weixin-attachment-v1:photo",
        artifactId: "media-asset-v1:photo",
        mimeType: "image/png",
      },
    ]),
  });
  const resolved = await resolver.resolve({
    accountId: "account-1",
    sourceRefs: ["weixin-attachment-v1:photo"],
  });
  assert.deepEqual(resolved.get("weixin-attachment-v1:photo"), {
    artifactId: "media-asset-v1:photo",
    mimeType: "image/png",
  });
});

test("未登记与制品缺失的 ref 都不会被假装成已解析", async () => {
  const resolver = createPrismaAttachmentArtifactResolver({
    artifactRevisionStore: artifactStore([]), // 制品库里什么都没有
    injectedPrisma: fakePrisma([
      { accountId: "account-1", sourceRef: "weixin-attachment-v1:photo", artifactId: "media-asset-v1:photo" },
    ]),
  });
  const resolved = await resolver.resolve({
    accountId: "account-1",
    // photo：有映射但制品缺失；ghost：连映射都没有
    sourceRefs: ["weixin-attachment-v1:photo", "weixin-attachment-v1:ghost"],
  });
  assert.equal(resolved.size, 0);
});

test("解析结果按输入 ref 一一对应，账户隔离", async () => {
  const resolver = createPrismaAttachmentArtifactResolver({
    artifactRevisionStore: artifactStore(["media-asset-v1:a", "media-asset-v1:b"]),
    injectedPrisma: fakePrisma([
      { accountId: "account-1", sourceRef: "ref-a", artifactId: "media-asset-v1:a" },
      { accountId: "account-2", sourceRef: "ref-b", artifactId: "media-asset-v1:b" },
    ]),
  });
  const resolved = await resolver.resolve({
    accountId: "account-1",
    sourceRefs: ["ref-a", "ref-b"],
  });
  assert.equal(resolved.has("ref-a"), true);
  // account-2 的映射不能被 account-1 看到
  assert.equal(resolved.has("ref-b"), false);
});
