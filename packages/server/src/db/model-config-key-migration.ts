import { sealSecret } from "../credentials/secret-box.js";
import { createModuleLogger } from "../logger.js";
import { templateEncryptionScope } from "./model-config-store.impl.js";
import { getPrisma } from "./prisma.js";

const migrationLogger = createModuleLogger("model-config");

/**
 * Seal any model provider API keys still sitting in the legacy plaintext column.
 *
 * Idempotent: rows already carrying a ciphertext are skipped, and each migrated
 * row has its plaintext column nulled in the same write. Safe to run on every
 * boot. Returns the number of rows rewritten.
 */
export async function migratePlaintextProviderKeys(): Promise<number> {
  const legacyRows = await getPrisma().modelProviderTemplate.findMany({
    where: {
      apiKey: { not: null },
      apiKeyCiphertext: null,
    },
    select: { id: true, apiKey: true },
  });

  if (legacyRows.length === 0) {
    return 0;
  }

  let migrated = 0;

  for (const row of legacyRows) {
    if (!row.apiKey) {
      continue;
    }

    try {
      await getPrisma().modelProviderTemplate.update({
        where: { id: row.id },
        data: {
          apiKeyCiphertext: sealSecret(templateEncryptionScope(row.id), row.apiKey),
          apiKey: null,
        },
      });
      migrated += 1;
    } catch (error) {
      // Leave the plaintext row untouched so the key keeps working via the read
      // fallback and the next boot retries.
      migrationLogger.error(
        { templateId: String(row.id), err: error },
        "加密模型 Provider API Key 失败，该行仍以明文保留",
      );
    }
  }

  if (migrated > 0) {
    migrationLogger.info({ migrated }, "已将模型 Provider API Key 迁移为加密存储");
  }

  return migrated;
}
