import { copyFile, mkdir, readFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AssetBlobStore, AssetStorageRef } from "@clawbot/asset";

export class LocalAssetBlobStore implements AssetBlobStore {
  constructor(private readonly baseDir: string) {}

  async put(input: {
    sourcePath: string;
    key: string;
    mimeType: string;
    metadata?: Record<string, string>;
  }): Promise<AssetStorageRef> {
    const targetPath = this.resolveKey(input.key);
    await mkdir(dirname(targetPath), { recursive: true });
    await copyFile(input.sourcePath, targetPath);
    return { provider: "local", path: input.key };
  }

  async get(input: {
    ref: AssetStorageRef;
  }): Promise<{
    bytes: Uint8Array;
    mimeType: string;
  }> {
    if (input.ref.provider !== "local") {
      throw new Error(`LocalAssetBlobStore cannot read provider: ${input.ref.provider}`);
    }
    const bytes = await readFile(this.resolveKey(input.ref.path));
    return { bytes, mimeType: "application/octet-stream" };
  }

  async delete(input: { ref: AssetStorageRef }): Promise<void> {
    if (input.ref.provider !== "local") return;
    await rm(this.resolveKey(input.ref.path), { force: true });
  }

  async getAccessUrl(input: {
    ref: AssetStorageRef;
    expiresInSeconds: number;
  }): Promise<string> {
    if (input.ref.provider !== "local") {
      throw new Error(`LocalAssetBlobStore cannot create URL for provider: ${input.ref.provider}`);
    }
    throw new Error("Local asset access URLs require the HTTP API content proxy");
  }

  private resolveKey(key: string): string {
    const resolved = resolve(this.baseDir, key);
    const root = resolve(this.baseDir);
    if (resolved !== root && !resolved.startsWith(`${root}/`)) {
      throw new Error(`Asset key escapes base directory: ${key}`);
    }
    return resolved;
  }
}
