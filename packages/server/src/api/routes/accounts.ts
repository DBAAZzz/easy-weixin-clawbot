import type { AccountStatusFilter } from "@clawbot/shared";
import type { Hono } from "hono";
import { getAccount, listAccounts, updateAccountAlias } from "../../db/accounts.js";

interface AccountRouteDependencies {
  listAccounts: typeof listAccounts;
  getAccount: typeof getAccount;
  updateAccountAlias: typeof updateAccountAlias;
}

const defaultDependencies: AccountRouteDependencies = {
  listAccounts,
  getAccount,
  updateAccountAlias,
};

export function registerAccountRoutes(app: Hono, dependencies: AccountRouteDependencies = defaultDependencies) {
  app.get("/api/accounts", async (c) => {
    const statusParam = c.req.query("status");
    const status: AccountStatusFilter =
      statusParam === "active" || statusParam === "deprecated" ? statusParam : "all";

    return c.json({ data: await dependencies.listAccounts(status) });
  });

  app.get("/api/accounts/:accountId", async (c) => {
    const account = await dependencies.getAccount(c.req.param("accountId"));
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

    await dependencies.updateAccountAlias(accountId, body.alias);
    return c.json({ success: true });
  });
}
