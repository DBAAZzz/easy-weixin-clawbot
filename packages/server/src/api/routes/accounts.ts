import type { Hono } from "hono";
import { getAccount, listAccounts } from "../../db/accounts.js";

export function registerAccountRoutes(app: Hono) {
  app.get("/api/accounts", async (c) => {
    return c.json({ data: await listAccounts() });
  });

  app.get("/api/accounts/:accountId", async (c) => {
    const account = await getAccount(c.req.param("accountId"));
    if (!account) {
      return c.json({ error: "account not found" }, 404);
    }

    return c.json({ data: account });
  });
}
