import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type {
  AssetBlobStore,
  AssetKind,
  AssetMetadataStore,
  AssetRecord,
  AssetService,
} from "@clawbot/asset";
import { createAssetId, createAssetObjectKey, inferAssetKind } from "@clawbot/asset";

export class ServerAssetService implements AssetService {
  constructor(
    private readonly metadataStore: AssetMetadataStore,
    private readonly blobStore: AssetBlobStore,
  ) {}

  async createFromFile(input: {
    accountId: string;
    sourcePath: string;
    mimeType: string;
    kind?: AssetKind;
    conversationId?: string;
    messageSeq?: number;
    originalFilename?: string;
  }): Promise<AssetRecord> {
    const id = createAssetId();
    const createdAt = new Date();
    const kind = input.kind ?? inferAssetKind(input.mimeType);
    const [fileStat, bytes] = await Promise.all([
      stat(input.sourcePath),
      readFile(input.sourcePath),
    ]);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const key = createAssetObjectKey({
      accountId: input.accountId,
      assetId: id,
      kind,
      mimeType: input.mimeType,
      createdAt,
      originalFilename: input.originalFilename,
    });
    const storage = await this.blobStore.put({
      sourcePath: input.sourcePath,
      key,
      mimeType: input.mimeType,
      metadata: {
        accountId: input.accountId,
        assetId: id,
        kind,
        sha256,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.messageSeq !== undefined ? { messageSeq: String(input.messageSeq) } : {}),
        ...(input.originalFilename ? { originalFilename: input.originalFilename } : {}),
      },
    });

    const record: AssetRecord = {
      id,
      accountId: input.accountId,
      kind,
      mimeType: input.mimeType,
      sizeBytes: fileStat.size,
      sha256,
      storage,
      createdAt,
    };
    try {
      await this.metadataStore.create(record);
    } catch (error) {
      await this.blobStore.delete({ ref: storage }).catch(() => undefined);
      throw error;
    }
    return record;
  }

  get(assetId: string): Promise<AssetRecord | null> {
    return this.metadataStore.get(assetId);
  }

  async read(assetId: string): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const record = await this.metadataStore.get(assetId);
    if (!record) {
      throw new Error(`Asset not found: ${assetId}`);
    }
    const result = await this.blobStore.get({ ref: record.storage });
    return {
      bytes: result.bytes,
      mimeType: result.mimeType === "application/octet-stream" ? record.mimeType : result.mimeType,
    };
  }

  async getAccessUrl(input: {
    assetId: string;
    expiresInSeconds: number;
  }): Promise<string> {
    const record = await this.metadataStore.get(input.assetId);
    if (!record) {
      throw new Error(`Asset not found: ${input.assetId}`);
    }
    if (!this.blobStore.getAccessUrl) {
      throw new Error("Asset blob store does not support access URLs");
    }
    return this.blobStore.getAccessUrl({
      ref: record.storage,
      expiresInSeconds: input.expiresInSeconds,
    });
  }
}
