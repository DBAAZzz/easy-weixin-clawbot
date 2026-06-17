import type { SkillInfo } from "@clawbot/shared";

export function formatRuntimeKindLabel(kind?: SkillInfo["runtimeKind"]) {
  if (!kind || kind === "knowledge-only") return "知识型";
  if (kind === "python-script") return "Python Script";
  if (kind === "python-script-set") return "Python Script Set";
  if (kind === "node-script") return "Node Script";
  if (kind === "node-script-set") return "Node Script Set";
  return "需要人工确认";
}

export function isAutoProvisionableRuntime(kind?: SkillInfo["runtimeKind"]) {
  return (
    kind === "python-script" ||
    kind === "python-script-set" ||
    kind === "node-script" ||
    kind === "node-script-set"
  );
}
