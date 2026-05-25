import type { Hono } from "hono";
import type { AppSettingsDto } from "@clawbot/shared";
import {
  AppSettingsValidationError,
  appSettingsService,
  type AppSettingsService,
} from "../../settings/service.js";
import type { AppSettingsRow } from "../../db/app-settings-store.js";

function toDto(row: AppSettingsRow): AppSettingsDto {
  return {
    normal_rate: row.normalRate,
    rsshub_base_url: row.rsshubBaseUrl,
    rsshub_auth_type: row.rsshubAuthType,
    rsshub_username: row.rsshubUsername,
    rsshub_password_set: Boolean(row.rsshubPassword),
    rsshub_bearer_token_set: Boolean(row.rsshubBearerToken),
    rss_request_timeout_ms: row.rssRequestTimeoutMs,
    asset_storage_provider: row.assetStorageProvider,
    asset_local_base_dir: row.assetLocalBaseDir,
    asset_s3_name: row.assetS3Name,
    asset_s3_endpoint: row.assetS3Endpoint,
    asset_s3_region: row.assetS3Region,
    asset_s3_bucket: row.assetS3Bucket,
    asset_s3_access_key_id: row.assetS3AccessKeyId,
    asset_s3_secret_access_key_set: Boolean(row.assetS3SecretAccessKey),
    asset_s3_public_base_url: row.assetS3PublicBaseUrl,
    updated_at: row.updatedAt.toISOString(),
  };
}

export function registerSettingsRoutes(
  app: Hono,
  service: AppSettingsService = appSettingsService,
) {
  app.get("/api/settings", async (c) => {
    const row = await service.get();
    return c.json({ data: toDto(row) });
  });

  app.patch("/api/settings", async (c) => {
    try {
      const body = await c.req.json().catch(() => null);
      const row = await service.update(body);
      return c.json({ data: toDto(row) });
    } catch (error) {
      if (error instanceof AppSettingsValidationError) {
        return c.json({ error: error.message }, 400);
      }

      throw error;
    }
  });
}
