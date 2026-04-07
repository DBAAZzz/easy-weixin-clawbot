/**
 * TapeStore — agent-defined interface for tape memory persistence.
 *
 * Implemented by server (Prisma) and injected at startup.
 */

export interface TapeEntryRow {
  eid: string;
  branch: string;
  category: string;
  payload: unknown;
  createdAt: Date;
}

export interface TapeAnchorRow {
  aid: string;
  snapshot: unknown;
  lastEntryEid: string | null;
  createdAt: Date;
}

export interface CreateEntryParams {
  accountId: string;
  branch: string;
  type: string;
  category: string;
  payload: unknown;
  actor: string;
  source: string | null;
}

export interface CreateAnchorParams {
  accountId: string;
  branch: string;
  anchorType: string;
  snapshot: unknown;
  manifest?: string[];
  predecessors?: string[];
  lastEntryEid?: string;
}

export interface TapeStore {
  createEntry(params: CreateEntryParams): Promise<string>;

  findEntries(
    accountId: string,
    branch: string,
    afterDate?: Date,
  ): Promise<TapeEntryRow[]>;

  findAllEntries(
    accountId: string,
    branch: string,
  ): Promise<TapeEntryRow[]>;

  listBranches(accountId: string): Promise<string[]>;

  findLatestAnchor(
    accountId: string,
    branch: string,
  ): Promise<TapeAnchorRow | null>;

  createAnchor(params: CreateAnchorParams): Promise<string>;

  markCompacted(entryIds: bigint[]): Promise<void>;

  /** Compact transaction: create anchor + mark entries as compacted atomically. */
  compactTransaction(
    anchorParams: CreateAnchorParams,
    entryIds: bigint[],
  ): Promise<void>;

  purgeCompacted(retentionDays: number): Promise<number>;
}

let store: TapeStore | null = null;

export function setTapeStore(impl: TapeStore): void {
  store = impl;
}

export function getTapeStore(): TapeStore {
  if (!store) throw new Error("TapeStore not initialized — call setTapeStore() at startup");
  return store;
}
