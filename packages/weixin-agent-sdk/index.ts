/// <reference path="./src/vendor.d.ts" />

export type { Agent, ChatRequest, ChatResponse } from "./src/agent/interface.js";
export { isLoggedIn, login, logout, start, loginWithEvents, monitorWeixinProvider, getDefaultCdnBaseUrl, getDefaultBaseUrl } from "./src/bot.js";
export type { LoginOptions, StartOptions, LoginResult, LoginEvents, MonitorWeixinOpts } from "./src/bot.js";
export { sendMessageWeixin } from "./src/messaging/send.js";
export { sendWeixinMediaFile } from "./src/messaging/send-media.js";
export { resolveWeixinAccount } from "./src/auth/accounts.js";
export { normalizeAccountId } from "./src/auth/accounts.js";
export type { WeixinApiOptions } from "./src/api/api.js";
