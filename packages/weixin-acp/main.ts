#!/usr/bin/env node

/**
 * WeChat + ACP (Agent Client Protocol) adapter.
 *
 * Usage:
 *   npx weixin-acp login                          # QR-code login
 *   npx weixin-acp claude-code                     # Start with Claude Code
 *   npx weixin-acp codex                           # Start with Codex
 *   npx weixin-acp start -- <command> [args...]    # Start with custom agent
 *
 * Examples:
 *   npx weixin-acp start -- node ./my-agent.js
 */

import {
  getDefaultCdnBaseUrl,
  loginWithEvents,
  monitorWeixinProvider,
} from "@clawbot/weixin-agent-sdk";

import { AcpAgent } from "./src/acp-agent.js";
import { clearSession, loadSession, saveSession, saveSessionSyncBuf } from "./src/session-store.js";

/** Built-in agent shortcuts */
const BUILTIN_AGENTS: Record<string, { command: string }> = {
  "claude-code": { command: "claude-agent-acp" },
  codex: { command: "codex-acp" },
};

const command = process.argv[2];

async function loginAndSaveSession() {
  console.log("正在启动微信扫码登录...");
  const result = await loginWithEvents({
    onQrReady: ({ qrcodeUrl }) => {
      console.log(`二维码链接: ${qrcodeUrl}`);
    },
    onScanned: () => {
      console.log("已扫码，等待确认...");
    },
    onExpired: () => {
      console.log("二维码已过期，正在刷新...");
    },
  });

  console.log("\n✅ 与微信连接成功！");
  return saveSession({
    accountId: result.accountId,
    token: result.botToken,
    baseUrl: result.baseUrl,
    ...(result.userId ? { userId: result.userId } : {}),
    syncBuf: "",
  });
}

async function ensureLoggedIn() {
  const existing = loadSession();
  if (existing) {
    return existing;
  }

  console.log("未检测到登录信息，请先扫码登录微信\n");
  return loginAndSaveSession();
}

async function startAgent(acpCommand: string, acpArgs: string[] = []) {
  const session = await ensureLoggedIn();

  const agent = new AcpAgent({ command: acpCommand, args: acpArgs });

  const ac = new AbortController();
  process.on("SIGINT", () => {
    console.log("\n正在停止...");
    agent.dispose();
    ac.abort();
  });
  process.on("SIGTERM", () => {
    agent.dispose();
    ac.abort();
  });

  return monitorWeixinProvider({
    baseUrl: session.baseUrl,
    cdnBaseUrl: getDefaultCdnBaseUrl(),
    token: session.token,
    accountId: session.accountId,
    agent,
    abortSignal: ac.signal,
    syncBufInitial: session.syncBuf,
    onSyncBufUpdate: (buf) => {
      saveSessionSyncBuf(buf);
    },
  });
}

async function main() {
  if (command === "login") {
    await loginAndSaveSession();
    return;
  }

  if (command === "logout") {
    clearSession();
    console.log("✅ 已退出登录");
    return;
  }

  if (command === "start") {
    const ddIndex = process.argv.indexOf("--");
    if (ddIndex === -1 || ddIndex + 1 >= process.argv.length) {
      console.error("错误: 请在 -- 后指定 ACP agent 启动命令");
      console.error("示例: npx weixin-acp start -- codex-acp");
      process.exit(1);
    }

    const [acpCommand, ...acpArgs] = process.argv.slice(ddIndex + 1);
    await startAgent(acpCommand, acpArgs);
    return;
  }

  if (command && command in BUILTIN_AGENTS) {
    const { command: acpCommand } = BUILTIN_AGENTS[command];
    await startAgent(acpCommand);
    return;
  }

  console.log(`weixin-acp — 微信 + ACP 适配器

用法:
  npx weixin-acp login                          扫码登录微信
  npx weixin-acp logout                         退出登录
  npx weixin-acp claude-code                     使用 Claude Code
  npx weixin-acp codex                           使用 Codex
  npx weixin-acp start -- <command> [args...]    使用自定义 agent

示例:
  npx weixin-acp start -- node ./my-agent.js`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
