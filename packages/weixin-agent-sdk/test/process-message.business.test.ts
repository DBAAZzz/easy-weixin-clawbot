import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Agent, ChatRequest, WeixinIngressLifecycle } from "../src/agent/interface.js";
import type { WeixinMessage } from "../src/api/types.js";
import { MessageItemType } from "../src/api/types.js";
import { processOneMessage } from "../src/messaging/process-message.js";

function inboundText(text: string): WeixinMessage {
  return {
    seq: 42,
    message_id: 987654,
    client_id: "platform-client-1",
    session_id: "platform-session-1",
    from_user_id: "wx-user-1",
    to_user_id: "bot-1",
    create_time_ms: Date.parse("2026-08-28T00:00:00.000Z"),
    context_token: "context-token-1",
    item_list: [{ type: MessageItemType.TEXT, msg_id: "item-message-1", text_item: { text } }],
  };
}

async function startWeixinApi(options?: { status?: number }) {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      requests.push({
        path: request.url ?? "",
        body: raw ? (JSON.parse(raw) as Record<string, unknown>) : {},
      });
      response.statusCode = options?.status ?? 200;
      response.setHeader("content-type", "application/json");
      response.end(options?.status && options.status >= 400 ? "temporary failure" : "{}");
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

const silentLog = () => {};

test("微信入站消息到达 Agent 时，当前业务边界只保留会话、正文、媒体和 context token", async () => {
  let received: ChatRequest | undefined;
  const agent: Agent = {
    async chat(request) {
      received = request;
      return {};
    },
  };

  await processOneMessage(inboundText("原始用户文本"), {
    accountId: "account-1",
    agent,
    baseUrl: "http://127.0.0.1:1",
    cdnBaseUrl: "http://127.0.0.1:1",
    log: silentLog,
    errLog: silentLog,
  });

  assert.equal(received?.conversationId, "wx-user-1");
  assert.equal(received?.text, "原始用户文本");
  assert.equal(received?.contextToken, "context-token-1");
  assert.equal(received?.media, undefined);
  assert.equal("messageId" in (received as unknown as Record<string, unknown>), false);
  assert.equal("occurredAt" in (received as unknown as Record<string, unknown>), false);
  assert.equal("senderSnapshot" in (received as unknown as Record<string, unknown>), false);
});

test("用户发送 /clear 时，会清除对应会话、回复确认，并且不调用模型", async () => {
  const api = await startWeixinApi();
  let chatCalls = 0;
  const cleared: string[] = [];
  const agent: Agent = {
    async chat() {
      chatCalls += 1;
      return { text: "不应生成" };
    },
    clearSession(conversationId) {
      cleared.push(conversationId);
    },
  };

  try {
    await processOneMessage(inboundText("/clear"), {
      accountId: "account-1",
      agent,
      baseUrl: api.baseUrl,
      cdnBaseUrl: api.baseUrl,
      log: silentLog,
      errLog: silentLog,
    });

    assert.equal(chatCalls, 0);
    assert.deepEqual(cleared, ["wx-user-1"]);
    assert.equal(api.requests.length, 1);
    assert.equal(api.requests[0]?.path, "/ilink/bot/sendmessage");
    const message = api.requests[0]?.body.msg as {
      item_list?: Array<{ text_item?: { text?: string } }>;
    };
    assert.equal(message.item_list?.[0]?.text_item?.text, "✅ 会话已清除，重新开始对话");
  } finally {
    await api.close();
  }
});

test("ledger /clear 严格等待 invokeClear 成功后才发送确认", async () => {
  const api = await startWeixinApi();
  let releaseClear!: () => void;
  const clearGate = new Promise<void>((resolve) => {
    releaseClear = resolve;
  });
  const invoked: Array<[string, string]> = [];
  const lifecycle: WeixinIngressLifecycle = {
    async accept() {
      return { receiptId: "event-1", disposition: "process" };
    },
    async invokeAgent() {
      throw new Error("model must not run");
    },
    async invokeClear({ receiptId, conversationId }) {
      invoked.push([receiptId, conversationId]);
      await clearGate;
    },
    async settle() {},
  };
  const processing = processOneMessage(inboundText("/clear"), {
    accountId: "account-1",
    agent: {
      async chat() {
        throw new Error("legacy model must not run");
      },
    },
    baseUrl: api.baseUrl,
    cdnBaseUrl: api.baseUrl,
    log: silentLog,
    errLog: silentLog,
    ingressLifecycle: lifecycle,
    receiptId: "event-1",
  });
  try {
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(invoked, [["event-1", "wx-user-1"]]);
    assert.equal(api.requests.length, 0);
    releaseClear();
    assert.equal(await processing, "command");
    assert.equal(api.requests.length, 1);
  } finally {
    releaseClear();
    await processing.catch(() => undefined);
    await api.close();
  }
});

test("/echo and /toggle-debug never invoke the clear lifecycle", async () => {
  const api = await startWeixinApi();
  let clearCalls = 0;
  const lifecycle: WeixinIngressLifecycle = {
    async accept() {
      return { receiptId: "event-1", disposition: "process" };
    },
    async invokeAgent() {
      throw new Error("model must not run");
    },
    async invokeClear() {
      clearCalls += 1;
    },
    async settle() {},
  };
  try {
    for (const command of ["/echo hello", "/toggle-debug"]) {
      assert.equal(
        await processOneMessage(inboundText(command), {
          accountId: "account-no-clear",
          agent: {
            async chat() {
              throw new Error("legacy model must not run");
            },
          },
          baseUrl: api.baseUrl,
          cdnBaseUrl: api.baseUrl,
          log: silentLog,
          errLog: silentLog,
          ingressLifecycle: lifecycle,
          receiptId: "event-1",
        }),
        "command",
      );
    }
    assert.equal(clearCalls, 0);
  } finally {
    await api.close();
  }
});

test("Agent 已生成回答但微信投递失败时，当前流程仍结束且没有送达确认回到 Agent", async () => {
  const api = await startWeixinApi({ status: 503 });
  const generatedReplies: string[] = [];
  const agent: Agent = {
    async chat() {
      const text = "这条回答已经由 Agent 生成";
      generatedReplies.push(text);
      return { text };
    },
  };

  try {
    await processOneMessage(inboundText("你好"), {
      accountId: "account-1",
      agent,
      baseUrl: api.baseUrl,
      cdnBaseUrl: api.baseUrl,
      log: silentLog,
      errLog: silentLog,
    });

    assert.deepEqual(generatedReplies, ["这条回答已经由 Agent 生成"]);
    assert.ok(api.requests.length >= 1);
    assert.equal(api.requests[0]?.path, "/ilink/bot/sendmessage");
    const firstMessage = api.requests[0]?.body.msg as {
      item_list?: Array<{ text_item?: { text?: string } }>;
    };
    assert.equal(firstMessage.item_list?.[0]?.text_item?.text, "这条回答已经由 Agent 生成");
  } finally {
    await api.close();
  }
});
