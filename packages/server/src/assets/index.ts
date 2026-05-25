import type { AssetBlobStore, AssetService, AssetStorageRef } from "@clawbot/asset";
import { PrismaAssetMetadataStore } from "../db/asset-metadata-store.impl.js";
import { appSettingsStore } from "../db/app-settings-store.js";
import { LocalAssetBlobStore } from "./local-blob-store.js";
import { S3CompatibleAssetBlobStore } from "./s3-compatible-blob-store.js";
import { ServerAssetService } from "./asset-service.js";
import { resolveAssetStorageConfigFromSettings } from "./config.js";

let assetService: AssetService | null = null;

class DynamicAssetBlobStore implements AssetBlobStore {
  private localStores = new Map<string, LocalAssetBlobStore>();
  private s3Stores = new Map<string, S3CompatibleAssetBlobStore>();

  async put(input: {
    sourcePath: string;
    key: string;
    mimeType: string;
    metadata?: Record<string, string>;
  }): Promise<AssetStorageRef> {
    const store = await this.getActiveStore();
    return store.put(input);
  }

  async get(input: { ref: AssetStorageRef }): Promise<{ bytes: Uint8Array; mimeType: string }> {
    const store = await this.getStoreForRef(input.ref);
    return store.get(input);
  }

  async delete(input: { ref: AssetStorageRef }): Promise<void> {
    const store = await this.getStoreForRef(input.ref);
    return store.delete(input);
  }

  async getAccessUrl(input: {
    ref: AssetStorageRef;
    expiresInSeconds: number;
  }): Promise<string> {
    const store = await this.getStoreForRef(input.ref);
    if (!store.getAccessUrl) {
      throw new Error("Asset blob store does not support access URLs");
    }
    return store.getAccessUrl(input);
  }

  private async getActiveStore(): Promise<AssetBlobStore> {
    const settings = await appSettingsStore.get();
    const config = resolveAssetStorageConfigFromSettings(settings);
    if (config.provider === "local") {
      return this.getLocalStore(config.baseDir);
    }
    return this.getS3Store({
      endpoint: config.endpoint,
      region: config.region,
      bucket: config.bucket,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      publicBaseUrl: config.publicBaseUrl,
    });
  }

  private async getStoreForRef(ref: AssetStorageRef): Promise<AssetBlobStore> {
    if (ref.provider === "local") {
      const settings = await appSettingsStore.get();
    const config = resolveAssetStorageConfigFromSettings({
      ...settings,
      assetStorageProvider: "local",
    });
    if (config.provider !== "local") {
      throw new Error("Expected local asset storage config");
    }
    return this.getLocalStore(config.baseDir);
    }
    if (ref.provider === "s3-compatible") {
      const settings = await appSettingsStore.get();
      const config = resolveAssetStorageConfigFromSettings({
        ...settings,
        assetStorageProvider: "s3-compatible",
        assetS3Endpoint: ref.endpoint ?? settings.assetS3Endpoint,
        assetS3Bucket: ref.bucket,
      });
      if (config.provider !== "s3-compatible") {
        throw new Error("Expected s3-compatible asset storage config");
      }
      return this.getS3Store({
        endpoint: config.endpoint,
        region: config.region,
        bucket: ref.bucket,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        publicBaseUrl: config.publicBaseUrl,
      });
    }
    throw new Error(`Unsupported asset storage provider: ${ref.provider}`);
  }

  private getLocalStore(baseDir: string): LocalAssetBlobStore {
    const existing = this.localStores.get(baseDir);
    if (existing) return existing;
    const store = new LocalAssetBlobStore(baseDir);
    this.localStores.set(baseDir, store);
    return store;
  }

  private getS3Store(config: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicBaseUrl?: string;
  }): S3CompatibleAssetBlobStore {
    const key = JSON.stringify(config);
    const existing = this.s3Stores.get(key);
    if (existing) return existing;
    const store = new S3CompatibleAssetBlobStore(config);
    this.s3Stores.set(key, store);
    return store;
  }
}

export function getAssetService(): AssetService {
  if (!assetService) {
    assetService = new ServerAssetService(
      new PrismaAssetMetadataStore(),
      new DynamicAssetBlobStore(),
    );
  }
  return assetService;
}

export function setAssetServiceForTesting(service: AssetService | null): void {
  assetService = service;
}

export { resolveAssetStorageConfig, resolveAssetStorageConfigFromSettings } from "./config.js";
export { LocalAssetBlobStore } from "./local-blob-store.js";
export { S3CompatibleAssetBlobStore } from "./s3-compatible-blob-store.js";
export type { S3CompatibleAssetBlobStoreConfig } from "./s3-compatible-blob-store.js";
export { ServerAssetService } from "./asset-service.js";
