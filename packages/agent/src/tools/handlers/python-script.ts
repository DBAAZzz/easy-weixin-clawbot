import { execFile } from "node:child_process";
import { join, resolve } from "node:path";
import type { NativeHandler, ToolContent } from "../types.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 8_000;

const SENSITIVE_PREFIXES = [
  "DATABASE_",
  "DB_",
  "OPENAI_",
  "ANTHROPIC_",
  "AWS_",
  "AZURE_",
  "JWT_",
  "SECRET_",
  "API_KEY",
  "GOOGLE_",
  "DEEPSEEK_",
];

function sanitizeEnv(): Record<string, string> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    const upper = key.toUpperCase();
    if (SENSITIVE_PREFIXES.some((p) => upper.startsWith(p))) {
      delete env[key];
    }
  }
  return env as Record<string, string>;
}

function splitArgs(raw: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
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
  if (current) args.push(current);
  return args;
}

export const pythonScriptHandler: NativeHandler = {
  async execute(args, config, ctx) {
    const entrypoint = config.entrypoint as string | undefined;
    const skillDir = config.__skillDir as string | undefined;

    if (!entrypoint) {
      throw new Error("python-script handler requires handlerConfig.entrypoint");
    }
    if (!skillDir) {
      throw new Error("python-script handler requires __skillDir (injected by skill compiler)");
    }

    const timeout = Math.min(
      MAX_TIMEOUT_MS,
      Math.max(1_000, typeof config.timeout === "number" ? Math.trunc(config.timeout) : DEFAULT_TIMEOUT_MS),
    );
    const maxOutputChars =
      typeof config.maxOutputChars === "number" && Number.isFinite(config.maxOutputChars)
        ? Math.max(200, Math.trunc(config.maxOutputChars))
        : DEFAULT_MAX_OUTPUT_CHARS;

    const pythonBin = join(skillDir, ".venv", "bin", "python");
    const scriptPath = resolve(skillDir, entrypoint);

    const cmdArgs = [scriptPath];
    if (typeof args.subcommand === "string" && args.subcommand.trim()) {
      cmdArgs.push(args.subcommand.trim());
    }
    if (typeof args.args === "string" && args.args.trim()) {
      cmdArgs.push(...splitArgs(args.args.trim()));
    }

    return new Promise<ToolContent[]>((resolvePromise, reject) => {
      const child = execFile(
        pythonBin,
        cmdArgs,
        {
          cwd: skillDir,
          timeout,
          maxBuffer: 1024 * 1024,
          env: sanitizeEnv(),
        },
        (error, stdout, stderr) => {
          if (ctx.signal.aborted) {
            return reject(new DOMException("Aborted", "AbortError"));
          }
          let output = (stdout || stderr || error?.message || "(no output)").trim();
          if (output.length > maxOutputChars) {
            const totalLength = output.length;
            output = `${output.slice(0, maxOutputChars)}\n... (truncated, ${totalLength} total chars)`;
          }
          resolvePromise([{ type: "text", text: output }]);
        },
      );
      ctx.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
    });
  },
};
