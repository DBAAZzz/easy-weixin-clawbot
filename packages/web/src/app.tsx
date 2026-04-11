import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell.js";
import { queryClient } from "./lib/query-client.js";
import { AuthLoginPage } from "./pages/AuthLoginPage.js";
import { ConversationPage } from "./pages/ConversationPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { MemoryGraphPage } from "./pages/MemoryGraphPage.js";
import { McpPage } from "./pages/McpPage.js";
import { ObservabilityPage } from "./pages/ObservabilityPage.js";
import { ScheduledTasksPage } from "./pages/ScheduledTasksPage.js";
import { ObservabilityTracePage } from "./pages/ObservabilityTracePage.js";
import { ProviderConfigPage } from "./pages/ProviderConfigPage.js";
import { SkillsPage } from "./pages/SkillsPage.js";
import { ToolsPage } from "./pages/ToolsPage.js";
import { WebhookLogsPage } from "./pages/WebhookLogsPage.js";
import { ModelConfigPage } from "./pages/ModelConfigPage.js";
import { WebhooksPage } from "./pages/WebhooksPage.js";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const token = localStorage.getItem("auth_token");
  return token ? <>{children}</> : <Navigate to="/auth/login" />;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
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
          <Route path="/model-config/providers/:providerConfigId" element={<ProviderConfigPage />} />
        </Route>
      </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
