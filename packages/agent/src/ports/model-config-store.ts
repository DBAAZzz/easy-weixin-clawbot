/**
 * ModelConfigStore — agent-defined interface for model configuration persistence.
 *
 * Implemented by server (Prisma) and injected at startup.
 */

export type ModelPurpose = "chat" | "extraction";
export type ModelScope = "global" | "account" | "conversation";

export interface ModelProviderTemplateRow {
  id: bigint;
  name: string;
  provider: string;
  modelIds: string[];
  apiKey: string | null;
  baseUrl: string | null;
  enabled: boolean;
  usageCount: number;
}

export interface CreateModelProviderTemplateInput {
  name: string;
  provider: string;
  modelIds: string[];
  apiKey?: string | null;
  baseUrl?: string | null;
  enabled?: boolean;
}

export interface UpdateModelProviderTemplateInput {
  id: bigint;
  name: string;
  provider: string;
  modelIds: string[];
  apiKey?: string | null;
  clearApiKey?: boolean;
  baseUrl?: string | null;
  enabled?: boolean;
}

export interface ModelConfigRow {
  id: bigint;
  scope: ModelScope;
  scopeKey: string;
  purpose: string; // "chat" | "extraction" | "*"
  templateId: bigint;
  templateName: string;
  provider: string;
  modelId: string;
  modelIds: string[];
  apiKey: string | null;
  baseUrl: string | null;
  templateEnabled: boolean;
  enabled: boolean;
  priority: number;
}

export interface UpsertModelConfigInput {
  scope: ModelScope;
  scopeKey: string;
  purpose: string;
  templateId: bigint;
  modelId: string;
  enabled?: boolean;
  priority?: number;
}

export interface ModelConfigStore {
  /** Get all enabled configs for a given scope+scopeKey, joined with template data. */
  findByScope(scope: ModelScope, scopeKey: string): Promise<ModelConfigRow[]>;

  /** Provider template CRUD for admin APIs. */
  listTemplates(): Promise<ModelProviderTemplateRow[]>;
  createTemplate(
    input: CreateModelProviderTemplateInput,
  ): Promise<ModelProviderTemplateRow>;
  updateTemplate(
    input: UpdateModelProviderTemplateInput,
  ): Promise<ModelProviderTemplateRow>;
  deleteTemplate(id: bigint): Promise<boolean>;
  getTemplateById(id: bigint): Promise<ModelProviderTemplateRow | null>;
  countConfigsForTemplate(id: bigint): Promise<number>;

  /** Scoped config CRUD for admin APIs. */
  listAllConfigs(): Promise<ModelConfigRow[]>;
  upsertConfig(input: UpsertModelConfigInput): Promise<ModelConfigRow>;
  deleteConfig(id: bigint): Promise<boolean>;
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
