import { lazy } from "react";

export const AuthLoginPage = lazy(() =>
  import("../pages/AuthLoginPage.js").then((m) => ({ default: m.AuthLoginPage })),
);
export const ConversationPage = lazy(() =>
  import("../pages/ConversationPage.js").then((m) => ({ default: m.ConversationPage })),
);
export const DashboardPage = lazy(() =>
  import("../pages/DashboardPage.js").then((m) => ({ default: m.DashboardPage })),
);
export const LoginPage = lazy(() =>
  import("../pages/LoginPage.js").then((m) => ({ default: m.LoginPage })),
);
export const McpPage = lazy(() =>
  import("../pages/McpPage.js").then((m) => ({ default: m.McpPage })),
);
export const MemoryGraphPage = lazy(() =>
  import("../pages/MemoryGraphPage.js").then((m) => ({ default: m.MemoryGraphPage })),
);
export const ModelConfigPage = lazy(() =>
  import("../pages/ModelConfigPage.js").then((m) => ({ default: m.ModelConfigPage })),
);
export const ObservabilityPage = lazy(() =>
  import("../pages/ObservabilityPage.js").then((m) => ({ default: m.ObservabilityPage })),
);
export const ObservabilityTracePage = lazy(() =>
  import("../pages/ObservabilityTracePage.js").then((m) => ({
    default: m.ObservabilityTracePage,
  })),
);
export const ProviderConfigPage = lazy(() =>
  import("../pages/ProviderConfigPage.js").then((m) => ({ default: m.ProviderConfigPage })),
);
export const RssSubscriptionsPage = lazy(() =>
  import("../pages/RssSubscriptionsPage.js").then((m) => ({ default: m.RssSubscriptionsPage })),
);
export const ScheduledTasksPage = lazy(() =>
  import("../pages/ScheduledTasksPage.js").then((m) => ({ default: m.ScheduledTasksPage })),
);
export const TaskCenterPage = lazy(() =>
  import("../pages/TaskCenterPage.js").then((m) => ({ default: m.TaskCenterPage })),
);
export const SkillsPage = lazy(() =>
  import("../pages/SkillsPage.js").then((m) => ({ default: m.SkillsPage })),
);
export const ToolsPage = lazy(() =>
  import("../pages/ToolsPage.js").then((m) => ({ default: m.ToolsPage })),
);
export const WebhookLogsPage = lazy(() =>
  import("../pages/WebhookLogsPage.js").then((m) => ({ default: m.WebhookLogsPage })),
);
export const WebhooksPage = lazy(() =>
  import("../pages/WebhooksPage.js").then((m) => ({ default: m.WebhooksPage })),
);
