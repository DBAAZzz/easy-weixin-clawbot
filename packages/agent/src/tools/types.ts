import type { ZodTypeAny } from "zod";
import type { TextContent, ImageContent } from "../llm/types.js";

export interface NativeToolDefinition {
  name: string;
  handler: string;
  description: string;
  parameters: ZodTypeAny;
  parameterNames: string[];
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolContent[]>;
}

export interface ToolContext {
  signal: AbortSignal;
}

export type ToolContent = TextContent | ImageContent;

export interface NativeHandler {
  execute(
    args: Record<string, unknown>,
    config: Record<string, unknown>,
    ctx: ToolContext,
  ): Promise<ToolContent[]>;
}

export interface ToolSnapshotItem {
  name: string;
  description: string;
  parameters: ZodTypeAny;
  execute: NativeToolDefinition["execute"];
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
  description: string;
  type: "tool";
  handler: string;
  origin: "builtin";
  enabled: boolean;
  managedBySystem: boolean;
  parameterNames: string[];
}
