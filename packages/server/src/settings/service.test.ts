import assert from "node:assert/strict";
import test from "node:test";
import {
  AppSettingsValidationError,
  createAppSettingsService,
} from "./service.js";
import type {
  AppSettingsRow,
  AppSettingsStore,
} from "../db/app-settings-store.js";
import type { SamplingSettingsConsumer } from "../observability/service.js";

function createRow(overrides: Partial<AppSettingsRow> = {}): AppSettingsRow {
  return {
    id: 1,
    normalRate: 0.1,
    rsshubBaseUrl: null,
    rsshubAuthType: "none",
    rsshubUsername: null,
    rsshubPassword: null,
    rsshubBearerToken: null,
    rssRequestTimeoutMs: 15000,
    assetStorageProvider: "local",
    assetLocalBaseDir: null,
    assetS3Name: null,
    assetS3Endpoint: null,
    assetS3Region: null,
    assetS3Bucket: null,
    assetS3AccessKeyId: null,
    assetS3SecretAccessKey: null,
    assetS3PublicBaseUrl: null,
    createdAt: new Date("2026-04-22T00:00:00.000Z"),
    updatedAt: new Date("2026-04-22T00:00:00.000Z"),
    ...overrides,
  };
}

function createStore(initialRow: AppSettingsRow = createRow()): AppSettingsStore {
  let row = initialRow;

  return {
    async get() {
      return row;
    },

    async update(input) {
      row = createRow({
        ...row,
        normalRate: input.normalRate ?? row.normalRate,
        rsshubBaseUrl:
          input.rsshubBaseUrl !== undefined ? input.rsshubBaseUrl : row.rsshubBaseUrl,
        rsshubAuthType:
          input.rsshubAuthType !== undefined ? input.rsshubAuthType : row.rsshubAuthType,
        rsshubUsername:
          input.rsshubUsername !== undefined ? input.rsshubUsername : row.rsshubUsername,
        rsshubPassword:
          input.rsshubPassword !== undefined ? input.rsshubPassword : row.rsshubPassword,
        rsshubBearerToken:
          input.rsshubBearerToken !== undefined
            ? input.rsshubBearerToken
            : row.rsshubBearerToken,
        rssRequestTimeoutMs:
          input.rssRequestTimeoutMs !== undefined
            ? input.rssRequestTimeoutMs
            : row.rssRequestTimeoutMs,
        assetStorageProvider:
          input.assetStorageProvider !== undefined
            ? input.assetStorageProvider
            : row.assetStorageProvider,
        assetLocalBaseDir:
          input.assetLocalBaseDir !== undefined
            ? input.assetLocalBaseDir
            : row.assetLocalBaseDir,
        assetS3Name: input.assetS3Name !== undefined ? input.assetS3Name : row.assetS3Name,
        assetS3Endpoint:
          input.assetS3Endpoint !== undefined ? input.assetS3Endpoint : row.assetS3Endpoint,
        assetS3Region:
          input.assetS3Region !== undefined ? input.assetS3Region : row.assetS3Region,
        assetS3Bucket:
          input.assetS3Bucket !== undefined ? input.assetS3Bucket : row.assetS3Bucket,
        assetS3AccessKeyId:
          input.assetS3AccessKeyId !== undefined
            ? input.assetS3AccessKeyId
            : row.assetS3AccessKeyId,
        assetS3SecretAccessKey:
          input.assetS3SecretAccessKey !== undefined
            ? input.assetS3SecretAccessKey
            : row.assetS3SecretAccessKey,
        assetS3PublicBaseUrl:
          input.assetS3PublicBaseUrl !== undefined
            ? input.assetS3PublicBaseUrl
            : row.assetS3PublicBaseUrl,
        updatedAt: new Date("2026-04-23T00:00:00.000Z"),
      });
      return row;
    },
  };
}

function createSamplingConsumer(): SamplingSettingsConsumer & {
  currentNormalRate: number;
} {
  return {
    currentNormalRate: 0.1,
    setSamplingNormalRate(normalRate) {
      this.currentNormalRate = normalRate;
    },
  };
}

test("bootstrap loads database normalRate into observability runtime", async () => {
  const samplingConsumer = createSamplingConsumer();
  const service = createAppSettingsService(
    createStore(createRow({ normalRate: 0.35 })),
    samplingConsumer,
  );

  await service.bootstrap();

  assert.equal(samplingConsumer.currentNormalRate, 0.35);
});

test("update validates payload and syncs latest sampling rate", async () => {
  const samplingConsumer = createSamplingConsumer();
  const service = createAppSettingsService(createStore(), samplingConsumer);

  const row = await service.update({ normal_rate: 0.42 });

  assert.equal(row.normalRate, 0.42);
  assert.equal(samplingConsumer.currentNormalRate, 0.42);
});

test("update supports rss settings and clears auth fields when auth is none", async () => {
  const service = createAppSettingsService(
    createStore(
      createRow({
        rsshubAuthType: "basic",
        rsshubUsername: "alice",
        rsshubPassword: "secret",
      }),
    ),
    createSamplingConsumer(),
  );

  const row = await service.update({
    rsshub_base_url: "https://rsshub.example.com",
    rsshub_auth_type: "none",
    rss_request_timeout_ms: 20000,
  });

  assert.equal(row.rsshubBaseUrl, "https://rsshub.example.com");
  assert.equal(row.rsshubAuthType, "none");
  assert.equal(row.rsshubUsername, null);
  assert.equal(row.rsshubPassword, null);
  assert.equal(row.rssRequestTimeoutMs, 20000);
});

test("update supports R2-compatible asset storage settings", async () => {
  const service = createAppSettingsService(createStore(), createSamplingConsumer());

  const row = await service.update({
    asset_storage_provider: "s3-compatible",
    asset_s3_name: "cloudflare-r2",
    asset_s3_endpoint: " https://example.r2.cloudflarestorage.com ",
    asset_s3_region: "auto",
    asset_s3_bucket: "clawbot-assets",
    asset_s3_access_key_id: "access-key",
    asset_s3_secret_access_key: " secret-key ",
    asset_s3_public_base_url: "https://assets.example.com",
  });

  assert.equal(row.assetStorageProvider, "s3-compatible");
  assert.equal(row.assetS3Name, "cloudflare-r2");
  assert.equal(row.assetS3Endpoint, "https://example.r2.cloudflarestorage.com");
  assert.equal(row.assetS3Region, "auto");
  assert.equal(row.assetS3Bucket, "clawbot-assets");
  assert.equal(row.assetS3AccessKeyId, "access-key");
  assert.equal(row.assetS3SecretAccessKey, "secret-key");
  assert.equal(row.assetS3PublicBaseUrl, "https://assets.example.com");
});

test("update rejects missing or unsupported fields", async () => {
  const service = createAppSettingsService(createStore(), createSamplingConsumer());

  await assert.rejects(
    service.update({}),
    (error: unknown) =>
      error instanceof AppSettingsValidationError &&
      error.message === "at least one supported field is required",
  );

  await assert.rejects(
    service.update({ proxy_url: "http://localhost:7890" }),
    (error: unknown) =>
      error instanceof AppSettingsValidationError &&
      error.message === "unknown field: proxy_url",
  );
});

test("update rejects out-of-range and non-numeric normal_rate", async () => {
  const service = createAppSettingsService(createStore(), createSamplingConsumer());

  await assert.rejects(
    service.update({ normal_rate: 1.2 }),
    (error: unknown) =>
      error instanceof AppSettingsValidationError &&
      error.message === "normal_rate must be between 0 and 1",
  );

  await assert.rejects(
    service.update({ normal_rate: "0.2" }),
    (error: unknown) =>
      error instanceof AppSettingsValidationError &&
      error.message === "normal_rate must be a finite number",
  );

  await assert.rejects(
    service.update({ rsshub_auth_type: "token" }),
    (error: unknown) =>
      error instanceof AppSettingsValidationError &&
      error.message === "rsshub_auth_type must be none, basic, or bearer",
  );

  await assert.rejects(
    service.update({ rss_request_timeout_ms: 999 }),
    (error: unknown) =>
      error instanceof AppSettingsValidationError &&
      error.message === "rss_request_timeout_ms must be between 1000 and 120000",
  );
});
