import type { Hono } from "hono";
import { seedDemoData } from "../../seed/demo-seed.js";

/**
 * DEMO_MODE only. Rebuilds the demo dataset on demand (JWT-protected like the
 * other /api routes). Useful for long-lived preview deployments where the
 * relative demo timestamps have gone stale.
 */
export function registerDemoSeedRoutes(app: Hono) {
  app.post("/api/demo/seed", async (c) => {
    const summary = await seedDemoData();
    return c.json({ data: summary });
  });
}
