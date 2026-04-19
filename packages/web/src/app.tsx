import { QueryClientProvider } from "@tanstack/react-query";
import { AppToaster } from "./components/ui/sonner.js";
import { AppRoutes } from "./router/AppRoutes.js";
import { queryClient } from "./lib/query-client.js";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
      <AppToaster />
    </QueryClientProvider>
  );
}
