import { lazy } from "react";
import type { ComponentType } from "react";

function lazyNamedPage<TModule extends Record<TExport, ComponentType>, TExport extends string>(
  load: () => Promise<TModule>,
  exportName: TExport,
) {
  return lazy(async () => {
    const module = await load();
    return { default: module[exportName] };
  });
}

export const AuthLoginPage = lazyNamedPage(
  () => import("../features/AuthLogin/index.js"),
  "AuthLoginPage",
);
export const ConversationPage = lazyNamedPage(
  () => import("../features/Conversation/index.js"),
  "ConversationPage",
);
export const DashboardPage = lazyNamedPage(
  () => import("../features/Dashboard/index.js"),
  "DashboardPage",
);
export const LoginPage = lazyNamedPage(() => import("../features/Login/index.js"), "LoginPage");
export const McpPage = lazyNamedPage(() => import("../features/Mcp/index.js"), "McpPage");
export const MemoryGraphPage = lazyNamedPage(
  () => import("../features/MemoryGraph/index.js"),
  "MemoryGraphPage",
);
export const ModelConfigPage = lazyNamedPage(
  () => import("../features/ModelConfig/index.js"),
  "ModelConfigPage",
);
export const ObservabilityPage = lazyNamedPage(
  () => import("../features/Observability/index.js"),
  "ObservabilityPage",
);
export const ObservabilityTracePage = lazyNamedPage(
  () => import("../features/ObservabilityTrace/index.js"),
  "ObservabilityTracePage",
);
export const ProviderConfigPage = lazyNamedPage(
  () => import("../features/ProviderConfig/index.js"),
  "ProviderConfigPage",
);
export const RssSubscriptionsPage = lazyNamedPage(
  () => import("../features/RssSubscriptions/index.js"),
  "RssSubscriptionsPage",
);
export const ScheduledTasksPage = lazyNamedPage(
  () => import("../features/ScheduledTasks/index.js"),
  "ScheduledTasksPage",
);
export const TaskCenterPage = lazyNamedPage(
  () => import("../features/TaskCenter/index.js"),
  "TaskCenterPage",
);
export const SkillsPage = lazyNamedPage(() => import("../features/Skills/index.js"), "SkillsPage");
export const ToolsPage = lazyNamedPage(() => import("../features/Tools/index.js"), "ToolsPage");
export const WebhookLogsPage = lazyNamedPage(
  () => import("../features/WebhookLogs/index.js"),
  "WebhookLogsPage",
);
export const WebhooksPage = lazyNamedPage(
  () => import("../features/Webhooks/index.js"),
  "WebhooksPage",
);
