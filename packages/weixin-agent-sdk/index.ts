/// <reference path="./src/vendor.d.ts" />

export type { Agent, ChatRequest, ChatResponse } from "./src/agent/interface.js";
export { loginWithEvents, monitorWeixinProvider, getDefaultCdnBaseUrl, getDefaultBaseUrl } from "./src/bot.js";
export type { LoginOptions, LoginResult, LoginEvents, MonitorWeixinOpts } from "./src/bot.js";
export { sendMessageWeixin } from "./src/messaging/send.js";
export { sendWeixinMediaFile } from "./src/messaging/send-media.js";
export { normalizeAccountId } from "./src/auth/accounts.js";
export type { WeixinApiOptions } from "./src/api/api.js";
