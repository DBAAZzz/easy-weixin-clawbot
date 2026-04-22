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

  const allowedKeys = new Set(["normal_rate"]);
  const keys = Object.keys(payload);

  if (keys.length === 0) {
    throw new AppSettingsValidationError("at least one supported field is required");
  }

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      throw new AppSettingsValidationError(`unknown field: ${key}`);
    }
  }

  const normalRate = payload.normal_rate;
  if (typeof normalRate !== "number" || !Number.isFinite(normalRate)) {
    throw new AppSettingsValidationError("normal_rate must be a finite number");
  }
  if (normalRate < 0 || normalRate > 1) {
    throw new AppSettingsValidationError("normal_rate must be between 0 and 1");
  }

  return { normalRate };
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
      settingsLogger.info({ normalRate: row.normalRate }, "全局设置已更新");
      return row;
    },

    async bootstrap() {
      const row = await store.get();
      samplingConsumer.setSamplingNormalRate(row.normalRate);
      settingsLogger.info({ normalRate: row.normalRate }, "已加载全局设置");
    },
  };
}

export const appSettingsService = createAppSettingsService();
