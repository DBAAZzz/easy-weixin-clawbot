/**
 * Startup entry point for every "seal a legacy plaintext secret column"
 * migration. Boot calls this once; adding a new sealed column means adding a
 * step here rather than another branch in index.ts.
 */

import { createModuleLogger, getErrorFields } from "../logger.js";
import { migratePlaintextAppSettingsSecrets } from "./app-settings-key-migration.js";
import { migratePlaintextProviderKeys } from "./model-config-key-migration.js";

const migrationLogger = createModuleLogger("secret-migrations");

interface SecretMigration {
  /** Subsystem name, used for the failure log so a partial run is attributable. */
  subsystem: string;
  run(): Promise<number>;
}

const MIGRATIONS: SecretMigration[] = [
  { subsystem: "model-config", run: migratePlaintextProviderKeys },
  { subsystem: "app-settings", run: migratePlaintextAppSettingsSecrets },
];

/**
 * Run every sealed-secret migration. Individual failures are logged and
 * skipped: the affected rows keep working through their plaintext read
 * fallback, and the next boot retries. Never throws.
 */
export async function migratePlaintextSecrets(): Promise<void> {
  for (const migration of MIGRATIONS) {
    try {
      await migration.run();
    } catch (error) {
      migrationLogger.warn(
        { ...getErrorFields(error), subsystem: migration.subsystem },
        "迁移明文密钥失败，将继续以明文回退读取",
      );
    }
  }
}
