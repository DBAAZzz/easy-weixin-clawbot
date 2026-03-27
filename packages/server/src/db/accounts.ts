import type { AccountRow, AccountSummary } from "@clawbot/shared";
import { getPrisma } from "./prisma.js";

const ONLINE_THRESHOLD_MS = 90_000;
const OFFLINE_AT = new Date(0).toISOString();

type AccountTableRow = Omit<AccountRow, "is_online">;

function toIso(date: Date) {
  return date.toISOString();
}

export function isAccountOnline(lastSeenAt: string | null, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  return now - Date.parse(lastSeenAt) < ONLINE_THRESHOLD_MS;
}

function toAccountSummary(row: AccountTableRow, conversationCount: number): AccountSummary {
  return {
    ...row,
    is_online: isAccountOnline(row.last_seen_at),
    conversation_count: conversationCount,
  };
}

export async function upsertAccounts(accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;

  const prisma = getPrisma();
  const now = new Date();

  await prisma.$transaction(
    accountIds.map((accountId) =>
      prisma.account.upsert({
        where: { id: accountId },
        update: { lastSeenAt: now },
        create: { id: accountId, lastSeenAt: now },
      })
    )
  );
}

export async function heartbeatAccounts(accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;

  await upsertAccounts(accountIds);
}

export async function markAccountsOffline(accountIds: string[]): Promise<void> {
  if (accountIds.length === 0) return;

  await getPrisma().account.updateMany({
    where: { id: { in: accountIds } },
    data: { lastSeenAt: new Date(OFFLINE_AT) },
  });
}

export async function listAccounts(): Promise<AccountSummary[]> {
  const accountRows = await getPrisma().account.findMany({
    include: {
      _count: {
        select: {
          conversations: true,
        },
      },
    },
    orderBy: {
      createdAt: "asc",
    },
  });

  return accountRows.map((row) =>
    toAccountSummary(
      {
        id: row.id,
        display_name: row.displayName,
        last_seen_at: row.lastSeenAt ? toIso(row.lastSeenAt) : null,
        created_at: toIso(row.createdAt),
      },
      row._count.conversations
    )
  );
}

export async function getAccount(accountId: string): Promise<AccountSummary | null> {
  const summary = (await listAccounts()).find((row) => row.id === accountId);
  return summary ?? null;
}
