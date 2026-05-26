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
  () => import("../pages/AuthLoginPage.js"),
  "AuthLoginPage",
);
export const ConversationPage = lazyNamedPage(
  () => import("../pages/ConversationPage.js"),
  "ConversationPage",
);
export const DashboardPage = lazyNamedPage(
  () => import("../pages/DashboardPage.js"),
  "DashboardPage",
);
export const LoginPage = lazyNamedPage(() => import("../pages/LoginPage.js"), "LoginPage");
export const McpPage = lazyNamedPage(() => import("../pages/McpPage.js"), "McpPage");
export const MemoryGraphPage = lazyNamedPage(
  () => import("../pages/MemoryGraphPage.js"),
  "MemoryGraphPage",
);
export const ModelConfigPage = lazyNamedPage(
  () => import("../pages/ModelConfigPage.js"),
  "ModelConfigPage",
);
export const ObservabilityPage = lazyNamedPage(
  () => import("../pages/ObservabilityPage.js"),
  "ObservabilityPage",
);
export const ObservabilityTracePage = lazyNamedPage(
  () => import("../pages/ObservabilityTracePage.js"),
  "ObservabilityTracePage",
);
export const ProviderConfigPage = lazyNamedPage(
  () => import("../pages/ProviderConfigPage.js"),
  "ProviderConfigPage",
);
export const RssSubscriptionsPage = lazyNamedPage(
  () => import("../pages/RssSubscriptionsPage.js"),
  "RssSubscriptionsPage",
);
export const ScheduledTasksPage = lazyNamedPage(
  () => import("../pages/ScheduledTasksPage.js"),
  "ScheduledTasksPage",
);
export const TaskCenterPage = lazyNamedPage(
  () => import("../pages/TaskCenterPage.js"),
  "TaskCenterPage",
);
export const SkillsPage = lazyNamedPage(() => import("../pages/SkillsPage.js"), "SkillsPage");
export const ToolsPage = lazyNamedPage(() => import("../pages/ToolsPage.js"), "ToolsPage");
export const WebhookLogsPage = lazyNamedPage(
  () => import("../pages/WebhookLogsPage.js"),
  "WebhookLogsPage",
);
export const WebhooksPage = lazyNamedPage(() => import("../pages/WebhooksPage.js"), "WebhooksPage");
