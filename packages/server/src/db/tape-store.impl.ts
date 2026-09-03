/**
 * Prisma implementation of TapeStore interface from @clawbot/agent.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  TapeStore,
  TapeEntryRow,
  TapeAnchorRow,
  CreateEntryParams,
  CreateAnchorParams,
} from "@clawbot/agent/ports";
import { getPrisma } from "./prisma.js";

export class PrismaTapeStore implements TapeStore {
  private readonly injectedPrisma?: PrismaClient;

  /** 测试/CLI 可注入独立连接；缺省用全局 getPrisma()。 */
  constructor(injectedPrisma?: PrismaClient) {
    this.injectedPrisma = injectedPrisma;
  }

  private get prisma(): PrismaClient {
    return this.injectedPrisma ?? getPrisma();
  }

  async createEntry(params: CreateEntryParams): Promise<string> {
    const entry = await this.prisma.tapeEntry.create({
      data: {
        accountId: params.accountId,
        branch: params.branch,
        type: params.type,
        category: params.category,
        payload: params.payload as Prisma.InputJsonValue,
        actor: params.actor,
        source: params.source,
      },
    });
    return entry.eid;
  }

  async findEntries(
    accountId: string,
    branch: string,
    afterDate?: Date,
  ): Promise<TapeEntryRow[]> {
    const rows = await this.prisma.tapeEntry.findMany({
      where: {
        accountId,
        branch,
        compacted: false,
        ...(afterDate ? { createdAt: { gt: afterDate } } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
    return rows.map((r) => ({
      eid: r.eid,
      branch: r.branch,
      category: r.category,
      payload: r.payload,
      createdAt: r.createdAt,
    }));
  }

  async findAllEntries(accountId: string, branch: string): Promise<TapeEntryRow[]> {
    const rows = await this.prisma.tapeEntry.findMany({
      where: {
        accountId,
        ...(branch === "*" ? {} : { branch }),
      },
      orderBy: [{ branch: "asc" }, { createdAt: "asc" }],
    });

    return rows.map((r) => ({
      eid: r.eid,
      branch: r.branch,
      category: r.category,
      payload: r.payload,
      createdAt: r.createdAt,
    }));
  }

  async listBranches(accountId: string): Promise<string[]> {
    const [entryBranches, anchorBranches] = await Promise.all([
      this.prisma.tapeEntry.findMany({
        where: { accountId },
        distinct: ["branch"],
        select: { branch: true },
      }),
      this.prisma.tapeAnchor.findMany({
        where: { accountId },
        distinct: ["branch"],
        select: { branch: true },
      }),
    ]);

    return [...new Set([...entryBranches, ...anchorBranches].map((row) => row.branch))].sort();
  }

  async findLatestAnchor(
    accountId: string,
    branch: string,
  ): Promise<TapeAnchorRow | null> {
    const anchor = await this.prisma.tapeAnchor.findFirst({
      where: { accountId, branch },
      orderBy: { createdAt: "desc" },
    });
    if (!anchor) return null;
    return {
      aid: anchor.aid,
      snapshot: anchor.snapshot,
      lastEntryEid: anchor.lastEntryEid,
      createdAt: anchor.createdAt,
      summaryArtifactId: anchor.summaryArtifactId,
    };
  }

  async listAnchors(accountId: string, branch: string, limit: number): Promise<TapeAnchorRow[]> {
    const anchors = await this.prisma.tapeAnchor.findMany({
      where: { accountId, branch },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return anchors.map((anchor) => ({
      aid: anchor.aid,
      snapshot: anchor.snapshot,
      lastEntryEid: anchor.lastEntryEid,
      createdAt: anchor.createdAt,
      summaryArtifactId: anchor.summaryArtifactId,
    }));
  }

  async attachAnchorSummary(
    accountId: string,
    branch: string,
    aid: string,
    summaryArtifactId: string,
  ): Promise<void> {
    await this.prisma.tapeAnchor.update({
      where: { aid },
      data: { summaryArtifactId },
    });
  }

  async createAnchor(params: CreateAnchorParams): Promise<string> {
    const anchor = await this.prisma.tapeAnchor.create({
      data: {
        accountId: params.accountId,
        branch: params.branch,
        anchorType: params.anchorType,
        snapshot: params.snapshot as Prisma.InputJsonValue,
        manifest: params.manifest,
        predecessors: params.predecessors ?? [],
        lastEntryEid: params.lastEntryEid,
      },
    });
    return anchor.aid;
  }

  async markCompacted(entryIds: bigint[]): Promise<void> {
    await this.prisma.tapeEntry.updateMany({
      where: { id: { in: entryIds } },
      data: { compacted: true },
    });
  }

  async compactTransaction(
    anchorParams: CreateAnchorParams,
    _entryEids: bigint[],
  ): Promise<void> {
    const prisma = this.prisma;

    // We need to find the actual entry IDs by eid strings
    // The entryEids passed from service are actually eid strings (not bigint)
    const eidStrings = _entryEids as unknown as string[];

    await prisma.$transaction(async (tx) => {
      await tx.tapeAnchor.create({
        data: {
          accountId: anchorParams.accountId,
          branch: anchorParams.branch,
          anchorType: anchorParams.anchorType,
          snapshot: anchorParams.snapshot as Prisma.InputJsonValue,
          manifest: anchorParams.manifest,
          predecessors: anchorParams.predecessors ?? [],
          lastEntryEid: anchorParams.lastEntryEid,
        },
      });

      await tx.tapeEntry.updateMany({
        where: {
          accountId: anchorParams.accountId,
          branch: anchorParams.branch,
          eid: { in: eidStrings },
        },
        data: { compacted: true },
      });
    });
  }

  async purgeCompacted(retentionDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.tapeEntry.deleteMany({
      where: {
        compacted: true,
        createdAt: { lt: cutoff },
      },
    });
    return result.count;
  }
}
