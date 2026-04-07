/**
 * Prisma implementation of TapeStore interface from @clawbot/agent.
 */

import type { Prisma } from "@prisma/client";
import type {
  TapeStore,
  TapeEntryRow,
  TapeAnchorRow,
  CreateEntryParams,
  CreateAnchorParams,
} from "@clawbot/agent/ports";
import { getPrisma } from "./prisma.js";

export class PrismaTapeStore implements TapeStore {
  async createEntry(params: CreateEntryParams): Promise<string> {
    const entry = await getPrisma().tapeEntry.create({
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
    const rows = await getPrisma().tapeEntry.findMany({
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
      category: r.category,
      payload: r.payload,
      createdAt: r.createdAt,
    }));
  }

  async findLatestAnchor(
    accountId: string,
    branch: string,
  ): Promise<TapeAnchorRow | null> {
    const anchor = await getPrisma().tapeAnchor.findFirst({
      where: { accountId, branch },
      orderBy: { createdAt: "desc" },
    });
    if (!anchor) return null;
    return {
      aid: anchor.aid,
      snapshot: anchor.snapshot,
      lastEntryEid: anchor.lastEntryEid,
      createdAt: anchor.createdAt,
    };
  }

  async createAnchor(params: CreateAnchorParams): Promise<string> {
    const anchor = await getPrisma().tapeAnchor.create({
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
    await getPrisma().tapeEntry.updateMany({
      where: { id: { in: entryIds } },
      data: { compacted: true },
    });
  }

  async compactTransaction(
    anchorParams: CreateAnchorParams,
    _entryEids: bigint[],
  ): Promise<void> {
    const prisma = getPrisma();

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
    const result = await getPrisma().tapeEntry.deleteMany({
      where: {
        compacted: true,
        createdAt: { lt: cutoff },
      },
    });
    return result.count;
  }
}
