import type { AccountRow, AccountStatusFilter, AccountSummary } from "@clawbot/shared";
import { getPrisma } from "./prisma.js";

function toIso(date: Date) {
  return date.toISOString();
}

function toAccountSummary(row: {
  id: string;
  displayName: string | null;
  alias: string | null;
  deprecated: boolean;
  createdAt: Date;
  _count: { conversations: number };
}): AccountSummary {
  return {
    id: row.id,
    display_name: row.displayName,
    alias: row.alias,
    deprecated: row.deprecated,
    created_at: toIso(row.createdAt),
    conversation_count: row._count.conversations,
  };
}

export async function upsertAccount(accountId: string): Promise<void> {
  await getPrisma().account.upsert({
    where: { id: accountId },
    update: {},
    create: { id: accountId },
  });
}

export async function deprecateAccount(accountId: string): Promise<void> {
  await getPrisma().account.update({
    where: { id: accountId },
    data: { deprecated: true },
  });
}

export async function getActiveAccountIds(): Promise<string[]> {
  const rows = await getPrisma().account.findMany({
    where: { deprecated: false },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

function toDeprecatedFilter(status: AccountStatusFilter): boolean | undefined {
  if (status === "active") return false;
  if (status === "deprecated") return true;
  return undefined;
}

export async function listAccounts(status: AccountStatusFilter = "all"): Promise<AccountSummary[]> {
  const deprecated = toDeprecatedFilter(status);
  const rows = await getPrisma().account.findMany({
    ...(deprecated === undefined ? {} : { where: { deprecated } }),
    include: { _count: { select: { conversations: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map(toAccountSummary);
}

export async function getAccount(accountId: string): Promise<AccountSummary | null> {
  const row = await getPrisma().account.findUnique({
    where: { id: accountId },
    include: { _count: { select: { conversations: true } } },
  });
  if (!row) return null;
  return toAccountSummary(row);
}

export async function updateAccountAlias(accountId: string, alias: string | null): Promise<void> {
  await getPrisma().account.update({
    where: { id: accountId },
    data: { alias },
  });
}
