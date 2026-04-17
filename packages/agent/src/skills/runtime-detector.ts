import { basename } from "node:path";
import { analyzeScript } from "./script-analyzer.js";
import type {
  CompiledSkill,
  DetectedSkillKind,
  DetectedSkillRuntime,
  ScriptDescriptor,
  SkillDependency,
  SkillPackageIndex,
  SkillProvisionInstaller,
  SkillRuntime,
} from "./types.js";

interface ParsedInstallCommand {
  runtime: SkillRuntime;
  installer: SkillProvisionInstaller;
  packages: Array<{ name: string; installSpec: string }>;
  evidence: string;
}

// 把安装语句里的依赖声明拆成：
// - name: 依赖名，用于去重和展示
// - installSpec: 原始安装规格，用于真正执行安装
function normalizePackageSpec(spec: string): { name: string; installSpec: string } {
  const trimmed = spec.trim();
  const separator = trimmed.match(/(?:==|>=|<=|~=|!=|>|<)/);
  const name = separator ? trimmed.slice(0, separator.index).trim() : trimmed;
  return {
    name,
    installSpec: trimmed,
  };
}

function isNamedScript(path: string, names: string[]): boolean {
  const fileName = basename(path).toLowerCase();
  return names.includes(fileName);
}

// 入口脚本选择策略：
// 1. 只有一个脚本时，直接把它当入口
// 2. 多脚本时，优先选 *_cli，再选 main/cli/run 这类约定名
function selectEntrypoint(
  descriptors: ScriptDescriptor[],
): { descriptor: ScriptDescriptor; source: "single-script" | "naming-convention" } | null {
  if (descriptors.length === 1) {
    return { descriptor: descriptors[0], source: "single-script" };
  }

  const namingPriority =
    descriptors[0]?.runtime === "python"
      ? ["main.py", "cli.py", "run.py"]
      : ["main.js", "cli.js", "run.js", "main.mjs", "cli.mjs", "run.mjs", "main.cjs", "cli.cjs", "run.cjs"];

  const cliCandidate = descriptors.find((descriptor) => basename(descriptor.path).toLowerCase().includes("_cli."));
  if (cliCandidate) {
    return { descriptor: cliCandidate, source: "naming-convention" };
  }

  const namedCandidate = descriptors.find((descriptor) => isNamedScript(descriptor.path, namingPriority));
  if (namedCandidate) {
    return { descriptor: namedCandidate, source: "naming-convention" };
  }

  return null;
}

// 从 SKILL.md 的代码块里解析安装命令。
// 这里只做“确定性规则解析”，不依赖 AI 推断。
function parseInstallCommandLine(rawLine: string): ParsedInstallCommand | null {
  const line = rawLine.trim();
  if (!line) return null;

  const candidates: Array<{ prefix: string; installer: SkillProvisionInstaller }> = [
    { prefix: "uv pip install ", installer: "uv-pip" },
    { prefix: "pip install ", installer: "pip" },
    { prefix: "python -m pip install ", installer: "pip" },
    { prefix: "python3 -m pip install ", installer: "pip" },
    { prefix: "npm install ", installer: "npm" },
    { prefix: "pnpm add ", installer: "pnpm" },
    { prefix: "yarn add ", installer: "yarn" },
  ];

  for (const candidate of candidates) {
    if (!line.startsWith(candidate.prefix)) continue;

    const args = line.slice(candidate.prefix.length).trim().split(/\s+/).filter(Boolean);
    const packages = args.filter((arg) => !arg.startsWith("-")).map(normalizePackageSpec);
    if (packages.length === 0) {
      return null;
    }

    return {
      runtime:
        candidate.installer === "uv-pip" || candidate.installer === "pip"
          ? "python"
          : "node",
      installer: candidate.installer,
      packages,
      evidence: line,
    };
  }

  return null;
}

// 遍历 markdown fenced code block，抽取其中可识别的安装命令。
function parseMarkdownInstallCommands(markdown: string): ParsedInstallCommand[] {
  const commands: ParsedInstallCommand[] = [];
  const fencePattern = /```(?:bash|sh|shell)?\n([\s\S]*?)```/g;

  for (const match of markdown.matchAll(fencePattern)) {
    const block = match[1] ?? "";
    for (const line of block.split(/\r?\n/)) {
      const parsed = parseInstallCommandLine(line);
      if (parsed) {
        commands.push(parsed);
      }
    }
  }

  return commands;
}

// 合并两类依赖来源：
// 1. markdown 安装命令
// 2. 入口脚本 import
//
// 同名依赖会做聚合，并根据“命中来源多少”来提升 confidence。
function mergeDependencies(
  installCommands: ParsedInstallCommand[],
  runtime: SkillRuntime,
  scriptImports: string[],
): { dependencies: SkillDependency[]; evidence: string[]; preferredInstaller: SkillProvisionInstaller } {
  const byName = new Map<string, { fromMarkdown: boolean; fromImport: boolean; installSpec?: string }>();
  const evidence: string[] = [];
  let preferredInstaller: SkillProvisionInstaller = "manual";

  for (const command of installCommands) {
    if (command.runtime !== runtime) {
      continue;
    }
    if (preferredInstaller === "manual") {
      preferredInstaller = command.installer;
    }
    evidence.push(`SKILL.md:${command.evidence}`);
    for (const packageInfo of command.packages) {
      const entry = byName.get(packageInfo.name) ?? { fromMarkdown: false, fromImport: false };
      entry.fromMarkdown = true;
      entry.installSpec = packageInfo.installSpec;
      byName.set(packageInfo.name, entry);
    }
  }

  for (const importName of scriptImports) {
    const entry = byName.get(importName) ?? { fromMarkdown: false, fromImport: false };
    entry.fromImport = true;
    byName.set(importName, entry);
  }

  const dependencies: SkillDependency[] = [...byName.entries()]
    .map(([name, flags]) => {
      if (flags.fromMarkdown && flags.fromImport) {
        return {
          name,
          installSpec: flags.installSpec,
          source: "markdown-install" as const,
          confidence: "high" as const,
        };
      }
      if (flags.fromMarkdown) {
        return {
          name,
          installSpec: flags.installSpec,
          source: "markdown-install" as const,
          confidence: "medium" as const,
        };
      }
      return {
        name,
        source: "import-scan" as const,
        confidence: "medium" as const,
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return { dependencies, evidence, preferredInstaller };
}

// 没有任何可执行脚本时，默认视为纯知识型 skill。
function emptyDetectedRuntime(): DetectedSkillRuntime {
  return {
    kind: "knowledge-only",
    preferredInstaller: "manual",
    dependencies: [],
    issues: [],
    evidence: [],
  };
}

export async function detectSkillRuntime(
  skill: Pick<CompiledSkill, "source">,
  packageIndex: SkillPackageIndex,
): Promise<DetectedSkillRuntime> {
  // 没有 scripts/ 时，直接判定为 knowledge-only。
  if (packageIndex.scriptFiles.length === 0) {
    return emptyDetectedRuntime();
  }

  // 先把 scripts/ 里的候选脚本都做静态分析，拿到 runtime/imports 等信息。
  const descriptors = (
    await Promise.all(packageIndex.scriptFiles.map((filePath) => analyzeScript(packageIndex.rootDir, filePath)))
  ).filter((descriptor): descriptor is ScriptDescriptor => descriptor !== null);

  // 有脚本文件，但没有任何一个能识别成当前支持的运行时。
  if (descriptors.length === 0) {
    return {
      kind: "manual-needed",
      preferredInstaller: "manual",
      dependencies: [],
      issues: ["Detected script files but none match the supported runtime conventions."],
      evidence: [...packageIndex.scriptFiles],
    };
  }

  // 一个 skill 包里同时混用多种脚本运行时，第一版不自动推断，交给人工处理。
  const runtimes = new Set(descriptors.map((descriptor) => descriptor.runtime));
  if (runtimes.size > 1) {
    return {
      kind: "manual-needed",
      preferredInstaller: "manual",
      dependencies: [],
      issues: ["Detected multiple script runtimes in one skill package."],
      evidence: descriptors.map((descriptor) => descriptor.path),
    };
  }

  const runtime = descriptors[0].runtime;

  // 运行时确定后，再选唯一入口脚本。
  const entrypoint = selectEntrypoint(descriptors);
  if (!entrypoint) {
    return {
      kind: "manual-needed",
      preferredInstaller: "manual",
      dependencies: [],
      issues: ["Could not determine a unique entrypoint from the scripts directory."],
      evidence: descriptors.map((descriptor) => descriptor.path),
    };
  }

  // 依赖信息来自两部分：
  // - SKILL.md 中显式写出的安装命令
  // - 入口脚本真实 import 的包
  const markdownCommands = parseMarkdownInstallCommands(skill.source.body);
  const { dependencies, evidence, preferredInstaller } = mergeDependencies(
    markdownCommands,
    runtime,
    entrypoint.descriptor.imports,
  );

  const detectedKind: DetectedSkillKind =
    runtime === "python"
      ? "python-script"
      : runtime === "node"
        ? "node-script"
        : "manual-needed";

  // Python skill 如果完全探测不到依赖，先保留一个 issue，便于 UI 和运维排查。
  const issues: string[] = [];
  if (dependencies.length === 0 && runtime === "python") {
    issues.push("No Python dependencies were detected from installation blocks or script imports.");
  }

  return {
    kind: detectedKind,
    // 没写安装命令时，给一个按 runtime 推导的默认安装器，
    // 这样 provision 层仍然可以继续工作。
    preferredInstaller:
      preferredInstaller === "manual"
        ? runtime === "python"
          ? "pip"
          : runtime === "node"
            ? "npm"
            : "manual"
        : preferredInstaller,
    entrypoint: {
      path: entrypoint.descriptor.path,
      runtime: runtime as SkillRuntime,
      source: entrypoint.source,
    },
    dependencies,
    issues,
    evidence: [entrypoint.descriptor.path, ...evidence],
  };
}
