export type SkillActivation = "always" | "on-demand";

export interface SkillSource {
  name: string;
  version: string;
  type: "skill";
  author?: string;
  summary: string;
  activation: SkillActivation;
  body: string;
  filePath: string;
}

export interface CompiledSkill {
  source: SkillSource;
}

export interface InstalledSkill {
  skill: CompiledSkill;
  origin: "builtin" | "user";
  enabled: boolean;
  installedAt: string;
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
  update(name: string, markdown: string): Promise<SkillCatalogItem>;
  remove(name: string): Promise<void>;
  enable(name: string): Promise<SkillCatalogItem>;
  disable(name: string): Promise<SkillCatalogItem>;
}
