import type { SkillInfo } from "@clawbot/shared";

export type SkillDetailTab = "markdown" | "runtime";
export type SkillActivationFilter = "all" | SkillInfo["activation"];

export const skillActivationTabs: Array<{ value: SkillActivationFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "always", label: "常驻" },
  { value: "on-demand", label: "按需" },
];

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "code"; language: string | null; code: string };

export function formatActivationLabel(activation: SkillInfo["activation"]) {
  return activation === "always" ? "Always-On" : "On-Demand";
}

export function formatOriginLabel(origin: SkillInfo["origin"]) {
  return origin === "builtin" ? "内置" : "用户层";
}

export function runCheckTone(status: "ok" | "fail" | "info"): "online" | "error" | "muted" {
  if (status === "ok") return "online";
  if (status === "fail") return "error";
  return "muted";
}

export function stripMarkdownFrontmatter(markdown: string) {
  return markdown.replace(/^---\n[\s\S]*?\n---\n*/u, "").trim();
}

export function isMarkdownBlockBoundary(line: string) {
  const trimmed = line.trim();
  return (
    trimmed.length === 0 ||
    trimmed.startsWith("```") ||
    /^(#{1,6})\s+/.test(trimmed) ||
    /^[-*]\s+/.test(trimmed) ||
    /^\d+\.\s+/.test(trimmed) ||
    trimmed.startsWith(">")
  );
}

export function buildEnvironmentSnapshot(options: {
  dependencies: string[];
  scripts: string[];
  installer?: string;
  createEnv?: boolean;
  commands: string[];
}) {
  return JSON.stringify(
    {
      dependencies: options.dependencies,
      scripts: options.scripts,
      installer: options.installer ?? "unknown",
      createEnv: options.createEnv ?? false,
      commands: options.commands,
    },
    null,
    2,
  );
}
