import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { execPromise, pathExists } from "./fs-utils.js";
import type { SkillDependency, SkillDependencyCheck } from "./types.js";
import { parseVersionConstraints, satisfiesVersion } from "./version-spec.js";

/**
 * 当前环境里已安装包的快照。
 *
 * `probed: false` 表示探测手段本身失败（解释器/元数据不可读），此时不能断言依赖缺失，
 * 只能标记 unknown。`probed: true` 且 `versions` 为空是合法状态——环境干净、什么都没装。
 */
export interface InstalledPackageIndex {
  probed: boolean;
  versions: ReadonlyMap<string, string>;
}

/** 探测未进行/已失败，所有依赖只能记为 unknown。 */
export const UNPROBED_INDEX: InstalledPackageIndex = { probed: false, versions: new Map() };
const EMPTY_PROBE: InstalledPackageIndex = { probed: true, versions: new Map() };

/**
 * 一次性导出 venv 内的全部发行版版本，外加「顶层模块名 → 发行版」映射。
 *
 * 用元数据查询而非逐个 `import`：既不必为每个依赖起一次解释器，也能拿到版本号。
 * 模块映射用于修正 import 扫描得到的名字与发行版名不一致的情况（yaml → PyYAML）。
 */
const PYTHON_PROBE_SCRIPT = `
import json
import importlib.metadata as md

versions = {}
for dist in md.distributions():
    name = dist.metadata["Name"]
    if name:
        versions[name] = dist.version

try:
    modules = md.packages_distributions()
except Exception:
    modules = {}

print(json.dumps({"versions": versions, "modules": modules}))
`;

interface PythonProbePayload {
  versions: Record<string, string>;
  modules: Record<string, string[]>;
}

/** PEP 503 名称规范化：大小写与 -_. 分隔符不敏感。 */
export function normalizePythonName(name: string): string {
  return name.trim().toLowerCase().replace(/[-_.]+/g, "-");
}

/**
 * 剥离 npm 包名尾部的版本区间。
 *
 * 上游 detector 的包名解析只切分 PEP 440 操作符，`npm install lodash@^4.17.0`
 * 会把整串当成包名，这里补齐以免拼出错误的 node_modules 路径。作用域包 `@scope/pkg`
 * 的首字符 @ 必须保留。
 */
export function stripNodeVersionRange(rawName: string): string {
  const name = rawName.trim();
  const separator = name.lastIndexOf("@");
  return separator > 0 ? name.slice(0, separator) : name;
}

export async function probePythonPackages(skillDir: string): Promise<InstalledPackageIndex> {
  const venvPython = join(skillDir, ".venv", "bin", "python");
  if (!(await pathExists(venvPython))) {
    // 虚拟环境尚未创建，等价于「一个包都没装」，不是探测失败
    return EMPTY_PROBE;
  }

  let stdout: string;
  try {
    const result = await execPromise(venvPython, ["-c", PYTHON_PROBE_SCRIPT], {
      cwd: skillDir,
      timeout: 30_000,
    });
    stdout = result.stdout;
  } catch (error) {
    console.warn(
      `[skills] python dependency probe failed in ${skillDir}:`,
      error instanceof Error ? error.message : error,
    );
    return UNPROBED_INDEX;
  }

  let payload: PythonProbePayload;
  try {
    payload = JSON.parse(stdout) as PythonProbePayload;
  } catch (error) {
    console.warn(
      `[skills] python dependency probe returned unparsable output in ${skillDir}:`,
      error instanceof Error ? error.message : error,
    );
    return UNPROBED_INDEX;
  }

  const versions = new Map<string, string>();
  for (const [name, version] of Object.entries(payload.versions ?? {})) {
    versions.set(normalizePythonName(name), version);
  }
  // 模块别名只做补位，不覆盖同名发行版
  for (const [moduleName, distributions] of Object.entries(payload.modules ?? {})) {
    const key = normalizePythonName(moduleName);
    if (versions.has(key)) continue;
    for (const distribution of distributions) {
      const version = versions.get(normalizePythonName(distribution));
      if (version) {
        versions.set(key, version);
        break;
      }
    }
  }

  return { probed: true, versions };
}

export async function probeNodePackages(
  skillDir: string,
  dependencies: SkillDependency[],
): Promise<InstalledPackageIndex> {
  const modulesDir = join(skillDir, "node_modules");
  if (!(await pathExists(modulesDir))) {
    return EMPTY_PROBE;
  }

  const versions = new Map<string, string>();
  await Promise.all(
    dependencies.map(async (dependency) => {
      const packageName = stripNodeVersionRange(dependency.name);
      try {
        const manifest = await readFile(join(modulesDir, packageName, "package.json"), "utf8");
        const version = (JSON.parse(manifest) as { version?: string }).version;
        if (version) {
          versions.set(packageName, version);
        }
      } catch {
        // 读不到即视为未安装：node_modules 已存在，缺包是确定结论而非探测失败
      }
    }),
  );

  return { probed: true, versions };
}

/** 探测解释器可用性，成功时附带 `--version` 输出的版本号。 */
export async function probeInterpreter(
  binary: string,
): Promise<{ available: boolean; version?: string }> {
  try {
    const { stdout, stderr } = await execPromise(binary, ["--version"], { timeout: 10_000 });
    // python3 老版本把版本号写到 stderr
    const raw = `${stdout} ${stderr}`;
    const version = /(\d+\.\d+(?:\.\d+)?)/.exec(raw)?.[1];
    return { available: true, version };
  } catch {
    return { available: false };
  }
}

export function resolveDependencyStatus(
  dependency: SkillDependency,
  index: InstalledPackageIndex,
  normalizeName: (name: string) => string,
): SkillDependencyCheck {
  if (!index.probed) {
    return { ...dependency, status: "unknown" };
  }

  const canonicalName = normalizeName(dependency.name);
  const installedVersion = index.versions.get(canonicalName);
  if (!installedVersion) {
    return { ...dependency, status: "missing" };
  }

  const constraints = parseVersionConstraints(dependency.installSpec, dependency.name, canonicalName);
  const status = satisfiesVersion(installedVersion, constraints) ? "ok" : "outdated";
  return { ...dependency, status, installedVersion };
}
