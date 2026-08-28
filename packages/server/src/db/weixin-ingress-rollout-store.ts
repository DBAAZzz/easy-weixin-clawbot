import type { PrismaClient } from "@prisma/client";
import { getPrisma } from "./prisma.js";

export class WeixinIngressRolloutStore {
  constructor(private readonly injectedPrisma?: PrismaClient) {}

  async isEnabled(accountId: string): Promise<boolean> {
    const prisma = this.injectedPrisma ?? getPrisma();
    const rollout = await prisma.weixinIngressRollout.findUnique({ where: { accountId } });
    return rollout?.enabled === true;
  }
}
