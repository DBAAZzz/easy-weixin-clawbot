import { execFile } from "node:child_process";
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
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    rejectOnError?: "always" | "when-empty-output";
  } = {},
): Promise<{ stdout: string; stderr: string }> {
  const {
    rejectOnError = "always",
    maxBuffer = 4 * 1024 * 1024,
    ...execOptions
  } = options;

  return new Promise((resolve, reject) => {
    execFile(binary, args, { maxBuffer, ...execOptions }, (error, stdout, stderr) => {
      if (error && (rejectOnError === "always" || (!stdout && !stderr))) {
        reject(new Error(`${binary} ${args.join(" ")} failed: ${stderr || error.message}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}
