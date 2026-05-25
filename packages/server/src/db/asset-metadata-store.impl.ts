import type {
  AssetKind,
  AssetMetadataStore,
  AssetRecord,
  AssetStorageRef,
} from "@clawbot/asset";
import type { Prisma } from "@prisma/client";
import { getPrisma } from "./prisma.js";

function toInputJsonValue(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function toJsonValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function storageToColumns(storage: AssetStorageRef): {
  provider: string;
  bucket?: string;
  objectKey?: string;
  localPath?: string;
  storageRef?: Prisma.InputJsonValue;
} {
  if (storage.provider === "local") {
    return {
      provider: storage.provider,
      localPath: storage.path,
      storageRef: toInputJsonValue(storage),
    };
  }
  if (storage.provider === "s3-compatible") {
    return {
      provider: storage.provider,
      bucket: storage.bucket,
      objectKey: storage.key,
      storageRef: toInputJsonValue(storage),
    };
  }
  return {
    provider: storage.provider,
    storageRef: toInputJsonValue(storage),
  };
}

function columnsToStorage(row: {
  provider: string;
  bucket: string | null;
  objectKey: string | null;
  localPath: string | null;
  storageRef: unknown;
}): AssetStorageRef {
  const storageRef = toJsonValue(row.storageRef);
  if (storageRef?.provider === "custom") {
    return storageRef as unknown as AssetStorageRef;
  }
  if (row.provider === "local") {
    return {
      provider: "local",
      path: row.localPath ?? String(storageRef?.path ?? ""),
    };
  }
  if (row.provider === "s3-compatible") {
    return {
      provider: "s3-compatible",
      bucket: row.bucket ?? String(storageRef?.bucket ?? ""),
      key: row.objectKey ?? String(storageRef?.key ?? ""),
      endpoint: typeof storageRef?.endpoint === "string" ? storageRef.endpoint : undefined,
    };
  }
  return {
    provider: "custom",
    name: row.provider,
    ref: storageRef ?? {},
  };
}

function mapAssetRow(row: {
  id: string;
  accountId: string;
  kind: string;
  mimeType: string;
  sizeBytes: bigint | null;
  sha256: string | null;
  provider: string;
  bucket: string | null;
  objectKey: string | null;
  localPath: string | null;
  storageRef: unknown;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  createdAt: Date;
  updatedAt: Date;
}): AssetRecord {
  return {
    id: row.id,
    accountId: row.accountId,
    kind: row.kind as AssetKind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes === null ? undefined : Number(row.sizeBytes),
    sha256: row.sha256 ?? undefined,
    storage: columnsToStorage(row),
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationMs: row.durationMs ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaAssetMetadataStore implements AssetMetadataStore {
  async create(record: AssetRecord): Promise<void> {
    const storage = storageToColumns(record.storage);
    await getPrisma().asset.create({
      data: {
        id: record.id,
        accountId: record.accountId,
        kind: record.kind,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes === undefined ? undefined : BigInt(record.sizeBytes),
        sha256: record.sha256,
        provider: storage.provider,
        bucket: storage.bucket,
        objectKey: storage.objectKey,
        localPath: storage.localPath,
        storageRef: storage.storageRef,
        width: record.width,
        height: record.height,
        durationMs: record.durationMs,
        createdAt: record.createdAt,
      },
    });
  }

  async get(assetId: string): Promise<AssetRecord | null> {
    const row = await getPrisma().asset.findUnique({
      where: { id: assetId },
    });
    return row ? mapAssetRow(row) : null;
  }

  async listByAccount(input: {
    accountId: string;
    kind?: AssetKind;
    limit: number;
    cursor?: string;
  }): Promise<{
    data: AssetRecord[];
    nextCursor?: string;
  }> {
    const rows = await getPrisma().asset.findMany({
      where: {
        accountId: input.accountId,
        ...(input.kind ? { kind: input.kind } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > input.limit;
    const page = rows.slice(0, input.limit).map(mapAssetRow);
    return {
      data: page,
      nextCursor: hasMore ? page.at(-1)?.id : undefined,
    };
  }

  async delete(assetId: string): Promise<void> {
    await getPrisma().asset.delete({ where: { id: assetId } });
  }
}
