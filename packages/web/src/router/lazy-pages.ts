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
  () => import("../features/AuthLoginPage.js"),
  "AuthLoginPage",
);
export const ConversationPage = lazyNamedPage(
  () => import("../features/ConversationPage.js"),
  "ConversationPage",
);
export const DashboardPage = lazyNamedPage(
  () => import("../features/Dashboard/index.js"),
  "DashboardPage",
);
export const LoginPage = lazyNamedPage(() => import("../features/LoginPage.js"), "LoginPage");
export const McpPage = lazyNamedPage(() => import("../features/McpPage.js"), "McpPage");
export const MemoryGraphPage = lazyNamedPage(
  () => import("../features/MemoryGraphPage.js"),
  "MemoryGraphPage",
);
export const ModelConfigPage = lazyNamedPage(
  () => import("../features/ModelConfigPage.js"),
  "ModelConfigPage",
);
export const ObservabilityPage = lazyNamedPage(
  () => import("../features/ObservabilityPage.js"),
  "ObservabilityPage",
);
export const ObservabilityTracePage = lazyNamedPage(
  () => import("../features/ObservabilityTracePage.js"),
  "ObservabilityTracePage",
);
export const ProviderConfigPage = lazyNamedPage(
  () => import("../features/ProviderConfigPage.js"),
  "ProviderConfigPage",
);
export const RssSubscriptionsPage = lazyNamedPage(
  () => import("../features/RssSubscriptionsPage.js"),
  "RssSubscriptionsPage",
);
export const ScheduledTasksPage = lazyNamedPage(
  () => import("../features/ScheduledTasksPage.js"),
  "ScheduledTasksPage",
);
export const TaskCenterPage = lazyNamedPage(
  () => import("../features/TaskCenterPage.js"),
  "TaskCenterPage",
);
export const SkillsPage = lazyNamedPage(() => import("../features/SkillsPage.js"), "SkillsPage");
export const ToolsPage = lazyNamedPage(() => import("../features/ToolsPage.js"), "ToolsPage");
export const WebhookLogsPage = lazyNamedPage(
  () => import("../features/WebhookLogsPage.js"),
  "WebhookLogsPage",
);
export const WebhooksPage = lazyNamedPage(
  () => import("../features/WebhooksPage.js"),
  "WebhooksPage",
);
