import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "../layout/AppShell.js";
import { AuthLoginPage } from "../pages/AuthLoginPage.js";
import { ConversationPage } from "../pages/ConversationPage.js";
import { DashboardPage } from "../pages/DashboardPage.js";
import { LoginPage } from "../pages/LoginPage.js";
import { McpPage } from "../pages/McpPage.js";
import { MemoryGraphPage } from "../pages/MemoryGraphPage.js";
import { ModelConfigPage } from "../pages/ModelConfigPage.js";
import { ObservabilityPage } from "../pages/ObservabilityPage.js";
import { ObservabilityTracePage } from "../pages/ObservabilityTracePage.js";
import { ProviderConfigPage } from "../pages/ProviderConfigPage.js";
import { ScheduledTasksPage } from "../pages/ScheduledTasksPage.js";
import { SkillsPage } from "../pages/SkillsPage.js";
import { ToolsPage } from "../pages/ToolsPage.js";
import { WebhookLogsPage } from "../pages/WebhookLogsPage.js";
import { WebhooksPage } from "../pages/WebhooksPage.js";
import { ProtectedRoute } from "./ProtectedRoute.js";

export function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth/login" element={<AuthLoginPage />} />
        <Route
          element={
            <ProtectedRoute>
              <AppShell />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<DashboardPage />} />
          <Route path="/observability" element={<ObservabilityPage />} />
          <Route path="/observability/traces/:traceId" element={<ObservabilityTracePage />} />
          <Route path="/accounts/:accountId" element={<ConversationPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/mcp" element={<McpPage />} />
          <Route path="/memory-graph" element={<MemoryGraphPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
          <Route path="/webhooks" element={<WebhooksPage />} />
          <Route path="/webhooks/:source/logs" element={<WebhookLogsPage />} />
          <Route path="/scheduled-tasks" element={<ScheduledTasksPage />} />
          <Route path="/model-config" element={<ModelConfigPage />} />
          <Route path="/model-config/providers/new" element={<ProviderConfigPage />} />
          <Route
            path="/model-config/providers/:providerConfigId"
            element={<ProviderConfigPage />}
          />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
