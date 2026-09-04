import type {
  SkillDependencyStatus,
  SkillInfo,
  SkillProvisionPlan,
  SkillRuntimeCheck,
} from "@clawbot/shared";

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

export function formatDependencyStatus(status: SkillDependencyStatus) {
  if (status === "ok")
    return { label: "已满足", dot: "bg-account-success-dot", text: "text-account-success-fg" };
  if (status === "outdated")
    return { label: "版本不符", dot: "bg-account-warning-dot", text: "text-account-warning-fg" };
  if (status === "missing")
    return { label: "未安装", dot: "bg-danger", text: "text-danger-strong" };
  return { label: "无法检测", dot: "bg-account-muted-faint", text: "text-account-muted" };
}

export function formatRuntimeLabel(check: SkillRuntimeCheck) {
  const name = check.runtime === "python" ? "Python" : "Node";
  return check.version ? `${name} ${check.version}` : name;
}

export function formatInstallerLabel(installer: SkillProvisionPlan["installer"]) {
  return installer === "manual" ? "未确定" : installer;
}

/** 环境是否全部就绪——决定安装按钮是可用还是显示「已就绪」。 */
export function isEnvironmentReady(plan: SkillProvisionPlan | null) {
  if (!plan) return false;
  if (plan.runtimeCheck.status !== "ok") return false;
  return plan.dependencies.every((dependency) => dependency.status === "ok");
}

/** 头部汇总：待处理项数含运行时缺失与所有非 ok 依赖。 */
export function countPendingConditions(plan: SkillProvisionPlan) {
  const runtimePending = plan.runtimeCheck.status === "ok" ? 0 : 1;
  const depsPending = plan.dependencies.filter((dependency) => dependency.status !== "ok").length;
  return runtimePending + depsPending;
}
