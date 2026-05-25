import { randomUUID } from "node:crypto";
import type { AssetKind } from "./types.js";
import { extensionForMimeType } from "./mime.js";

export function createAssetId(): string {
  return `asset_${randomUUID().replaceAll("-", "")}`;
}

export function createAssetObjectKey(input: {
  accountId: string;
  assetId: string;
  kind: AssetKind;
  mimeType: string;
  createdAt: Date;
  originalFilename?: string;
}): string {
  const yyyy = String(input.createdAt.getUTCFullYear());
  const mm = String(input.createdAt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(input.createdAt.getUTCDate()).padStart(2, "0");
  const extension = extensionForMimeType(input.mimeType, input.originalFilename);
  const safeAccountId = input.accountId.replaceAll(/[^a-zA-Z0-9_-]/g, "_");
  return `original/${safeAccountId}/${yyyy}/${mm}/${dd}/${input.assetId}${extension}`;
}
