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
  SettingsAssetStoragePage,
  SettingsGeneralPage,
  SettingsNetworkSearchPage,
  SettingsRssPage,
  SkillsPage,
  TaskCenterPage,
  ToolsPage,
  UsagePage,
  WebhookLogsPage,
  WebhooksPage,
} from "./lazy-pages.js";

/**
 * Which sidebar menu a route shows. Add a key here, register its nav component
 * in `layout/Sidebar/sidebarVariants.ts`, then set `sidebar` on the route(s).
 */
export type SidebarVariant = "default" | "settings" | "conversation";

export interface RouteConfig {
  path: string;
  Component: LazyExoticComponent<ComponentType>;
  /** Sidebar menu variant for this route. Omitted = "default". */
  sidebar?: SidebarVariant;
}

/** Routes rendered outside the auth guard (no AppShell layout). */
export const publicRoutes: RouteConfig[] = [{ path: "/auth/login", Component: AuthLoginPage }];

/** Routes rendered inside ProtectedRoute + AppShell layout. */
export const protectedRoutes: RouteConfig[] = [
  { path: "/", Component: DashboardPage },
  { path: "/observability", Component: ObservabilityPage },
  { path: "/observability/traces/:traceId", Component: ObservabilityTracePage },
  { path: "/usage", Component: UsagePage },
  { path: "/accounts/:accountId", Component: ConversationPage, sidebar: "conversation" },
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
  {
    path: "/model-config/providers/:providerConfigId",
    Component: ProviderConfigPage,
  },
  { path: "/settings", Component: SettingsGeneralPage, sidebar: "settings" },
  {
    path: "/settings/general",
    Component: SettingsGeneralPage,
    sidebar: "settings",
  },
  { path: "/settings/rss", Component: SettingsRssPage, sidebar: "settings" },
  {
    path: "/settings/asset-storage",
    Component: SettingsAssetStoragePage,
    sidebar: "settings",
  },
  {
    path: "/settings/network-search",
    Component: SettingsNetworkSearchPage,
    sidebar: "settings",
  },
];
