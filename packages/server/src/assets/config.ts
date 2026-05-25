import type { AssetStorageConfig } from "@clawbot/asset";
import type { AppSettingsRow } from "../db/app-settings-store.js";
import { ASSETS_DIR } from "../paths.js";

function requiredEnv(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) {
    throw new Error(`Missing required asset storage environment variable: ${name}`);
  }
  return value;
}

export function resolveAssetStorageConfig(env: NodeJS.ProcessEnv = process.env): AssetStorageConfig {
  const provider = env.ASSET_STORAGE_PROVIDER ?? "local";
  if (provider === "local") {
    return {
      provider: "local",
      baseDir: env.ASSET_LOCAL_BASE_DIR ?? ASSETS_DIR,
    };
  }
  if (provider === "s3-compatible") {
    return {
      provider: "s3-compatible",
      name: env.ASSET_S3_NAME ?? "s3-compatible",
      endpoint: requiredEnv(env, "ASSET_S3_ENDPOINT"),
      region: env.ASSET_S3_REGION ?? "auto",
      bucket: requiredEnv(env, "ASSET_S3_BUCKET"),
      accessKeyId: requiredEnv(env, "ASSET_S3_ACCESS_KEY_ID"),
      secretAccessKey: requiredEnv(env, "ASSET_S3_SECRET_ACCESS_KEY"),
      publicBaseUrl: env.ASSET_S3_PUBLIC_BASE_URL,
    };
  }
  throw new Error(`Unsupported asset storage provider: ${provider}`);
}

function requiredSetting(value: string | null, name: string): string {
  if (!value?.trim()) {
    throw new Error(`Missing required asset storage setting: ${name}`);
  }
  return value.trim();
}

export function resolveAssetStorageConfigFromSettings(
  settings: AppSettingsRow,
): AssetStorageConfig {
  if (settings.assetStorageProvider === "local") {
    return {
      provider: "local",
      baseDir: settings.assetLocalBaseDir?.trim() || ASSETS_DIR,
    };
  }

  return {
    provider: "s3-compatible",
    name: settings.assetS3Name?.trim() || "cloudflare-r2",
    endpoint: requiredSetting(settings.assetS3Endpoint, "asset_s3_endpoint"),
    region: settings.assetS3Region?.trim() || "auto",
    bucket: requiredSetting(settings.assetS3Bucket, "asset_s3_bucket"),
    accessKeyId: requiredSetting(settings.assetS3AccessKeyId, "asset_s3_access_key_id"),
    secretAccessKey: requiredSetting(settings.assetS3SecretAccessKey, "asset_s3_secret_access_key"),
    publicBaseUrl: settings.assetS3PublicBaseUrl?.trim() || undefined,
  };
}
