import { BrowserRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell.js";
import { ConversationPage } from "./pages/ConversationPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { McpPage } from "./pages/McpPage.js";
import { SkillsPage } from "./pages/SkillsPage.js";
import { ToolsPage } from "./pages/ToolsPage.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/accounts/:accountId" element={<ConversationPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/mcp" element={<McpPage />} />
          <Route path="/tools" element={<ToolsPage />} />
          <Route path="/skills" element={<SkillsPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
