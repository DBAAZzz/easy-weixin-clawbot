import type { ComponentType, LazyExoticComponent } from "react";
import {
  AuthLoginPage,
  ConversationPage,
  DashboardPage,
  LoginPage,
  McpPage,
  MemoryGraphPage,
  ModelConfigPage,
  ObservabilityPage,
  ObservabilityTracePage,
  ProviderConfigPage,
  RssSubscriptionsPage,
  ScheduledTasksPage,
  SkillsPage,
  TaskCenterPage,
  ToolsPage,
  WebhookLogsPage,
  WebhooksPage,
} from "./lazy-pages.js";

export interface RouteConfig {
  path: string;
  Component: LazyExoticComponent<ComponentType>;
}

/** Routes rendered outside the auth guard (no AppShell layout). */
export const publicRoutes: RouteConfig[] = [{ path: "/auth/login", Component: AuthLoginPage }];

/** Routes rendered inside ProtectedRoute + AppShell layout. */
export const protectedRoutes: RouteConfig[] = [
  { path: "/", Component: DashboardPage },
  { path: "/observability", Component: ObservabilityPage },
  { path: "/observability/traces/:traceId", Component: ObservabilityTracePage },
  { path: "/accounts/:accountId", Component: ConversationPage },
  { path: "/login", Component: LoginPage },
  { path: "/mcp", Component: McpPage },
  { path: "/memory-graph", Component: MemoryGraphPage },
  { path: "/tools", Component: ToolsPage },
  { path: "/skills", Component: SkillsPage },
  { path: "/webhooks", Component: WebhooksPage },
  { path: "/webhooks/:source/logs", Component: WebhookLogsPage },
  { path: "/rss-subscriptions", Component: RssSubscriptionsPage },
  { path: "/task-center", Component: TaskCenterPage },
  { path: "/scheduled-tasks", Component: ScheduledTasksPage },
  { path: "/model-config", Component: ModelConfigPage },
  { path: "/model-config/providers/new", Component: ProviderConfigPage },
  { path: "/model-config/providers/:providerConfigId", Component: ProviderConfigPage },
];
