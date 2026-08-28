import { disconnectPrisma } from "./db/prisma.js";
import { WeixinIngressDispatchStore } from "./db/weixin-ingress-dispatch-store.js";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main(): Promise<void> {
  const command = process.argv[2];
  const store = new WeixinIngressDispatchStore();
  if (command === "stuck") {
    const seconds = Number(option("--older-than-seconds") ?? "300");
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error("invalid --older-than-seconds");
    const rows = await store.listStuck(seconds);
    for (const row of rows) console.log(JSON.stringify(row));
    return;
  }
  if (command === "resolve") {
    if (option("--action") !== "mark-failed") throw new Error("only --action mark-failed is allowed");
    const eventId = option("--event-id");
    const operator = option("--operator");
    const reason = option("--reason");
    if (!eventId || !operator || !reason) throw new Error("event-id, operator and reason are required");
    await store.markFailedByOperator(eventId, operator, reason);
    console.log(JSON.stringify({ eventId, status: "failed", errorCode: "operator_abandoned" }));
    return;
  }
  throw new Error("usage: ingress-admin.ts stuck|resolve");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => disconnectPrisma());
