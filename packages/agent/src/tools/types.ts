import type { ImageContent, TextContent, Tool, TSchema } from "@mariozechner/pi-ai";

export interface ParameterDef {
  type: "string" | "integer" | "number" | "boolean";
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
}

export interface ToolSource {
  name: string;
  version: string;
  type: "tool";
  author?: string;
  summary: string;
  handler: string;
  handlerConfig?: Record<string, unknown>;
  inputSchema: Record<string, ParameterDef>;
  body: string;
  filePath: string;
}

export interface ToolContext {
  signal: AbortSignal;
}

export type ToolContent = TextContent | ImageContent;

export interface CompiledTool {
  source: ToolSource;
  parameters: TSchema;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolContent[]>;
}

export interface InstalledTool {
  tool: CompiledTool;
  origin: "builtin" | "user";
  enabled: boolean;
  installedAt: string;
}

export interface NativeHandler {
  execute(
    args: Record<string, unknown>,
    config: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolContent[]>;
}

export interface ToolSnapshotItem extends Tool<TSchema> {
  execute: CompiledTool["execute"];
}

export interface ToolSnapshot {
  readonly tools: ReadonlyArray<ToolSnapshotItem>;
}

export interface ToolRegistry {
  swap(snapshot: ToolSnapshot): void;
  current(): ToolSnapshot;
  execute(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolContent[]>;
}

export interface ToolCatalogItem {
  name: string;
  summary: string;
  version: string;
  author?: string;
  type: "tool";
  handler: string;
  origin: "builtin" | "user";
  enabled: boolean;
  parameterNames: string[];
  installedAt: string;
  filePath: string;
}

export interface InstallerError {
  filePath: string;
  error: string;
}

export interface ToolInstallerResult {
  loaded: string[];
  failed: InstallerError[];
}

export interface ToolInstaller {
  initialize(builtinDir: string, userDir: string): Promise<ToolInstallerResult>;
  list(): ToolCatalogItem[];
  get(name: string): ToolCatalogItem | null;
  getSource(name: string): Promise<string | null>;
  validate(markdown: string): Promise<ToolCatalogItem>;
  install(markdown: string): Promise<ToolCatalogItem>;
  update(name: string, markdown: string): Promise<ToolCatalogItem>;
  remove(name: string): Promise<void>;
  enable(name: string): Promise<ToolCatalogItem>;
  disable(name: string): Promise<ToolCatalogItem>;
}
