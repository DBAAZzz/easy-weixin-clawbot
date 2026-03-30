import { PrismaClient } from "@prisma/client";
import { ensurePrismaUrls } from "./prisma-env.js";

let client: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  ensurePrismaUrls();

  if (!client) {
    client = new PrismaClient();
  }

  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (!client) return;
  await client.$disconnect();
  client = null;
}
