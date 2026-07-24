/**
 * Sealed-column handling for the AppSettings singleton row.
 *
 * Every field listed here is stored in a `<field>Ciphertext` column and read
 * back through the legacy plaintext column only until the startup migration
 * (app-settings-key-migration.ts) has rewritten the row.
 */

import { openSecretOrNull, sealSecret } from "../credentials/secret-box.js";

export const APP_SETTINGS_SEALED_FIELDS = [
  "rsshubPassword",
  "rsshubBearerToken",
  "assetS3SecretAccessKey",
] as const;

export type AppSettingsSealedField = (typeof APP_SETTINGS_SEALED_FIELDS)[number];

export type AppSettingsCiphertextColumn = `${AppSettingsSealedField}Ciphertext`;

export function appSettingsCiphertextColumn<F extends AppSettingsSealedField>(
  field: F,
): `${F}Ciphertext` {
  return `${field}Ciphertext`;
}

/**
 * Scope is derived from the field, not the row: AppSettings is a singleton
 * (id=1), so a row-derived scope would hand all three secrets the same derived
 * key and let a ciphertext be moved between columns without detection.
 */
export function appSettingsEncryptionScope(field: AppSettingsSealedField): string {
  return `app-settings:${field}`;
}

export function sealAppSettingsSecret(
  field: AppSettingsSealedField,
  plaintext: string,
): string {
  return sealSecret(appSettingsEncryptionScope(field), plaintext);
}

/** Row shape this module reads: both columns for every sealed field. */
export type AppSettingsSecretColumns = Record<AppSettingsSealedField, string | null> &
  Record<AppSettingsCiphertextColumn, string | null>;

/**
 * Resolve one sealed field from the ciphertext column, falling back to the
 * legacy plaintext column for rows the startup migration has not rewritten yet.
 */
export function resolveAppSettingsSecret(
  row: AppSettingsSecretColumns,
  field: AppSettingsSealedField,
): string | null {
  const sealed = row[appSettingsCiphertextColumn(field)];
  if (sealed) {
    return openSecretOrNull(appSettingsEncryptionScope(field), sealed);
  }

  return row[field];
}

/**
 * Write-side mapping for one sealed field: seal into the ciphertext column and
 * always clear the legacy plaintext column so an update never re-introduces a
 * plaintext value the migration already removed.
 */
export function sealedFieldWrite(
  field: AppSettingsSealedField,
  value: string | null,
): Partial<AppSettingsSecretColumns> {
  return {
    [field]: null,
    [appSettingsCiphertextColumn(field)]:
      value === null ? null : sealAppSettingsSecret(field, value),
  };
}
