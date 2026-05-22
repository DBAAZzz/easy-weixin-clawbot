import path from "node:path";
import { fileURLToPath } from "node:url";

export type WeixinSdkWorkDirs = {
  root: string;
  mediaInboundDir: string;
  mediaOutboundDir: string;
};

function defaultPackageRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "../..");
}

export function resolveWeixinSdkWorkDirs(workDir?: string): WeixinSdkWorkDirs {
  const root = workDir?.trim()
    ? path.resolve(workDir)
    : path.join(defaultPackageRoot(), ".openclaw");

  return {
    root,
    mediaInboundDir: path.join(root, "media", "inbound"),
    mediaOutboundDir: path.join(root, "media", "outbound"),
  };
}
