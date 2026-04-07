/**
 * ModelConfigStore — agent-defined interface for model configuration persistence.
 *
 * Implemented by server (Prisma) and injected at startup.
 */

export type ModelPurpose = "chat" | "extraction";
export type ModelScope = "global" | "account" | "conversation";

export interface ModelConfigRow {
  id: bigint;
  scope: ModelScope;
  scopeKey: string;
  purpose: string; // "chat" | "extraction" | "*"
  provider: string;
  modelId: string;
  apiKey: string | null;
  baseUrl: string | null;
  enabled: boolean;
  priority: number;
}

export interface UpsertModelConfigInput {
  scope: ModelScope;
  scopeKey: string;
  purpose: string;
  provider: string;
  modelId: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  enabled?: boolean;
  priority?: number;
}

export interface ModelConfigStore {
  /** Get all enabled configs for a given scope+scopeKey */
  findByScope(scope: ModelScope, scopeKey: string): Promise<ModelConfigRow[]>;

  /** Get all configs (for admin listing) */
  listAll(): Promise<ModelConfigRow[]>;

  /** Upsert a config (insert or update by unique key) */
  upsert(input: UpsertModelConfigInput): Promise<ModelConfigRow>;

  /** Delete a config by id */
  delete(id: bigint): Promise<boolean>;
}

let store: ModelConfigStore | null = null;

export function setModelConfigStore(impl: ModelConfigStore): void {
  store = impl;
}

export function getModelConfigStore(): ModelConfigStore {
  if (!store)
    throw new Error(
      "ModelConfigStore not initialized — call setModelConfigStore() at startup",
    );
  return store;
}
