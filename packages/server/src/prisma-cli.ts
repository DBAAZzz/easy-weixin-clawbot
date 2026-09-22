// 豁免于 @clawbot/exec 封锁：开发期 CLI，运行于管理员终端，见 docs/2026-07-23_21_30_exec-package-design.md §5.6
import "./config/load-env.js";
import { spawn } from "node:child_process";
import { ensurePrismaUrls } from "./db/prisma-env.js";

const args = process.argv.slice(2);
// generate/validate 只解析 schema 不连库，env 缺失时占位串放行，避免 postinstall 卡在未配置 .env 的环境
const SCHEMA_ONLY_COMMANDS = new Set(["generate", "validate"]);
const { databaseUrl, directUrl } = ensurePrismaUrls({
  allowPlaceholder: SCHEMA_ONLY_COMMANDS.has(args[0] ?? ""),
});

const child = spawn("prisma", args, {
  stdio: "inherit",
  // Windows 上 prisma 是 .cmd shim，spawn 必须经 shell 才能解析
  shell: process.platform === "win32",
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
