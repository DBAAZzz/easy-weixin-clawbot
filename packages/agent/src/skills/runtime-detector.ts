import { readFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { analyzeScript } from "./script-analyzer.js";
import type {
  CompiledSkill,
  DetectedSkillKind,
  DetectedSkillRuntime,
  ScriptDescriptor,
  SkillDependency,
  SkillDependencySource,
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

function selectCompatEntrypoint(
  descriptors: ScriptDescriptor[],
): { descriptor: ScriptDescriptor; source: "naming-convention" } | null {
  if (descriptors.length === 0) return null;

  if (descriptors.length === 1) {
    return { descriptor: descriptors[0], source: "naming-convention" };
  }

  const openclawEntry = descriptors.find((d) => basename(d.path).toLowerCase() === "openclaw_entry.py");
  if (openclawEntry) return { descriptor: openclawEntry, source: "naming-convention" };

  const entryCandidate = descriptors.find((d) => basename(d.path).toLowerCase().includes("_entry."));
  if (entryCandidate) return { descriptor: entryCandidate, source: "naming-convention" };

  const cliCandidate = descriptors.find((d) => basename(d.path).toLowerCase().includes("_cli."));
  if (cliCandidate) return { descriptor: cliCandidate, source: "naming-convention" };

  const runtime = descriptors[0].runtime;
  const namingPriority =
    runtime === "python"
      ? ["main.py", "cli.py", "run.py"]
      : ["main.js", "cli.js", "run.js", "main.mjs", "cli.mjs", "run.mjs"];

  const namedCandidate = descriptors.find((d) => isNamedScript(d.path, namingPriority));
  if (namedCandidate) return { descriptor: namedCandidate, source: "naming-convention" };

  return null;
}

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

function mergeDependencies(
  installCommands: ParsedInstallCommand[],
  runtime: SkillRuntime,
  scriptImports: string[],
  requirementsDeps: Array<{ name: string; installSpec: string }>,
  frontmatterDeps: string[],
): { dependencies: SkillDependency[]; evidence: string[]; preferredInstaller: SkillProvisionInstaller } {
  const byName = new Map<string, { sources: Set<SkillDependencySource>; installSpec?: string }>();
  const evidence: string[] = [];
  let preferredInstaller: SkillProvisionInstaller = "manual";

  function touch(name: string, source: SkillDependencySource, installSpec?: string) {
    const entry = byName.get(name) ?? { sources: new Set() };
    entry.sources.add(source);
    if (installSpec && !entry.installSpec) {
      entry.installSpec = installSpec;
    }
    byName.set(name, entry);
  }

  for (const command of installCommands) {
    if (command.runtime !== runtime) continue;
    if (preferredInstaller === "manual") {
      preferredInstaller = command.installer;
    }
    evidence.push(`SKILL.md:${command.evidence}`);
    for (const packageInfo of command.packages) {
      touch(packageInfo.name, "markdown-install", packageInfo.installSpec);
    }
  }

  for (const importName of scriptImports) {
    touch(importName, "import-scan");
  }

  for (const req of requirementsDeps) {
    touch(req.name, "requirements-txt", req.installSpec);
    if (preferredInstaller === "manual" && runtime === "python") {
      preferredInstaller = "pip";
    }
  }

  for (const depSpec of frontmatterDeps) {
    const parsed = normalizePackageSpec(depSpec);
    touch(parsed.name, "frontmatter", parsed.installSpec);
  }

  if (requirementsDeps.length > 0) {
    evidence.push("requirements.txt");
  }
  if (frontmatterDeps.length > 0) {
    evidence.push("frontmatter:dependency");
  }

  const dependencies: SkillDependency[] = [...byName.entries()]
    .map(([name, flags]) => {
      const sourceCount = flags.sources.size;
      const confidence = sourceCount >= 2 ? "high" : "medium";
      const source: SkillDependencySource = flags.sources.has("markdown-install")
        ? "markdown-install"
        : flags.sources.has("requirements-txt")
          ? "requirements-txt"
          : flags.sources.has("frontmatter")
            ? "frontmatter"
            : "import-scan";

      return {
        name,
        installSpec: flags.installSpec,
        source,
        confidence: confidence as "high" | "medium" | "low",
      };
    })
    .sort((left, right) => left.name.localeCompare(right.name));

  return { dependencies, evidence, preferredInstaller };
}

function parseRequirementsTxt(content: string): Array<{ name: string; installSpec: string }> {
  const result: Array<{ name: string; installSpec: string }> = [];
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
    const parsed = normalizePackageSpec(trimmed);
    if (parsed.name) {
      result.push(parsed);
    }
  }
  return result;
}

function extractFrontmatterDeps(
  frontmatterDependency: Record<string, string[]> | undefined,
  runtime: SkillRuntime,
): string[] {
  if (!frontmatterDependency) return [];
  return frontmatterDependency[runtime] ?? [];
}

function emptyDetectedRuntime(): DetectedSkillRuntime {
  return {
    kind: "knowledge-only",
    preferredInstaller: "manual",
    dependencies: [],
    issues: [],
    evidence: [],
  };
}

function collectAllImports(descriptors: ScriptDescriptor[]): string[] {
  const imports = new Set<string>();
  for (const d of descriptors) {
    for (const imp of d.imports) {
      imports.add(imp);
    }
  }
  return [...imports].sort();
}

function collectLocalPythonModuleNames(packageIndex: SkillPackageIndex): Set<string> {
  const names = new Set<string>();
  const files = [...packageIndex.scriptFiles, ...packageIndex.rootScriptFiles];

  for (const relativePath of files) {
    if (extname(relativePath).toLowerCase() !== ".py") {
      continue;
    }

    const fileName = basename(relativePath, ".py");
    if (fileName !== "__init__") {
      names.add(fileName);
      continue;
    }

    const parentDir = basename(dirname(relativePath));
    if (parentDir && parentDir !== "." && parentDir !== ".." && parentDir !== "scripts") {
      names.add(parentDir);
    }
  }

  return names;
}

export async function detectSkillRuntime(
  skill: Pick<CompiledSkill, "source">,
  packageIndex: SkillPackageIndex,
): Promise<DetectedSkillRuntime> {
  const hasScriptsDir = packageIndex.scriptFiles.length > 0;
  const hasRootScripts = packageIndex.rootScriptFiles.length > 0;

  if (!hasScriptsDir && !hasRootScripts) {
    return emptyDetectedRuntime();
  }

  const scriptDirDescriptors = hasScriptsDir
    ? (
        await Promise.all(packageIndex.scriptFiles.map((f) => analyzeScript(packageIndex.rootDir, f)))
      ).filter((d): d is ScriptDescriptor => d !== null)
    : [];

  const rootDescriptors = hasRootScripts
    ? (
        await Promise.all(packageIndex.rootScriptFiles.map((f) => analyzeScript(packageIndex.rootDir, f)))
      ).filter((d): d is ScriptDescriptor => d !== null)
    : [];

  const allDescriptors = [...scriptDirDescriptors, ...rootDescriptors];

  if (allDescriptors.length === 0) {
    return {
      kind: "manual-needed",
      preferredInstaller: "manual",
      dependencies: [],
      issues: ["Detected script files but none match the supported runtime conventions."],
      evidence: [...packageIndex.scriptFiles, ...packageIndex.rootScriptFiles],
    };
  }

  const runtimes = new Set(allDescriptors.map((d) => d.runtime));
  if (runtimes.size > 1) {
    return {
      kind: "manual-needed",
      preferredInstaller: "manual",
      dependencies: [],
      issues: ["Detected multiple script runtimes in one skill package."],
      evidence: allDescriptors.map((d) => d.path),
    };
  }

  const runtime = allDescriptors[0].runtime;

  let entrypoint = scriptDirDescriptors.length > 0 ? selectEntrypoint(scriptDirDescriptors) : null;
  if (!entrypoint && rootDescriptors.length > 0) {
    entrypoint = selectCompatEntrypoint(rootDescriptors);
  }

  const markdownCommands = parseMarkdownInstallCommands(skill.source.body);
  const localPythonModuleNames = runtime === "python" ? collectLocalPythonModuleNames(packageIndex) : new Set<string>();
  const allImports = collectAllImports(allDescriptors).filter((importName) => !localPythonModuleNames.has(importName));

  let requirementsDeps: Array<{ name: string; installSpec: string }> = [];
  if (packageIndex.requirementsTxtPath) {
    try {
      const content = await readFile(packageIndex.requirementsTxtPath, "utf8");
      requirementsDeps = parseRequirementsTxt(content);
    } catch {
      // Ignore read errors
    }
  }

  const frontmatterDeps = extractFrontmatterDeps(skill.source.frontmatterDependency, runtime);

  const { dependencies, evidence, preferredInstaller } = mergeDependencies(
    markdownCommands,
    runtime,
    allImports,
    requirementsDeps,
    frontmatterDeps,
  );

  const issues: string[] = [];
  if (dependencies.length === 0 && runtime === "python") {
    issues.push("No Python dependencies were detected from installation blocks, script imports, requirements.txt, or frontmatter.");
  }

  const resolvedInstaller: SkillProvisionInstaller =
    preferredInstaller === "manual"
      ? runtime === "python"
        ? "pip"
        : runtime === "node"
          ? "npm"
          : "manual"
      : preferredInstaller;

  if (entrypoint) {
    const detectedKind: DetectedSkillKind =
      runtime === "python" ? "python-script" : runtime === "node" ? "node-script" : "manual-needed";

    return {
      kind: detectedKind,
      preferredInstaller: resolvedInstaller,
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

  const scriptSetKind: DetectedSkillKind =
    runtime === "python" ? "python-script-set" : runtime === "node" ? "node-script-set" : "manual-needed";

  return {
    kind: scriptSetKind,
    preferredInstaller: resolvedInstaller,
    scriptSet: allDescriptors.map((d) => d.path).sort(),
    dependencies,
    issues,
    evidence: [...allDescriptors.map((d) => d.path), ...evidence],
  };
}
