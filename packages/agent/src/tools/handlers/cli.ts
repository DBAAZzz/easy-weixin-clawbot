import { execFile } from "node:child_process";
import type { NativeHandler } from "../types.js";

const BINARY_ALLOWLIST = new Set(["opencli", "gh", "docker", "curl"]);
const FORBIDDEN_SHELL_PATTERN = /(\|\||&&|[|;`]|[$][(]|\r|\n)/;
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 4_000;

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    return [];
  }
  return value;
}

function splitCommand(command: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === "\"" && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current) {
    args.push(current);
  }

  return args;
}

function runCommand(
  binary: string,
  args: string[],
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { maxBuffer: 1024 * 1024, timeout: timeoutMs, signal },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          reject(new Error(stderr || error.message));
          return;
        }

        resolve({ stdout, stderr });
      },
    );
  });
}

export const cliHandler: NativeHandler = {
  async execute(args, config, ctx) {
    const binary = typeof config.binary === "string" ? config.binary : "";
    if (!binary || !BINARY_ALLOWLIST.has(binary)) {
      throw new Error(`Binary is not allowed: ${binary || "(missing)"}`);
    }

    const command = typeof args.command === "string" ? args.command.trim() : "";
    if (!command) {
      throw new Error("cli tool requires a non-empty command");
    }

    if (FORBIDDEN_SHELL_PATTERN.test(command)) {
      throw new Error("Command contains forbidden shell metacharacters");
    }

    const defaultArgs = asStringArray(config.defaultArgs);
    const timeoutMs = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(
        1_000,
        typeof config.timeout === "number" && Number.isFinite(config.timeout)
          ? Math.trunc(config.timeout)
          : DEFAULT_TIMEOUT_MS,
      ),
    );
    const maxOutputChars =
      typeof config.maxOutputChars === "number" && Number.isFinite(config.maxOutputChars)
        ? Math.max(200, Math.trunc(config.maxOutputChars))
        : DEFAULT_MAX_OUTPUT_CHARS;

    const fullArgs = [...splitCommand(command), ...defaultArgs];
    const { stdout, stderr } = await runCommand(binary, fullArgs, timeoutMs, ctx.signal);

    let output = stdout.trim() || stderr.trim() || "(no output)";
    if (output.length > maxOutputChars) {
      const totalLength = output.length;
      output = `${output.slice(0, maxOutputChars)}\n... (truncated, ${totalLength} total chars)`;
    }

    return [{ type: "text", text: output }];
  },
};
