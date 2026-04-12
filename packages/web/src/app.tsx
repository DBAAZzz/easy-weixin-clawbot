import { QueryClientProvider } from "@tanstack/react-query";
import { AppRoutes } from "./router/AppRoutes.js";
import { queryClient } from "./lib/query-client.js";

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
    </QueryClientProvider>
  );
}
