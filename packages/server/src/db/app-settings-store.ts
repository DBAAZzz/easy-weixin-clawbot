import { getPrisma } from "./prisma.js";

const APP_SETTINGS_SINGLETON_ID = 1;

export interface AppSettingsRow {
  id: number;
  normalRate: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateAppSettingsInput {
  normalRate?: number;
}

interface AppSettingsPrismaClient {
  appSettings: {
    upsert(args: {
      where: { id: number };
      create: { id: number; normalRate?: number };
      update: { normalRate?: number };
    }): Promise<{
      id: number;
      normalRate: number;
      createdAt: Date;
      updatedAt: Date;
    }>;
  };
}

export interface AppSettingsStore {
  get(): Promise<AppSettingsRow>;
  update(input: UpdateAppSettingsInput): Promise<AppSettingsRow>;
}

function toRow(row: {
  id: number;
  normalRate: number;
  createdAt: Date;
  updatedAt: Date;
}): AppSettingsRow {
  return {
    id: row.id,
    normalRate: row.normalRate,
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
        },
        update: {
          ...(input.normalRate !== undefined ? { normalRate: input.normalRate } : {}),
        },
      });

      return toRow(row);
    },
  };
}

export const appSettingsStore = createAppSettingsStore();
