import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma.js";

export class PrismaContextCompilerShadowRolloutStore {
  constructor(private readonly injectedPrisma?: PrismaClient) {}

  private get prisma(): PrismaClient {
    return this.injectedPrisma ?? getPrisma();
  }

  async isEnabled(accountId: string): Promise<boolean> {
    const row = await this.prisma.contextCompilerShadowRollout.findUnique({
      where: { accountId },
      select: { enabled: true },
    });
    return row?.enabled ?? false;
  }
}
