import { createModuleLogger } from "../logger.js";
import {
  appSettingsStore,
  type AppSettingsRow,
  type AppSettingsStore,
  type UpdateAppSettingsInput,
} from "../db/app-settings-store.js";
import {
  observabilityService,
  type SamplingSettingsConsumer,
} from "../observability/service.js";

const settingsLogger = createModuleLogger("app-settings");
const RSSHUB_AUTH_TYPES = new Set(["none", "basic", "bearer"] as const);
const ASSET_STORAGE_PROVIDERS = new Set(["local", "s3-compatible"] as const);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class AppSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppSettingsValidationError";
  }
}

export interface AppSettingsService {
  get(): Promise<AppSettingsRow>;
  update(payload: unknown): Promise<AppSettingsRow>;
  bootstrap(): Promise<void>;
}

function parseUpdateInput(payload: unknown): UpdateAppSettingsInput {
  if (!isRecord(payload)) {
    throw new AppSettingsValidationError("request body must be a JSON object");
  }

  const allowedKeys = new Set([
    "normal_rate",
    "rsshub_base_url",
    "rsshub_auth_type",
    "rsshub_username",
    "rsshub_password",
    "rsshub_bearer_token",
    "rss_request_timeout_ms",
    "asset_storage_provider",
    "asset_local_base_dir",
    "asset_s3_name",
    "asset_s3_endpoint",
    "asset_s3_region",
    "asset_s3_bucket",
    "asset_s3_access_key_id",
    "asset_s3_secret_access_key",
    "asset_s3_public_base_url",
  ]);
  const keys = Object.keys(payload);

  if (keys.length === 0) {
    throw new AppSettingsValidationError("at least one supported field is required");
  }

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      throw new AppSettingsValidationError(`unknown field: ${key}`);
    }
  }

  const input: UpdateAppSettingsInput = {};

  if ("normal_rate" in payload) {
    const normalRate = payload.normal_rate;
    if (typeof normalRate !== "number" || !Number.isFinite(normalRate)) {
      throw new AppSettingsValidationError("normal_rate must be a finite number");
    }
    if (normalRate < 0 || normalRate > 1) {
      throw new AppSettingsValidationError("normal_rate must be between 0 and 1");
    }

    input.normalRate = normalRate;
  }

  if ("rsshub_base_url" in payload) {
    const rsshubBaseUrl = payload.rsshub_base_url;
    if (rsshubBaseUrl !== null && typeof rsshubBaseUrl !== "string") {
      throw new AppSettingsValidationError("rsshub_base_url must be a string or null");
    }

    input.rsshubBaseUrl = rsshubBaseUrl?.trim() ? rsshubBaseUrl.trim() : null;
  }

  if ("rsshub_auth_type" in payload) {
    const rsshubAuthType = payload.rsshub_auth_type;
    if (typeof rsshubAuthType !== "string" || !RSSHUB_AUTH_TYPES.has(rsshubAuthType as never)) {
      throw new AppSettingsValidationError("rsshub_auth_type must be none, basic, or bearer");
    }

    input.rsshubAuthType = rsshubAuthType as UpdateAppSettingsInput["rsshubAuthType"];

    if (rsshubAuthType === "none") {
      input.rsshubUsername = null;
      input.rsshubPassword = null;
      input.rsshubBearerToken = null;
    }
  }

  if ("rsshub_username" in payload) {
    const rsshubUsername = payload.rsshub_username;
    if (rsshubUsername !== null && typeof rsshubUsername !== "string") {
      throw new AppSettingsValidationError("rsshub_username must be a string or null");
    }

    input.rsshubUsername = rsshubUsername?.trim() ? rsshubUsername.trim() : null;
  }

  if ("rsshub_password" in payload) {
    const rsshubPassword = payload.rsshub_password;
    if (rsshubPassword !== null && typeof rsshubPassword !== "string") {
      throw new AppSettingsValidationError("rsshub_password must be a string or null");
    }

    input.rsshubPassword = rsshubPassword?.trim() ? rsshubPassword : null;
  }

  if ("rsshub_bearer_token" in payload) {
    const rsshubBearerToken = payload.rsshub_bearer_token;
    if (rsshubBearerToken !== null && typeof rsshubBearerToken !== "string") {
      throw new AppSettingsValidationError("rsshub_bearer_token must be a string or null");
    }

    input.rsshubBearerToken = rsshubBearerToken?.trim() ? rsshubBearerToken : null;
  }

  if ("rss_request_timeout_ms" in payload) {
    const rssRequestTimeoutMs = payload.rss_request_timeout_ms;
    if (typeof rssRequestTimeoutMs !== "number" || !Number.isInteger(rssRequestTimeoutMs)) {
      throw new AppSettingsValidationError("rss_request_timeout_ms must be an integer");
    }
    if (rssRequestTimeoutMs < 1_000 || rssRequestTimeoutMs > 120_000) {
      throw new AppSettingsValidationError("rss_request_timeout_ms must be between 1000 and 120000");
    }

    input.rssRequestTimeoutMs = rssRequestTimeoutMs;
  }

  if ("asset_storage_provider" in payload) {
    const provider = payload.asset_storage_provider;
    if (typeof provider !== "string" || !ASSET_STORAGE_PROVIDERS.has(provider as never)) {
      throw new AppSettingsValidationError(
        "asset_storage_provider must be local or s3-compatible",
      );
    }

    input.assetStorageProvider = provider as UpdateAppSettingsInput["assetStorageProvider"];
  }

  if ("asset_local_base_dir" in payload) {
    const value = payload.asset_local_base_dir;
    if (value !== null && typeof value !== "string") {
      throw new AppSettingsValidationError("asset_local_base_dir must be a string or null");
    }
    input.assetLocalBaseDir = value?.trim() ? value.trim() : null;
  }

  if ("asset_s3_name" in payload) {
    const value = payload.asset_s3_name;
    if (value !== null && typeof value !== "string") {
      throw new AppSettingsValidationError("asset_s3_name must be a string or null");
    }
    input.assetS3Name = value?.trim() ? value.trim() : null;
  }

  if ("asset_s3_endpoint" in payload) {
    const value = payload.asset_s3_endpoint;
    if (value !== null && typeof value !== "string") {
      throw new AppSettingsValidationError("asset_s3_endpoint must be a string or null");
    }
    input.assetS3Endpoint = value?.trim() ? value.trim() : null;
  }

  if ("asset_s3_region" in payload) {
    const value = payload.asset_s3_region;
    if (value !== null && typeof value !== "string") {
      throw new AppSettingsValidationError("asset_s3_region must be a string or null");
    }
    input.assetS3Region = value?.trim() ? value.trim() : null;
  }

  if ("asset_s3_bucket" in payload) {
    const value = payload.asset_s3_bucket;
    if (value !== null && typeof value !== "string") {
      throw new AppSettingsValidationError("asset_s3_bucket must be a string or null");
    }
    input.assetS3Bucket = value?.trim() ? value.trim() : null;
  }

  if ("asset_s3_access_key_id" in payload) {
    const value = payload.asset_s3_access_key_id;
    if (value !== null && typeof value !== "string") {
      throw new AppSettingsValidationError("asset_s3_access_key_id must be a string or null");
    }
    input.assetS3AccessKeyId = value?.trim() ? value.trim() : null;
  }

  if ("asset_s3_secret_access_key" in payload) {
    const value = payload.asset_s3_secret_access_key;
    if (value !== null && typeof value !== "string") {
      throw new AppSettingsValidationError(
        "asset_s3_secret_access_key must be a string or null",
      );
    }
    input.assetS3SecretAccessKey = value?.trim() ? value.trim() : null;
  }

  if ("asset_s3_public_base_url" in payload) {
    const value = payload.asset_s3_public_base_url;
    if (value !== null && typeof value !== "string") {
      throw new AppSettingsValidationError("asset_s3_public_base_url must be a string or null");
    }
    input.assetS3PublicBaseUrl = value?.trim() ? value.trim() : null;
  }

  if (input.assetStorageProvider === "local") {
    input.assetS3Name = null;
    input.assetS3Endpoint = null;
    input.assetS3Region = null;
    input.assetS3Bucket = null;
    input.assetS3AccessKeyId = null;
    input.assetS3SecretAccessKey = null;
    input.assetS3PublicBaseUrl = null;
  }

  return input;
}

export function createAppSettingsService(
  store: AppSettingsStore = appSettingsStore,
  samplingConsumer: SamplingSettingsConsumer = observabilityService,
): AppSettingsService {
  return {
    async get() {
      return store.get();
    },

    async update(payload) {
      const input = parseUpdateInput(payload);
      const row = await store.update(input);
      samplingConsumer.setSamplingNormalRate(row.normalRate);
      settingsLogger.info(
        {
          normalRate: row.normalRate,
          rsshubBaseUrl: row.rsshubBaseUrl,
          rsshubAuthType: row.rsshubAuthType,
          rssRequestTimeoutMs: row.rssRequestTimeoutMs,
          assetStorageProvider: row.assetStorageProvider,
        },
        "全局设置已更新",
      );
      return row;
    },

    async bootstrap() {
      const row = await store.get();
      samplingConsumer.setSamplingNormalRate(row.normalRate);
      settingsLogger.info(
        {
          normalRate: row.normalRate,
          rsshubBaseUrl: row.rsshubBaseUrl,
          rsshubAuthType: row.rsshubAuthType,
          rssRequestTimeoutMs: row.rssRequestTimeoutMs,
          assetStorageProvider: row.assetStorageProvider,
        },
        "已加载全局设置",
      );
    },
  };
}

export const appSettingsService = createAppSettingsService();
