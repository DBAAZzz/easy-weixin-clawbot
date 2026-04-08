import type {
  CreateModelProviderTemplateInput,
  ModelConfigRow,
  ModelConfigStore,
  ModelProviderTemplateRow,
  ModelScope,
  UpdateModelProviderTemplateInput,
  UpsertModelConfigInput,
} from "@clawbot/agent";
import { getPrisma } from "./prisma.js";

function toTemplateRow(r: {
  id: bigint;
  name: string;
  provider: string;
  modelIds: string[];
  apiKey: string | null;
  baseUrl: string | null;
  enabled: boolean;
  _count?: { configs: number };
}): ModelProviderTemplateRow {
  return {
    id: r.id,
    name: r.name,
    provider: r.provider,
    modelIds: r.modelIds,
    apiKey: r.apiKey,
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
  enabled: boolean;
  priority: number;
  template: {
    id: bigint;
    name: string;
    provider: string;
    modelIds: string[];
    apiKey: string | null;
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
    modelIds: r.template.modelIds,
    apiKey: r.template.apiKey,
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
    const row = await getPrisma().modelProviderTemplate.create({
      data: {
        name: input.name,
        provider: input.provider,
        modelIds: input.modelIds,
        apiKey: input.apiKey ?? null,
        baseUrl: input.baseUrl ?? null,
        enabled: input.enabled ?? true,
      },
      include: { _count: { select: { configs: true } } },
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
    } = {
      name: input.name,
      provider: input.provider,
      modelIds: input.modelIds,
      baseUrl: input.baseUrl ?? null,
      enabled: input.enabled ?? true,
    };

    if (input.clearApiKey) {
      data.apiKey = null;
    } else if (input.apiKey !== undefined) {
      data.apiKey = input.apiKey;
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
        enabled: input.enabled ?? true,
        priority: input.priority ?? 0,
      },
      update: {
        templateId: input.templateId,
        modelId: input.modelId,
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
