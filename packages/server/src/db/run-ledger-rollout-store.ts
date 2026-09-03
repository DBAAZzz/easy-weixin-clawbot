import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma.js";

export class RunLedgerRolloutStore {
  constructor(private readonly injectedPrisma?: PrismaClient) {}

  private get prisma(): PrismaClient {
    return this.injectedPrisma ?? getPrisma();
  }

  async isEnabled(accountId: string): Promise<boolean> {
    const row = await this.prisma.runLedgerRollout.findUnique({
      where: { accountId },
      select: { enabled: true },
    });
    return row?.enabled ?? false;
  }

  /** Phase 6：读取路径三态。rollout 关闭或无行 → legacy。 */
  async readPath(accountId: string): Promise<"legacy" | "dual" | "canonical"> {
    const row = await this.prisma.runLedgerRollout.findUnique({
      where: { accountId },
      select: { enabled: true, readPath: true },
    });
    if (!row?.enabled) return "legacy";
    return (row.readPath as "legacy" | "dual" | "canonical") ?? "legacy";
  }
}
