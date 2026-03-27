import type { Hono } from "hono";
import { getAccount, listAccounts, updateAccountAlias } from "../../db/accounts.js";

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

  app.patch("/api/accounts/:accountId", async (c) => {
    const accountId = c.req.param("accountId");
    const body = await c.req.json();

    if (typeof body.alias !== "string" && body.alias !== null) {
      return c.json({ error: "alias must be string or null" }, 400);
    }

    await updateAccountAlias(accountId, body.alias);
    return c.json({ success: true });
  });
}
