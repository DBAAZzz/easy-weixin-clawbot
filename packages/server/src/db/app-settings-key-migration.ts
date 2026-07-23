import { createModuleLogger, getErrorFields } from "../logger.js";
import {
  APP_SETTINGS_SEALED_FIELDS,
  appSettingsCiphertextColumn,
  sealAppSettingsSecret,
  type AppSettingsSealedField,
} from "./app-settings-secrets.js";
import { getPrisma } from "./prisma.js";

const migrationLogger = createModuleLogger("app-settings");

/**
 * Seal any AppSettings secrets still sitting in their legacy plaintext columns.
 *
 * Idempotent: fields already carrying a ciphertext are skipped, and each
 * migrated field has its plaintext column nulled in the same write. Safe to run
 * on every boot. Returns the number of fields rewritten.
 */
export async function migratePlaintextAppSettingsSecrets(): Promise<number> {
  const row = await getPrisma().appSettings.findFirst({
    orderBy: { id: "asc" },
  });

  if (!row) {
    return 0;
  }

  const data: Record<string, string | null> = {};
  const migratedFields: AppSettingsSealedField[] = [];

  for (const field of APP_SETTINGS_SEALED_FIELDS) {
    const plaintext = row[field];
    if (!plaintext || row[appSettingsCiphertextColumn(field)]) {
      continue;
    }

    data[appSettingsCiphertextColumn(field)] = sealAppSettingsSecret(field, plaintext);
    data[field] = null;
    migratedFields.push(field);
  }

  if (migratedFields.length === 0) {
    return 0;
  }

  try {
    await getPrisma().appSettings.update({ where: { id: row.id }, data });
  } catch (error) {
    // Leave the plaintext columns untouched so the secrets keep working via the
    // read fallback and the next boot retries.
    migrationLogger.error(
      { ...getErrorFields(error), fields: migratedFields },
      "加密 AppSettings 密钥失败，这些字段仍以明文保留",
    );
    return 0;
  }

  migrationLogger.info({ fields: migratedFields }, "已将 AppSettings 密钥迁移为加密存储");

  return migratedFields.length;
}
