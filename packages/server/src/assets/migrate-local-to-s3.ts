import "../config/load-env.js";
import { resolve } from "node:path";
import type { AssetStorageRef } from "@clawbot/asset";
import { getPrisma, disconnectPrisma } from "../db/prisma.js";
import { ASSETS_DIR } from "../paths.js";
import { S3CompatibleAssetBlobStore, type S3CompatibleAssetBlobStoreConfig } from "./s3-compatible-blob-store.js";

interface MigrationOptions {
  dryRun: boolean;
  limit?: number;
}

function parseOptions(argv: string[]): MigrationOptions {
  const dryRun = argv.includes("--dry-run");
  const limitArg = argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number.parseInt(limitArg.slice("--limit=".length), 10) : undefined;
  return {
    dryRun,
    limit: Number.isFinite(limit) ? limit : undefined,
  };
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function resolveLocalPath(baseDir: string, key: string): string {
  const root = resolve(baseDir);
  const localPath = resolve(root, key);
  if (localPath !== root && !localPath.startsWith(`${root}/`)) {
    throw new Error(`Local asset path escapes base directory: ${key}`);
  }
  return localPath;
}

function getS3Config(): S3CompatibleAssetBlobStoreConfig {
  return {
    endpoint: requiredEnv("ASSET_S3_ENDPOINT"),
    region: process.env.ASSET_S3_REGION ?? "auto",
    bucket: requiredEnv("ASSET_S3_BUCKET"),
    accessKeyId: requiredEnv("ASSET_S3_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("ASSET_S3_SECRET_ACCESS_KEY"),
    publicBaseUrl: process.env.ASSET_S3_PUBLIC_BASE_URL,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const baseDir = process.env.ASSET_LOCAL_BASE_DIR ?? ASSETS_DIR;
  const s3Config = getS3Config();
  const s3 = new S3CompatibleAssetBlobStore(s3Config);
  const prisma = getPrisma();
  const rows = await prisma.asset.findMany({
    where: { provider: "local" },
    orderBy: { createdAt: "asc" },
    ...(options.limit ? { take: options.limit } : {}),
  });

  console.log(`Found ${rows.length} local asset(s) to migrate.`);
  for (const row of rows) {
    if (!row.localPath) {
      console.warn(`Skip ${row.id}: missing localPath`);
      continue;
    }
    const objectKey = row.localPath;
    const sourcePath = resolveLocalPath(baseDir, row.localPath);
    console.log(`${options.dryRun ? "Would migrate" : "Migrating"} ${row.id} -> ${objectKey}`);
    if (options.dryRun) continue;

    const storage = await s3.put({
      sourcePath,
      key: objectKey,
      mimeType: row.mimeType,
      metadata: {
        accountId: row.accountId,
        assetId: row.id,
        kind: row.kind,
        ...(row.sha256 ? { sha256: row.sha256 } : {}),
      },
    }) as Extract<AssetStorageRef, { provider: "s3-compatible" }>;

    await prisma.asset.update({
      where: { id: row.id },
      data: {
        provider: storage.provider,
        bucket: storage.bucket,
        objectKey: storage.key,
        localPath: null,
        storageRef: storage,
      },
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void disconnectPrisma();
  });
