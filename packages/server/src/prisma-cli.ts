import "./config/load-env.js";
import { spawn } from "node:child_process";
import { ensurePrismaUrls } from "./db/prisma-env.js";

const { databaseUrl, directUrl } = ensurePrismaUrls();
const args = process.argv.slice(2);

const child = spawn("prisma", args, {
  stdio: "inherit",
  env: {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DIRECT_URL: directUrl,
  },
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 1);
});
