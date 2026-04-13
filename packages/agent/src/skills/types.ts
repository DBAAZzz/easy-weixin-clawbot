import type { CompiledTool, ParameterDef } from "../tools/types.js";

export type SkillActivation = "always" | "on-demand";

export interface SkillRuntimeDecl {
  type: "python" | "node";
  dependencies: string[];
}

export type ProvisionStatus = "pending" | "provisioning" | "ready" | "failed";

export interface SkillSource {
  name: string;
  version: string;
  type: "skill";
  author?: string;
  summary: string;
  activation: SkillActivation;
  body: string;
  filePath: string;

  // Optional: companion tool fields
  handler?: string;
  handlerConfig?: Record<string, unknown>;
  inputSchema?: Record<string, ParameterDef>;

  // Optional: runtime declaration
  runtime?: SkillRuntimeDecl;
}

export interface CompiledSkill {
  source: SkillSource;
  companionTool?: CompiledTool;
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
  hasCompanionTool?: boolean;
  hasRuntime?: boolean;
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
