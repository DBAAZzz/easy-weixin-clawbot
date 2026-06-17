import { QueryClientProvider } from "@tanstack/react-query";
import { AppToaster } from "@clawbot/ui";
import { AppRoutes } from "./router/index.js";
import { queryClient } from "./lib/query-client.js";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
      <AppToaster />
    </QueryClientProvider>
  );
}
