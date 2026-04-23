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
}

interface AppSettingsPrismaClient {
  appSettings: {
    upsert(args: {
      where: { id: number };
      create: {
        id: number;
        normalRate?: number;
        rsshubBaseUrl?: string | null;
        rsshubAuthType?: "none" | "basic" | "bearer";
        rsshubUsername?: string | null;
        rsshubPassword?: string | null;
        rsshubBearerToken?: string | null;
        rssRequestTimeoutMs?: number;
      };
      update: {
        normalRate?: number;
        rsshubBaseUrl?: string | null;
        rsshubAuthType?: "none" | "basic" | "bearer";
        rsshubUsername?: string | null;
        rsshubPassword?: string | null;
        rsshubBearerToken?: string | null;
        rssRequestTimeoutMs?: number;
      };
    }): Promise<{
      id: number;
      normalRate: number;
      rsshubBaseUrl: string | null;
      rsshubAuthType: "none" | "basic" | "bearer";
      rsshubUsername: string | null;
      rsshubPassword: string | null;
      rsshubBearerToken: string | null;
      rssRequestTimeoutMs: number;
      createdAt: Date;
      updatedAt: Date;
    }>;
  };
}

function toRsshubAuthType(value: string): AppSettingsRow["rsshubAuthType"] {
  return value === "basic" || value === "bearer" ? value : "none";
}

export interface AppSettingsStore {
  get(): Promise<AppSettingsRow>;
  update(input: UpdateAppSettingsInput): Promise<AppSettingsRow>;
}

function toRow(row: {
  id: number;
  normalRate: number;
  rsshubBaseUrl: string | null;
  rsshubAuthType: string;
  rsshubUsername: string | null;
  rsshubPassword: string | null;
  rsshubBearerToken: string | null;
  rssRequestTimeoutMs: number;
  createdAt: Date;
  updatedAt: Date;
}): AppSettingsRow {
  return {
    id: row.id,
    normalRate: row.normalRate,
    rsshubBaseUrl: row.rsshubBaseUrl,
    rsshubAuthType: toRsshubAuthType(row.rsshubAuthType),
    rsshubUsername: row.rsshubUsername,
    rsshubPassword: row.rsshubPassword,
    rsshubBearerToken: row.rsshubBearerToken,
    rssRequestTimeoutMs: row.rssRequestTimeoutMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
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
      const row = await (prisma ?? getPrisma()).appSettings.upsert({
        where: { id: APP_SETTINGS_SINGLETON_ID },
        create: {
          id: APP_SETTINGS_SINGLETON_ID,
          ...(input.normalRate !== undefined ? { normalRate: input.normalRate } : {}),
          ...(input.rsshubBaseUrl !== undefined ? { rsshubBaseUrl: input.rsshubBaseUrl } : {}),
          ...(input.rsshubAuthType !== undefined ? { rsshubAuthType: input.rsshubAuthType } : {}),
          ...(input.rsshubUsername !== undefined ? { rsshubUsername: input.rsshubUsername } : {}),
          ...(input.rsshubPassword !== undefined ? { rsshubPassword: input.rsshubPassword } : {}),
          ...(input.rsshubBearerToken !== undefined
            ? { rsshubBearerToken: input.rsshubBearerToken }
            : {}),
          ...(input.rssRequestTimeoutMs !== undefined
            ? { rssRequestTimeoutMs: input.rssRequestTimeoutMs }
            : {}),
        },
        update: {
          ...(input.normalRate !== undefined ? { normalRate: input.normalRate } : {}),
          ...(input.rsshubBaseUrl !== undefined ? { rsshubBaseUrl: input.rsshubBaseUrl } : {}),
          ...(input.rsshubAuthType !== undefined ? { rsshubAuthType: input.rsshubAuthType } : {}),
          ...(input.rsshubUsername !== undefined ? { rsshubUsername: input.rsshubUsername } : {}),
          ...(input.rsshubPassword !== undefined ? { rsshubPassword: input.rsshubPassword } : {}),
          ...(input.rsshubBearerToken !== undefined
            ? { rsshubBearerToken: input.rsshubBearerToken }
            : {}),
          ...(input.rssRequestTimeoutMs !== undefined
            ? { rssRequestTimeoutMs: input.rssRequestTimeoutMs }
            : {}),
        },
      });

      return toRow(row);
    },
  };
}

export const appSettingsStore = createAppSettingsStore();
