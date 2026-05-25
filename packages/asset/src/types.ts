export type AssetKind = "image" | "video" | "audio" | "file";

export interface AssetRecord {
  id: string;
  accountId: string;
  kind: AssetKind;
  mimeType: string;
  sizeBytes?: number;
  sha256?: string;
  storage: AssetStorageRef;
  width?: number;
  height?: number;
  durationMs?: number;
  createdAt: Date;
  updatedAt?: Date;
}

export type AssetStorageRef =
  | {
      provider: "local";
      path: string;
    }
  | {
      provider: "s3-compatible";
      bucket: string;
      key: string;
      endpoint?: string;
    }
  | {
      provider: "custom";
      name: string;
      ref: Record<string, unknown>;
    };

export type AssetStorageConfig =
  | {
      provider: "local";
      baseDir: string;
    }
  | {
      provider: "s3-compatible";
      name: string;
      endpoint: string;
      region: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
      publicBaseUrl?: string;
    };

export interface AssetMetadataStore {
  create(record: AssetRecord): Promise<void>;
  get(assetId: string): Promise<AssetRecord | null>;
  listByAccount(input: {
    accountId: string;
    kind?: AssetKind;
    limit: number;
    cursor?: string;
  }): Promise<{
    data: AssetRecord[];
    nextCursor?: string;
  }>;
  delete(assetId: string): Promise<void>;
}

export interface AssetBlobStore {
  put(input: {
    sourcePath: string;
    key: string;
    mimeType: string;
    metadata?: Record<string, string>;
  }): Promise<AssetStorageRef>;

  get(input: {
    ref: AssetStorageRef;
  }): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }>;

  delete(input: {
    ref: AssetStorageRef;
  }): Promise<void>;

  getAccessUrl?(input: {
    ref: AssetStorageRef;
    expiresInSeconds: number;
  }): Promise<string>;
}

export interface AssetService {
  createFromFile(input: {
    accountId: string;
    sourcePath: string;
    mimeType: string;
    kind?: AssetKind;
    conversationId?: string;
    messageSeq?: number;
    originalFilename?: string;
  }): Promise<AssetRecord>;

  get(assetId: string): Promise<AssetRecord | null>;

  read(assetId: string): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }>;

  getAccessUrl(input: {
    assetId: string;
    expiresInSeconds: number;
  }): Promise<string>;
}
