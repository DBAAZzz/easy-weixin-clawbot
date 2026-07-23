import {
  APP_SETTINGS_SEALED_FIELDS,
  resolveAppSettingsSecret,
  sealedFieldWrite,
  type AppSettingsSecretColumns,
} from "./app-settings-secrets.js";
import { getPrisma } from "./prisma.js";

const APP_SETTINGS_SINGLETON_ID = 1;

export interface AppSettingsRow {
  id: number;
  normalRate: number;
  rsshubBaseUrl: string | null;
  rsshubAuthType: "none" | "basic" | "bearer";
  rsshubUsername: string | null;
  rsshubPassword: string | null;
  rsshubBearerToken: string | null;
  rssRequestTimeoutMs: number;
  assetStorageProvider: "local" | "s3-compatible";
  assetLocalBaseDir: string | null;
  assetS3Name: string | null;
  assetS3Endpoint: string | null;
  assetS3Region: string | null;
  assetS3Bucket: string | null;
  assetS3AccessKeyId: string | null;
  assetS3SecretAccessKey: string | null;
  assetS3PublicBaseUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateAppSettingsInput {
  normalRate?: number;
  rsshubBaseUrl?: string | null;
  rsshubAuthType?: "none" | "basic" | "bearer";
  rsshubUsername?: string | null;
  rsshubPassword?: string | null;
  rsshubBearerToken?: string | null;
  rssRequestTimeoutMs?: number;
  assetStorageProvider?: "local" | "s3-compatible";
  assetLocalBaseDir?: string | null;
  assetS3Name?: string | null;
  assetS3Endpoint?: string | null;
  assetS3Region?: string | null;
  assetS3Bucket?: string | null;
  assetS3AccessKeyId?: string | null;
  assetS3SecretAccessKey?: string | null;
  assetS3PublicBaseUrl?: string | null;
}

/**
 * Column-level shape of the `app_settings` row, including the sealed columns the
 * public {@link AppSettingsRow} deliberately hides behind plaintext values.
 */
export interface AppSettingsColumns extends AppSettingsSecretColumns {
  id: number;
  normalRate: number;
  rsshubBaseUrl: string | null;
  rsshubAuthType: string;
  rsshubUsername: string | null;
  rssRequestTimeoutMs: number;
  assetStorageProvider: string;
  assetLocalBaseDir: string | null;
  assetS3Name: string | null;
  assetS3Endpoint: string | null;
  assetS3Region: string | null;
  assetS3Bucket: string | null;
  assetS3AccessKeyId: string | null;
  assetS3PublicBaseUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

type AppSettingsWriteColumns = Partial<
  Omit<AppSettingsColumns, "id" | "createdAt" | "updatedAt">
>;

interface AppSettingsPrismaClient {
  appSettings: {
    upsert(args: {
      where: { id: number };
      create: AppSettingsWriteColumns & { id: number };
      update: AppSettingsWriteColumns;
    }): Promise<AppSettingsColumns>;
  };
}

function toRsshubAuthType(value: string): AppSettingsRow["rsshubAuthType"] {
  return value === "basic" || value === "bearer" ? value : "none";
}

function toAssetStorageProvider(value: string): AppSettingsRow["assetStorageProvider"] {
  return value === "s3-compatible" ? "s3-compatible" : "local";
}

export interface AppSettingsStore {
  get(): Promise<AppSettingsRow>;
  update(input: UpdateAppSettingsInput): Promise<AppSettingsRow>;
}

function toRow(row: AppSettingsColumns): AppSettingsRow {
  return {
    id: row.id,
    normalRate: row.normalRate,
    rsshubBaseUrl: row.rsshubBaseUrl,
    rsshubAuthType: toRsshubAuthType(row.rsshubAuthType),
    rsshubUsername: row.rsshubUsername,
    rsshubPassword: resolveAppSettingsSecret(row, "rsshubPassword"),
    rsshubBearerToken: resolveAppSettingsSecret(row, "rsshubBearerToken"),
    rssRequestTimeoutMs: row.rssRequestTimeoutMs,
    assetStorageProvider: toAssetStorageProvider(row.assetStorageProvider),
    assetLocalBaseDir: row.assetLocalBaseDir,
    assetS3Name: row.assetS3Name,
    assetS3Endpoint: row.assetS3Endpoint,
    assetS3Region: row.assetS3Region,
    assetS3Bucket: row.assetS3Bucket,
    assetS3AccessKeyId: row.assetS3AccessKeyId,
    assetS3SecretAccessKey: resolveAppSettingsSecret(row, "assetS3SecretAccessKey"),
    assetS3PublicBaseUrl: row.assetS3PublicBaseUrl,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Map the sealed fields present in `input` onto their ciphertext columns.
 * Table-driven so a new sealed field only has to be added to
 * APP_SETTINGS_SEALED_FIELDS.
 */
function toSealedWrite(input: UpdateAppSettingsInput): AppSettingsWriteColumns {
  let data: AppSettingsWriteColumns = {};

  for (const field of APP_SETTINGS_SEALED_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    data = { ...data, ...sealedFieldWrite(field, value) };
  }

  return data;
}

function toPrismaUpdate(input: UpdateAppSettingsInput): AppSettingsWriteColumns {
  return {
    ...(input.normalRate !== undefined ? { normalRate: input.normalRate } : {}),
    ...(input.rsshubBaseUrl !== undefined ? { rsshubBaseUrl: input.rsshubBaseUrl } : {}),
    ...(input.rsshubAuthType !== undefined ? { rsshubAuthType: input.rsshubAuthType } : {}),
    ...(input.rsshubUsername !== undefined ? { rsshubUsername: input.rsshubUsername } : {}),
    ...(input.rssRequestTimeoutMs !== undefined
      ? { rssRequestTimeoutMs: input.rssRequestTimeoutMs }
      : {}),
    ...(input.assetStorageProvider !== undefined
      ? { assetStorageProvider: input.assetStorageProvider }
      : {}),
    ...(input.assetLocalBaseDir !== undefined
      ? { assetLocalBaseDir: input.assetLocalBaseDir }
      : {}),
    ...(input.assetS3Name !== undefined ? { assetS3Name: input.assetS3Name } : {}),
    ...(input.assetS3Endpoint !== undefined ? { assetS3Endpoint: input.assetS3Endpoint } : {}),
    ...(input.assetS3Region !== undefined ? { assetS3Region: input.assetS3Region } : {}),
    ...(input.assetS3Bucket !== undefined ? { assetS3Bucket: input.assetS3Bucket } : {}),
    ...(input.assetS3AccessKeyId !== undefined
      ? { assetS3AccessKeyId: input.assetS3AccessKeyId }
      : {}),
    ...(input.assetS3PublicBaseUrl !== undefined
      ? { assetS3PublicBaseUrl: input.assetS3PublicBaseUrl }
      : {}),
    ...toSealedWrite(input),
  };
}

export function createAppSettingsStore(
  prisma?: AppSettingsPrismaClient,
): AppSettingsStore {
  return {
    async get() {
      const row = await (prisma ?? getPrisma()).appSettings.upsert({
        where: { id: APP_SETTINGS_SINGLETON_ID },
        create: { id: APP_SETTINGS_SINGLETON_ID },
        update: {},
      });

      return toRow(row);
    },

    async update(input) {
      const data = toPrismaUpdate(input);
      const row = await (prisma ?? getPrisma()).appSettings.upsert({
        where: { id: APP_SETTINGS_SINGLETON_ID },
        create: {
          id: APP_SETTINGS_SINGLETON_ID,
          ...data,
        },
        update: data,
      });

      return toRow(row);
    },
  };
}

export const appSettingsStore = createAppSettingsStore();
