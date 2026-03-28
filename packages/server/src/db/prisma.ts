import { PrismaClient } from "@prisma/client";

const DEFAULT_SUPABASE_DB_USER = "postgres.zdemjznsulfzelnzeudy";
const DEFAULT_SUPABASE_POOL_HOST = "aws-1-ap-southeast-1.pooler.supabase.com";
const DEFAULT_SUPABASE_DIRECT_HOST = "aws-1-ap-southeast-1.pooler.supabase.com";
const DEFAULT_SUPABASE_DB_NAME = "postgres";

let client: PrismaClient | null = null;

function requirePassword(): string {
  const password = process.env.SUPABASE_PASSWORD;
  if (!password) {
    throw new Error(
      "DATABASE_URL/DIRECT_URL or SUPABASE_PASSWORD must be configured for Prisma"
    );
  }
  return password;
}

function buildDatabaseUrl() {
  const user = process.env.SUPABASE_DB_USER ?? DEFAULT_SUPABASE_DB_USER;
  const host = process.env.SUPABASE_DIRECT_HOST ?? DEFAULT_SUPABASE_DIRECT_HOST;
  const dbName = process.env.SUPABASE_DB_NAME ?? DEFAULT_SUPABASE_DB_NAME;
  const password = encodeURIComponent(requirePassword());
  return `postgresql://${user}:${password}@${host}:5432/${dbName}`;
}

function buildDirectUrl() {
  const user = process.env.SUPABASE_DB_USER ?? DEFAULT_SUPABASE_DB_USER;
  const host = process.env.SUPABASE_DIRECT_HOST ?? DEFAULT_SUPABASE_DIRECT_HOST;
  const dbName = process.env.SUPABASE_DB_NAME ?? DEFAULT_SUPABASE_DB_NAME;
  const password = encodeURIComponent(requirePassword());
  return `postgresql://${user}:${password}@${host}:5432/${dbName}`;
}

export function ensurePrismaUrls() {
  process.env.DATABASE_URL ||= buildDatabaseUrl();
  process.env.DIRECT_URL ||= buildDirectUrl();

  return {
    databaseUrl: process.env.DATABASE_URL,
    directUrl: process.env.DIRECT_URL,
  };
}

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
