/**
 * Demo/preview mode — when enabled, the server seeds a self-contained set of
 * demo data on boot and exposes a local mock OpenAI-compatible endpoint, so a
 * fresh deployment can be explored without binding a real WeChat account or
 * configuring a real LLM provider.
 *
 * Demo rows are namespaced (`demo-wxid-*` accounts, "演示" prefixes) and the
 * seeder only ever rewrites rows it owns, so running with DEMO_MODE=true on a
 * database that already holds real data never touches that data.
 */
export function isDemoMode(): boolean {
  const value = process.env.DEMO_MODE?.trim().toLowerCase();
  return value === "true" || value === "1";
}
