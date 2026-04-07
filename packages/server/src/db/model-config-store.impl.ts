import type {
  ModelConfigStore,
  ModelConfigRow,
  UpsertModelConfigInput,
  ModelScope,
} from "@clawbot/agent";
import { getPrisma } from "./prisma.js";

function toRow(r: {
  id: bigint;
  scope: string;
  scopeKey: string;
  purpose: string;
  provider: string;
  modelId: string;
  apiKey: string | null;
  baseUrl: string | null;
  enabled: boolean;
  priority: number;
}): ModelConfigRow {
  return {
    id: r.id,
    scope: r.scope as ModelScope,
    scopeKey: r.scopeKey,
    purpose: r.purpose,
    provider: r.provider,
    modelId: r.modelId,
    apiKey: r.apiKey,
    baseUrl: r.baseUrl,
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
      orderBy: { priority: "desc" },
    });
    return rows.map(toRow);
  }

  async listAll(): Promise<ModelConfigRow[]> {
    const rows = await getPrisma().modelConfig.findMany({
      orderBy: [{ scope: "asc" }, { scopeKey: "asc" }, { purpose: "asc" }],
    });
    return rows.map(toRow);
  }

  async upsert(input: UpsertModelConfigInput): Promise<ModelConfigRow> {
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
        provider: input.provider,
        modelId: input.modelId,
        apiKey: input.apiKey ?? null,
        baseUrl: input.baseUrl ?? null,
        enabled: input.enabled ?? true,
        priority: input.priority ?? 0,
      },
      update: {
        provider: input.provider,
        modelId: input.modelId,
        apiKey: input.apiKey ?? null,
        baseUrl: input.baseUrl ?? null,
        enabled: input.enabled,
        priority: input.priority,
      },
    });
    return toRow(row);
  }

  async delete(id: bigint): Promise<boolean> {
    try {
      await getPrisma().modelConfig.delete({ where: { id } });
      return true;
    } catch {
      return false;
    }
  }
}
