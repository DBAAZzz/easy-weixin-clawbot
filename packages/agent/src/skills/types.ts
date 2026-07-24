export type SkillActivation = "always" | "on-demand";

export type ProvisionStatus = "pending" | "provisioning" | "ready" | "failed";

export type SkillRuntime = "python" | "node";

export type DetectedSkillKind =
  | "knowledge-only"
  | "python-script"
  | "node-script"
  | "python-script-set"
  | "node-script-set"
  | "manual-needed";

export type SkillDependencySource = "markdown-install" | "import-scan" | "requirements-txt" | "frontmatter";

export type SkillProvisionInstaller = "uv-pip" | "pip" | "npm" | "pnpm" | "yarn" | "manual";

export interface SkillSource {
  name: string;
  version: string;
  type: "skill";
  author?: string;
  summary: string;
  activation: SkillActivation;
  body: string;
  filePath: string;
  frontmatterDependency?: Record<string, string[]>;
}

export interface SkillPackageIndex {
  rootDir: string;
  skillMdPath: string;
  metaJsonPath?: string;
  referenceFiles: string[];
  scriptFiles: string[];
  rootScriptFiles: string[];
  requirementsTxtPath?: string;
}

export interface ScriptDescriptor {
  path: string;
  runtime: SkillRuntime;
  imports: string[];
  hasCliMain: boolean;
}

export interface SkillEntrypoint {
  path: string;
  runtime: SkillRuntime;
  source: "single-script" | "naming-convention" | "manual";
}

export interface SkillDependency {
  name: string;
  installSpec?: string;
  source: SkillDependencySource;
  confidence: "high" | "medium" | "low";
}

/**
 * 依赖在当前运行环境中的满足状态。
 *
 * `unknown` 与 `missing` 必须区分：前者是「探测手段本身不可用」（venv/包管理器缺失、
 * 元数据查询失败），后者是「确认没装」。混为一谈会让用户误以为环境残缺。
 */
export type DependencyStatus = "ok" | "missing" | "outdated" | "unknown";

export interface SkillDependencyCheck extends SkillDependency {
  status: DependencyStatus;
  installedVersion?: string;
}

/**
 * 解释器自身的探测结果。只承载事实，不做文案——展示层负责组装成用户可读的标签。
 */
export interface SkillRuntimeCheck {
  runtime: SkillRuntime;
  /** 探测所用的可执行文件名，如 "python3"。 */
  binary: string;
  status: "ok" | "missing";
  /** `--version` 解析出的版本号，如 "3.11.5"。 */
  version?: string;
  /** 依赖安装目录（python 的 .venv / node 的 node_modules）是否已就绪。 */
  envReady: boolean;
}

export interface DetectedSkillRuntime {
  kind: DetectedSkillKind;
  preferredInstaller: SkillProvisionInstaller;
  entrypoint?: SkillEntrypoint;
  scriptSet?: string[];
  dependencies: SkillDependency[];
  issues: string[];
  evidence: string[];
}

export interface CompiledSkill {
  source: SkillSource;
  packageIndex?: SkillPackageIndex;
  detectedRuntime?: DetectedSkillRuntime;
}

export interface InstalledSkill {
  skill: CompiledSkill;
  origin: "builtin" | "user";
  enabled: boolean;
  installedAt: string;
  provisionStatus?: ProvisionStatus;
  provisionError?: string;
}

export interface SkillSnapshot {
  readonly alwaysOn: ReadonlyArray<{ name: string; body: string }>;
  readonly index: ReadonlyArray<{ name: string; summary: string }>;
  readonly onDemand: ReadonlyMap<string, CompiledSkill>;
}

export interface SkillCatalogItem {
  name: string;
  summary: string;
  version: string;
  author?: string;
  type: "skill";
  activation: SkillActivation;
  origin: "builtin" | "user";
  enabled: boolean;
  installedAt: string;
  filePath: string;
  runtimeKind: DetectedSkillKind;
  entrypointPath?: string;
  dependencyNames: string[];
  hasRuntime?: boolean;
  scriptSet?: string[];
  provisionStatus?: ProvisionStatus;
  provisionError?: string;
}

export interface InstallerError {
  filePath: string;
  error: string;
}

export interface SkillInstallerResult {
  loaded: string[];
  failed: InstallerError[];
}

export interface SkillRegistry {
  swap(snapshot: SkillSnapshot): void;
  current(): SkillSnapshot;
  getOnDemandSkill(name: string): CompiledSkill | null;
}

export interface SkillInstaller {
  initialize(builtinDir: string, userDir: string): Promise<SkillInstallerResult>;
  list(): SkillCatalogItem[];
  get(name: string): SkillCatalogItem | null;
  getSource(name: string): Promise<string | null>;
  validate(markdown: string): Promise<SkillCatalogItem>;
  install(markdown: string): Promise<SkillCatalogItem>;
  installDirectory(sourceDir: string): Promise<SkillCatalogItem>;
  update(name: string, markdown: string): Promise<SkillCatalogItem>;
  remove(name: string): Promise<void>;
  enable(name: string): Promise<SkillCatalogItem>;
  disable(name: string): Promise<SkillCatalogItem>;
  getInstalled(name: string): InstalledSkill | null;
  setProvisionStatus(name: string, status: ProvisionStatus, error?: string): Promise<void>;
}

export type ProvisionableKind =
  | "python-script"
  | "python-script-set"
  | "node-script"
  | "node-script-set";

const PROVISIONABLE_KINDS: ReadonlySet<DetectedSkillKind> = new Set([
  "python-script",
  "python-script-set",
  "node-script",
  "node-script-set",
]);

export function isProvisionableKind(kind?: DetectedSkillKind): kind is ProvisionableKind {
  return kind !== undefined && PROVISIONABLE_KINDS.has(kind);
}

export function runtimeOfKind(kind: ProvisionableKind): SkillRuntime {
  return kind.startsWith("python") ? "python" : "node";
}

export function isPythonKind(kind?: DetectedSkillKind): boolean {
  return kind === "python-script" || kind === "python-script-set";
}
