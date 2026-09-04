import assert from "node:assert/strict";
import test from "node:test";
import {
  appSettingsCiphertextColumn,
  sealAppSettingsSecret,
} from "../../src/db/app-settings-secrets.js";
import { createAppSettingsStore, type AppSettingsColumns } from "../../src/db/app-settings-store.js";

function createColumns(overrides: Partial<AppSettingsColumns> = {}): AppSettingsColumns {
  return {
    id: 1,
    normalRate: 0.1,
    rsshubBaseUrl: null,
    rsshubAuthType: "none",
    rsshubUsername: null,
    rsshubPassword: null,
    rsshubPasswordCiphertext: null,
    rsshubBearerToken: null,
    rsshubBearerTokenCiphertext: null,
    rssRequestTimeoutMs: 15000,
    assetStorageProvider: "local",
    assetLocalBaseDir: null,
    assetS3Name: null,
    assetS3Endpoint: null,
    assetS3Region: null,
    assetS3Bucket: null,
    assetS3AccessKeyId: null,
    assetS3SecretAccessKey: null,
    assetS3SecretAccessKeyCiphertext: null,
    assetS3PublicBaseUrl: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

/** Fake Prisma client that records the last write and applies it to the row. */
function createPrisma(initial: AppSettingsColumns = createColumns()) {
  let row = initial;
  const writes: Array<Record<string, unknown>> = [];

  return {
    get row() {
      return row;
    },
    get lastWrite() {
      return writes.at(-1) ?? {};
    },
    appSettings: {
      async upsert(args: {
        where: { id: number };
        create: Record<string, unknown> & { id: number };
        update: Record<string, unknown>;
      }) {
        writes.push(args.update);
        row = { ...row, ...args.update } as AppSettingsColumns;
        return row;
      },
    },
  };
}

test("update seals secrets and clears the legacy plaintext column", async () => {
  const prisma = createPrisma();
  const store = createAppSettingsStore(prisma);

  const returned = await store.update({
    rsshubAuthType: "basic",
    rsshubUsername: "alice",
    rsshubPassword: "hunter2",
  });

  // The plaintext never reaches the row…
  assert.equal(prisma.row.rsshubPassword, null);
  assert.notEqual(prisma.row.rsshubPasswordCiphertext, null);
  assert.ok(!JSON.stringify(prisma.row).includes("hunter2"));

  // …but callers above the store still see it.
  assert.equal(returned.rsshubPassword, "hunter2");
  assert.equal(returned.rsshubUsername, "alice");
});

test("get opens the sealed column", async () => {
  const prisma = createPrisma(
    createColumns({
      assetS3SecretAccessKeyCiphertext: sealAppSettingsSecret(
        "assetS3SecretAccessKey",
        "s3-secret",
      ),
    }),
  );

  const row = await createAppSettingsStore(prisma).get();

  assert.equal(row.assetS3SecretAccessKey, "s3-secret");
});

test("get falls back to the legacy plaintext column before migration", async () => {
  const prisma = createPrisma(createColumns({ rsshubBearerToken: "legacy-token" }));

  const row = await createAppSettingsStore(prisma).get();

  assert.equal(row.rsshubBearerToken, "legacy-token");
});

test("setting a secret to null clears both columns", async () => {
  const prisma = createPrisma(
    createColumns({
      rsshubPassword: "legacy",
      rsshubPasswordCiphertext: sealAppSettingsSecret("rsshubPassword", "sealed"),
    }),
  );
  const store = createAppSettingsStore(prisma);

  const row = await store.update({ rsshubPassword: null });

  assert.equal(prisma.row.rsshubPassword, null);
  assert.equal(prisma.row.rsshubPasswordCiphertext, null);
  assert.equal(row.rsshubPassword, null);
});

test("untouched secrets are not written", async () => {
  const sealed = sealAppSettingsSecret("rsshubPassword", "keep-me");
  const prisma = createPrisma(createColumns({ rsshubPasswordCiphertext: sealed }));
  const store = createAppSettingsStore(prisma);

  const row = await store.update({ normalRate: 0.5 });

  assert.ok(!("rsshubPassword" in prisma.lastWrite));
  assert.ok(!("rsshubPasswordCiphertext" in prisma.lastWrite));
  assert.equal(prisma.row.rsshubPasswordCiphertext, sealed);
  assert.equal(row.rsshubPassword, "keep-me");
});

test("a ciphertext moved to another field's column does not open", async () => {
  // Per-field scope: AppSettings is a singleton row, so without it all three
  // secrets would share one derived key and be interchangeable.
  const prisma = createPrisma(
    createColumns({
      [appSettingsCiphertextColumn("rsshubBearerToken")]: sealAppSettingsSecret(
        "rsshubPassword",
        "wrong-column",
      ),
    }),
  );

  const row = await createAppSettingsStore(prisma).get();

  assert.equal(row.rsshubBearerToken, null);
});
