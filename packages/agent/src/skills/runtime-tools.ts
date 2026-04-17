import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { z } from "zod";
import type { ToolSnapshot } from "../tools/types.js";
import type { SkillInstaller } from "./types.js";
import type { RuntimeProvisioner } from "./runtime-provisioner.js";

const DEFAULT_MAX_FILE_CHARS = 12_000;
const DEFAULT_SCRIPT_TIMEOUT_MS = 30_000;
const MAX_SCRIPT_TIMEOUT_MS = 120_000;
const PYTHON_JSON_SHIM_SOURCE = String.raw`import json as _json
import runpy
import sys
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path

_original_dumps = _json.dumps
_original_dump = _json.dump

def _fallback_default(value):
    if isinstance(value, (datetime, date, time)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, Path):
        return str(value)
    if hasattr(value, "tolist"):
        try:
            return value.tolist()
        except Exception:
            pass
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            pass
    return str(value)

def _compose_default(user_default):
    if user_default is None:
        return _fallback_default

    def _wrapped(value):
        try:
            return user_default(value)
        except TypeError:
            return _fallback_default(value)

    return _wrapped

def dumps(obj, *args, **kwargs):
    kwargs["default"] = _compose_default(kwargs.get("default"))
    return _original_dumps(obj, *args, **kwargs)

def dump(obj, fp, *args, **kwargs):
    kwargs["default"] = _compose_default(kwargs.get("default"))
    return _original_dump(obj, fp, *args, **kwargs)

_json.dumps = dumps
_json.dump = dump

if len(sys.argv) < 2:
    raise SystemExit("python-json-shim requires a script path")

script_path = sys.argv[1]
sys.argv = [script_path, *sys.argv[2:]]
runpy.run_path(script_path, run_name="__main__")
`;

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
    if (SENSITIVE_PREFIXES.some((prefix) => upper.startsWith(prefix))) {
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

  if (current) {
    args.push(current);
  }

  return args;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n... (truncated, ${text.length} total chars)`;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    const info = await stat(filePath);
    return info.isFile();
  } catch {
    return false;
  }
}

async function createPythonJsonShim(): Promise<{ shimDir: string; shimPath: string }> {
  const shimDir = await mkdtemp(join(tmpdir(), "clawbot-skill-shim-"));
  const shimPath = join(shimDir, "python-json-shim.py");
  await writeFile(shimPath, PYTHON_JSON_SHIM_SOURCE, "utf8");
  return { shimDir, shimPath };
}

function resolveSkillRoot(skillName: string, installer: SkillInstaller) {
  const installed = installer.getInstalled(skillName);
  if (!installed) {
    throw new Error(`Skill not found: ${skillName}`);
  }
  return {
    installed,
    rootDir: dirname(installed.skill.source.filePath),
  };
}

function resolveRelativeSkillPath(rootDir: string, inputPath: string): string {
  const normalizedInput = normalize(inputPath).replace(/\\/g, "/");
  const resolved = resolve(rootDir, normalizedInput);
  const rel = relative(rootDir, resolved).replace(/\\/g, "/");
  if (rel.startsWith("../") || rel === "..") {
    throw new Error("Path escapes the skill directory");
  }
  return rel || "SKILL.md";
}

function isReadableSkillFile(relativePath: string): boolean {
  return (
    relativePath === "SKILL.md" ||
    relativePath === "_meta.json" ||
    relativePath.startsWith("references/") ||
    relativePath.startsWith("scripts/")
  );
}

async function ensureReadyRuntime(skillName: string, installer: SkillInstaller, provisioner: RuntimeProvisioner): Promise<string> {
  const { installed } = resolveSkillRoot(skillName, installer);
  const kind = installed.skill.detectedRuntime?.kind;
  if (kind !== "python-script" && kind !== "node-script") {
    throw new Error(`Skill "${skillName}" does not have an auto-provisionable runtime.`);
  }

  if (installed.provisionStatus === "ready" && await provisioner.healthCheck(installed)) {
    return "Runtime already ready.";
  }

  await installer.setProvisionStatus(skillName, "provisioning");
  try {
    const logs = await provisioner.provision(installed);
    await installer.setProvisionStatus(skillName, "ready");
    return logs.map((log) => `[${log.level}] ${log.message}`).join("\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await installer.setProvisionStatus(skillName, "failed", message);
    throw error;
  }
}

export function createSkillRuntimeToolSnapshot(
  installer: SkillInstaller,
  provisioner: RuntimeProvisioner,
): ToolSnapshot {
  return {
    tools: [
      {
        name: "read_skill_file",
        description: "Read a file bundled with an installed skill package, such as SKILL.md or references/*.md.",
        parameters: z.object({
          skill_name: z.string().describe("Installed skill name"),
          path: z.string().describe("Relative path within the skill package"),
          max_chars: z.number().int().positive().optional().describe("Optional max characters to return"),
        }),
        async execute(args) {
          const skillName = typeof args.skill_name === "string" ? args.skill_name.trim() : "";
          const requestedPath = typeof args.path === "string" ? args.path.trim() : "";
          const maxChars =
            typeof args.max_chars === "number" && Number.isFinite(args.max_chars)
              ? Math.max(200, Math.trunc(args.max_chars))
              : DEFAULT_MAX_FILE_CHARS;

          if (!skillName || !requestedPath) {
            throw new Error("skill_name and path are required");
          }

          const { rootDir } = resolveSkillRoot(skillName, installer);
          const relativePath = resolveRelativeSkillPath(rootDir, requestedPath);
          if (!isReadableSkillFile(relativePath)) {
            throw new Error(`Path is not readable via read_skill_file: ${relativePath}`);
          }

          const filePath = join(rootDir, relativePath);
          if (!(await fileExists(filePath))) {
            throw new Error(`File not found in skill package: ${relativePath}`);
          }

          const content = await readFile(filePath, "utf8");
          return [{
            type: "text",
            text: truncateText(content, maxChars),
          }];
        },
      },
      {
        name: "prepare_skill_runtime",
        description: "Ensure a skill's local runtime environment is provisioned and ready before running its script.",
        parameters: z.object({
          skill_name: z.string().describe("Installed skill name"),
        }),
        async execute(args) {
          const skillName = typeof args.skill_name === "string" ? args.skill_name.trim() : "";
          if (!skillName) {
            throw new Error("skill_name is required");
          }
          const output = await ensureReadyRuntime(skillName, installer, provisioner);
          return [{ type: "text", text: output || "Runtime prepared." }];
        },
      },
      {
        name: "run_skill_script",
        description: "Run an installed skill package entry script after its runtime has been prepared.",
        parameters: z.object({
          skill_name: z.string().describe("Installed skill name"),
          script_path: z.string().optional().describe("Optional relative script path; defaults to the detected entrypoint"),
          args: z.string().optional().describe("Optional CLI arguments passed to the script"),
          timeout_ms: z.number().int().positive().optional().describe("Optional timeout in milliseconds"),
        }),
        async execute(args, ctx) {
          const skillName = typeof args.skill_name === "string" ? args.skill_name.trim() : "";
          if (!skillName) {
            throw new Error("skill_name is required");
          }

          const { installed, rootDir } = resolveSkillRoot(skillName, installer);
          const detected = installed.skill.detectedRuntime;
          if (!detected || !detected.entrypoint || (detected.kind !== "python-script" && detected.kind !== "node-script")) {
            throw new Error(`Skill "${skillName}" is not a runnable script skill.`);
          }
          if (installed.provisionStatus !== "ready" || !(await provisioner.healthCheck(installed))) {
            throw new Error(`Skill "${skillName}" runtime is not ready. Call prepare_skill_runtime first.`);
          }

          const requestedScript =
            typeof args.script_path === "string" && args.script_path.trim()
              ? resolveRelativeSkillPath(rootDir, args.script_path.trim())
              : detected.entrypoint.path;

          if (!installed.skill.packageIndex?.scriptFiles.includes(requestedScript)) {
            throw new Error(`Script is not part of the installed skill package: ${requestedScript}`);
          }

          const timeoutMs = Math.min(
            MAX_SCRIPT_TIMEOUT_MS,
            Math.max(
              1_000,
              typeof args.timeout_ms === "number" && Number.isFinite(args.timeout_ms)
                ? Math.trunc(args.timeout_ms)
                : DEFAULT_SCRIPT_TIMEOUT_MS,
            ),
          );

          const scriptArgs = typeof args.args === "string" && args.args.trim() ? splitArgs(args.args.trim()) : [];
          const executable = detected.kind === "python-script" ? join(rootDir, ".venv", "bin", "python") : process.execPath;
          if (!(await fileExists(executable)) && detected.kind === "python-script") {
            throw new Error(`Python runtime missing for skill "${skillName}". Call prepare_skill_runtime first.`);
          }
          const targetScriptPath = join(rootDir, requestedScript);
          const shim = detected.kind === "python-script" ? await createPythonJsonShim() : null;
          const commandArgs =
            detected.kind === "python-script" && shim
              ? [shim.shimPath, targetScriptPath, ...scriptArgs]
              : [targetScriptPath, ...scriptArgs];

          try {
            const output = await new Promise<string>((resolvePromise, reject) => {
              const child = execFile(
                executable,
                commandArgs,
                {
                  cwd: rootDir,
                  timeout: timeoutMs,
                  maxBuffer: 1024 * 1024,
                  env: sanitizeEnv(),
                },
                (error, stdout, stderr) => {
                  if (ctx.signal.aborted) {
                    reject(new DOMException("Aborted", "AbortError"));
                    return;
                  }
                  if (error && !stdout && !stderr) {
                    reject(new Error(error.message));
                    return;
                  }
                  resolvePromise((stdout || stderr || error?.message || "(no output)").trim());
                },
              );
              ctx.signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
            });

            return [{
              type: "text",
              text: truncateText(output, DEFAULT_MAX_FILE_CHARS),
            }];
          } finally {
            if (shim) {
              await rm(shim.shimDir, { recursive: true, force: true }).catch(() => {});
            }
          }
        },
      },
    ],
  };
}
