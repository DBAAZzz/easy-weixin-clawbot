import { run, INSTALLER_ENV_PASSTHROUGH } from "@clawbot/exec";
import { stat } from "node:fs/promises";

export async function isFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function execPromise(
  binary: string,
  args: string[],
  options: {
    cwd?: string;
    timeout?: number;
    maxBuffer?: number;
    signal?: AbortSignal;
    rejectOnError?: "always" | "when-empty-output";
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  // 面向包管理器的封装：safe 基底 + 安装器配置变量透传，不再接受调用方自定义 env。
  return run({
    binary,
    args,
    cwd: options.cwd,
    timeoutMs: options.timeout ?? 30_000,
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    signal: options.signal,
    rejectOnError: options.rejectOnError ?? "always",
    inherit: "safe",
    passthrough: INSTALLER_ENV_PASSTHROUGH,
  });
}
