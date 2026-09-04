import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma.js";

export type ContextReadPathValue = "legacy" | "dual" | "canonical";
export type LegacyWriteModeValue = "prompt_shaped" | "clean" | "suspended";
export type MemoryReadPathValue = "tape" | "dual" | "events";

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
  async readPath(accountId: string): Promise<ContextReadPathValue> {
    const row = await this.prisma.runLedgerRollout.findUnique({
      where: { accountId },
      select: { enabled: true, readPath: true },
    });
    if (!row?.enabled) return "legacy";
    return (row.readPath as ContextReadPathValue) ?? "legacy";
  }

  /**
   * Phase 7：messages 投影写路径三态。rollout 关闭或无行 → prompt_shaped
   * （Phase 0–6 行为）。生效条件（clean 需要 canonical 读路径）在接线层强制。
   */
  async legacyWriteMode(accountId: string): Promise<LegacyWriteModeValue> {
    const row = await this.prisma.runLedgerRollout.findUnique({
      where: { accountId },
      select: { enabled: true, legacyWriteMode: true },
    });
    if (!row?.enabled) return "prompt_shaped";
    return (row.legacyWriteMode as LegacyWriteModeValue) ?? "prompt_shaped";
  }

  /** Phase 7：记忆注入读取三态。rollout 关闭或无行 → tape（Phase 0–6 行为）。 */
  async memoryReadPath(accountId: string): Promise<MemoryReadPathValue> {
    const row = await this.prisma.runLedgerRollout.findUnique({
      where: { accountId },
      select: { enabled: true, memoryReadPath: true },
    });
    if (!row?.enabled) return "tape";
    return (row.memoryReadPath as MemoryReadPathValue) ?? "tape";
  }
}
