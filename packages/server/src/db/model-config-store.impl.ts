import type {
  CreateModelProviderTemplateInput,
  ModelConfigRow,
  ModelConfigStore,
  ModelProviderTemplateRow,
  ModelScope,
  UpdateModelProviderTemplateInput,
  UpsertModelConfigInput,
} from "@clawbot/agent";
import { openSecretOrNull, sealSecret } from "../credentials/secret-box.js";
import { getPrisma } from "./prisma.js";

type TemplateSecretColumns = {
  id: bigint;
  apiKey: string | null;
  apiKeyCiphertext: string | null;
};

export function templateEncryptionScope(templateId: bigint): string {
  return `model-provider-template:${templateId}`;
}

/**
 * Resolve a template's API key from the sealed column, falling back to the
 * legacy plaintext column for rows the startup migration has not rewritten yet.
 *
 * An unopenable ciphertext resolves to null (logged) rather than throwing, so a
 * rotated master key degrades to "this provider has no key" instead of failing
 * every request that lists or resolves models.
 */
export function resolveTemplateApiKey(row: TemplateSecretColumns): string | null {
  if (row.apiKeyCiphertext) {
    return openSecretOrNull(templateEncryptionScope(row.id), row.apiKeyCiphertext);
  }

  return row.apiKey;
}

function toTemplateRow(r: {
  id: bigint;
  name: string;
  provider: string;
  modelIds: string[];
  apiKey: string | null;
  apiKeyCiphertext: string | null;
  baseUrl: string | null;
  enabled: boolean;
  _count?: { configs: number };
}): ModelProviderTemplateRow {
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    modelIds: r.modelIds,
    apiKey: resolveTemplateApiKey(r),
    baseUrl: r.baseUrl,
    enabled: r.enabled,
    usageCount: r._count?.configs ?? 0,
  };
}

function toConfigRow(r: {
  id: bigint;
  scope: string;
  scopeKey: string;
  purpose: string;
  templateId: bigint;
  modelId: string;
  supportsImageInputOverride: string;
  enabled: boolean;
  priority: number;
  template: {
    id: bigint;
    name: string;
    provider: string;
    modelIds: string[];
    apiKey: string | null;
    apiKeyCiphertext: string | null;
    baseUrl: string | null;
    enabled: boolean;
  };
}): ModelConfigRow {
  return {
    id: r.id,
    scope: r.scope as ModelScope,
    scopeKey: r.scopeKey,
    purpose: r.purpose,
    templateId: r.templateId,
    templateName: r.template.name,
    provider: r.template.provider,
    modelId: r.modelId,
    supportsImageInputOverride: r.supportsImageInputOverride as ModelConfigRow["supportsImageInputOverride"],
    modelIds: r.template.modelIds,
    apiKey: resolveTemplateApiKey(r.template),
    baseUrl: r.template.baseUrl,
    templateEnabled: r.template.enabled,
    enabled: r.enabled,
    priority: r.priority,
  };
}

export class PrismaModelConfigStore implements ModelConfigStore {
  async findByScope(
    scope: ModelScope,
    scopeKey: string,
  ): Promise<ModelConfigRow[]> {
    const rows = await getPrisma().modelConfig.findMany({
      where: { scope, scopeKey, enabled: true },
      include: { template: true },
      orderBy: { priority: "desc" },
    });
    return rows.map(toConfigRow);
  }

  async listTemplates(): Promise<ModelProviderTemplateRow[]> {
    const rows = await getPrisma().modelProviderTemplate.findMany({
      include: { _count: { select: { configs: true } } },
      orderBy: [{ name: "asc" }, { provider: "asc" }],
    });
    return rows.map(toTemplateRow);
  }

  async createTemplate(
    input: CreateModelProviderTemplateInput,
  ): Promise<ModelProviderTemplateRow> {
    // The encryption scope binds to the row id, which only exists after the
    // insert, so the key is sealed in a second write inside one transaction.
    const row = await getPrisma().$transaction(async (tx) => {
      const created = await tx.modelProviderTemplate.create({
        data: {
          name: input.name,
          provider: input.provider,
          modelIds: input.modelIds,
          baseUrl: input.baseUrl ?? null,
          enabled: input.enabled ?? true,
        },
      });

      if (!input.apiKey) {
        return created;
      }

      return tx.modelProviderTemplate.update({
        where: { id: created.id },
        data: {
          apiKeyCiphertext: sealSecret(templateEncryptionScope(created.id), input.apiKey),
        },
      });
    });

    return toTemplateRow(row);
  }

  async updateTemplate(
    input: UpdateModelProviderTemplateInput,
  ): Promise<ModelProviderTemplateRow> {
    const data: {
      name: string;
      provider: string;
      modelIds: string[];
      baseUrl: string | null;
      enabled: boolean;
      apiKey?: string | null;
      apiKeyCiphertext?: string | null;
    } = {
      name: input.name,
      provider: input.provider,
      modelIds: input.modelIds,
      baseUrl: input.baseUrl ?? null,
      enabled: input.enabled ?? true,
    };

    // Any write to the key also clears the legacy plaintext column so a stale
    // plaintext copy can never outlive the sealed value.
    if (input.clearApiKey) {
      data.apiKey = null;
      data.apiKeyCiphertext = null;
    } else if (input.apiKey !== undefined) {
      data.apiKey = null;
      data.apiKeyCiphertext = input.apiKey
        ? sealSecret(templateEncryptionScope(input.id), input.apiKey)
        : null;
    }

    const row = await getPrisma().modelProviderTemplate.update({
      where: { id: input.id },
      data,
      include: { _count: { select: { configs: true } } },
    });
    return toTemplateRow(row);
  }

  async deleteTemplate(id: bigint): Promise<boolean> {
    try {
      await getPrisma().modelProviderTemplate.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }

  async getTemplateById(id: bigint): Promise<ModelProviderTemplateRow | null> {
    const row = await getPrisma().modelProviderTemplate.findUnique({
      where: { id },
      include: { _count: { select: { configs: true } } },
    });
    return row ? toTemplateRow(row) : null;
  }

  async countConfigsForTemplate(id: bigint): Promise<number> {
    return getPrisma().modelConfig.count({
      where: { templateId: id },
    });
  }

  async listAllConfigs(): Promise<ModelConfigRow[]> {
    const rows = await getPrisma().modelConfig.findMany({
      include: { template: true },
      orderBy: [{ scope: "asc" }, { scopeKey: "asc" }, { purpose: "asc" }],
    });
    return rows.map(toConfigRow);
  }

  async upsertConfig(input: UpsertModelConfigInput): Promise<ModelConfigRow> {
    const row = await getPrisma().modelConfig.upsert({
      where: {
        scope_scopeKey_purpose: {
          scope: input.scope,
          scopeKey: input.scopeKey,
          purpose: input.purpose,
        },
      },
      create: {
        scope: input.scope,
        scopeKey: input.scopeKey,
        purpose: input.purpose,
        templateId: input.templateId,
        modelId: input.modelId,
        supportsImageInputOverride: input.supportsImageInputOverride ?? "default",
        enabled: input.enabled ?? true,
        priority: input.priority ?? 0,
      },
      update: {
        templateId: input.templateId,
        modelId: input.modelId,
        supportsImageInputOverride: input.supportsImageInputOverride ?? "default",
        enabled: input.enabled,
        priority: input.priority,
      },
      include: { template: true },
    });
    return toConfigRow(row);
  }

  async deleteConfig(id: bigint): Promise<boolean> {
    try {
      await getPrisma().modelConfig.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}
