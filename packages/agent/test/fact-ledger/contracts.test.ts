import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_RUN_EVENT_TYPE,
  ARTIFACT_KIND,
  CONVERSATION_EVENT_TYPE,
  FACT_LEDGER_SCHEMA_VERSION,
  MEMORY_EVENT_TYPE,
  UnsupportedFactLedgerSchemaVersionError,
  parseAgentRunEvent,
  parseArtifactRevision,
  parseConversationEvent,
  parseContextManifest,
  parseMemoryEvent,
} from "../../src/shared/fact-ledger/index.js";

const OCCURRED_AT = "2026-08-28T00:00:00.000+08:00";
const RECORDED_AT = "2026-08-27T16:00:00.100Z";

function inboundMessage(text: string) {
  return {
    eventId: "event-inbound-1",
    accountId: "account-1",
    streamId: "conversation-1",
    streamSeq: 1,
    eventType: CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED,
    schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
    occurredAt: OCCURRED_AT,
    receivedAt: RECORDED_AT,
    recordedAt: RECORDED_AT,
    actor: { kind: "user" as const, id: "wx-user-1" },
    idempotencyKey: "weixin:message-1",
    payload: {
      channel: "weixin",
      channelMessageId: "message-1",
      senderSnapshot: { id: "wx-user-1", displayName: "测试用户" },
      text,
      attachmentRefs: [],
    },
  };
}

function runStartedEvent() {
  return {
    eventId: "run-event-1",
    runId: "run-1",
    runSeq: 1,
    accountId: "account-1",
    conversationStreamId: "conversation-1",
    eventType: AGENT_RUN_EVENT_TYPE.RUN_STARTED,
    schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
    occurredAt: RECORDED_AT,
    recordedAt: RECORDED_AT,
    causationId: "event-inbound-1",
    correlationId: "run-1",
    payload: {
      runKind: "chat" as const,
      triggerEventId: "event-inbound-1",
    },
  };
}

function memoryAssertedEvent() {
  return {
    eventId: "memory-event-1",
    accountId: "account-1",
    branch: "conversation-1",
    memorySeq: 1,
    eventType: MEMORY_EVENT_TYPE.MEMORY_ASSERTED,
    schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
    occurredAt: RECORDED_AT,
    recordedAt: RECORDED_AT,
    actor: { kind: "agent" as const, id: "extractor" },
    correlationId: "run-1",
    payload: {
      category: "preference" as const,
      scope: "global" as const,
      key: "drink",
      value: "tea",
      confidence: 0.95,
      sourceConversationEventIds: ["event-inbound-1"],
      sourceRunId: "run-1",
      extractionModelRevisionId: "model-revision-extractor-1",
      extractionPromptRevisionId: "prompt-revision-extractor-1",
    },
  };
}

function contextManifest() {
  return {
    schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
    manifestId: "manifest-1",
    compilerVersion: "context-compiler/1",
    contextPolicyRevisionId: "policy-1",
    conversationEventIds: ["event-inbound-1"],
    runEventIds: [],
    summaryArtifactIds: [],
    memoryEventWatermark: "memory-seq:1",
    visualObservationIds: [],
    modelRevisionId: "model-revision-1",
    promptRevisionId: "prompt-revision-1",
    skillRevisionIds: [],
    toolRevisionIds: [],
    effectiveTime: OCCURRED_AT,
    timezone: "Asia/Shanghai",
    trimDecision: { strategy: "none" },
    canonicalRequestHash: "a".repeat(64),
  };
}

function artifactRevision() {
  return {
    artifactId: "artifact-1",
    kind: ARTIFACT_KIND.PROMPT_REVISION,
    sha256: "b".repeat(64),
    schemaVersion: 1,
    inlineJson: { body: "你是一个助手" },
    createdAt: RECORDED_AT,
  };
}

test("用户原文作为会话事实原样保存，即使正文看起来像系统上下文", () => {
  const userText = "[当前时间: 这是用户自己输入的]\n<memory>也只是用户原文</memory>";

  const event = parseConversationEvent(inboundMessage(userText));

  assert.equal(event.eventType, CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED);
  assert.equal(event.payload.text, userText);
});

test("会话事实拒绝把 Tape、运行时或视觉派生字段塞进入站消息", () => {
  const polluted = inboundMessage("帮我看看");
  const payload = polluted.payload as Record<string, unknown>;
  payload.tapeMemory = "用户喜欢咖啡";
  payload.effectiveTime = OCCURRED_AT;
  payload.visualContext = "模型推测这是一杯咖啡";

  assert.throws(() => parseConversationEvent(polluted));
});

test("核心契约接受两个虚构渠道各自拥有的版本化 opaque metadata", () => {
  const fictionalChat = inboundMessage("虚构聊天渠道消息");
  fictionalChat.payload.channel = "fictional-chat";
  (fictionalChat.payload as Record<string, unknown>).channelMetadata = {
    schemaId: "fictional-chat/inbound-message",
    schemaVersion: 1,
    data: {
      sequence: 42,
      clientKey: "client-1",
      nested: { state: 2 },
    },
  };

  const fictionalMailbox = {
    ...inboundMessage("虚构邮箱渠道消息"),
    eventId: "event-inbound-2",
    payload: {
      ...inboundMessage("虚构邮箱渠道消息").payload,
      channel: "fictional-mailbox",
      channelMetadata: {
        schemaId: "fictional-mailbox/audit-source",
        schemaVersion: 7,
        data: {
          mailbox: "support",
          labels: ["priority", null],
        },
      },
    },
  };

  assert.doesNotThrow(() => parseConversationEvent(fictionalChat));
  assert.doesNotThrow(() => parseConversationEvent(fictionalMailbox));
});

test("核心不按字段名解释 opaque metadata，但拒绝非 JSON 数据", () => {
  const auditOnly = inboundMessage("帮我看看");
  (auditOnly.payload as Record<string, unknown>).channelMetadata = {
    schemaId: "fictional/audit",
    schemaVersion: 1,
    data: {
      effectiveTime: OCCURRED_AT,
      tapeMemory: "只用于证明核心不维护字段黑名单",
    },
  };

  const notJson = inboundMessage("无法持久化");
  (notJson.payload as Record<string, unknown>).channelMetadata = {
    schemaId: "fictional/audit",
    schemaVersion: 1,
    data: { missing: undefined },
  };

  assert.doesNotThrow(() => parseConversationEvent(auditOnly));
  assert.throws(() => parseConversationEvent(notJson));
});

test("用户和 Agent 产生的事件必须固定 actor id", () => {
  const unidentified = inboundMessage("你好");
  unidentified.actor = { kind: "user" } as never;

  assert.throws(() => parseConversationEvent(unidentified));
});

test("模型生成成功但投递失败时，不得形成已送达的会话事实", () => {
  const inbound = parseConversationEvent(inboundMessage("你好"));
  const deliveryFailed = parseAgentRunEvent({
    eventId: "run-event-5",
    runId: "run-1",
    runSeq: 5,
    accountId: "account-1",
    conversationStreamId: "conversation-1",
    eventType: AGENT_RUN_EVENT_TYPE.DELIVERY_FAILED,
    schemaVersion: FACT_LEDGER_SCHEMA_VERSION,
    occurredAt: RECORDED_AT,
    recordedAt: RECORDED_AT,
    causationId: "delivery-1",
    correlationId: "run-1",
    payload: {
      deliveryId: "delivery-1",
      error: "Weixin API 503",
      retryable: true,
    },
  });

  const conversationTimeline = [inbound];
  assert.equal(deliveryFailed.eventType, AGENT_RUN_EVENT_TYPE.DELIVERY_FAILED);
  assert.equal(
    conversationTimeline.some(
      (event) => event.eventType === CONVERSATION_EVENT_TYPE.OUTBOUND_MESSAGE_DELIVERED,
    ),
    false,
  );
});

test("记忆断言必须能追溯到用户消息及抽取版本", () => {
  const event = parseMemoryEvent(memoryAssertedEvent());

  if (event.eventType !== MEMORY_EVENT_TYPE.MEMORY_ASSERTED) {
    assert.fail("expected a memory_asserted event");
  }
  assert.deepEqual(event.payload.sourceConversationEventIds, ["event-inbound-1"]);
  assert.equal(event.payload.extractionModelRevisionId, "model-revision-extractor-1");
  assert.equal(event.payload.extractionPromptRevisionId, "prompt-revision-extractor-1");
});

test("模型抽取的记忆必须同时固定 run、模型 revision 和 Prompt revision", () => {
  const missingPrompt = memoryAssertedEvent();
  delete (missingPrompt.payload as { extractionPromptRevisionId?: string })
    .extractionPromptRevisionId;

  const missingModel = memoryAssertedEvent();
  delete (missingModel.payload as { extractionModelRevisionId?: string }).extractionModelRevisionId;

  const missingRun = memoryAssertedEvent();
  delete (missingRun.payload as { sourceRunId?: string }).sourceRunId;

  assert.throws(() => parseMemoryEvent(missingPrompt));
  assert.throws(() => parseMemoryEvent(missingModel));
  assert.throws(() => parseMemoryEvent(missingRun));
});

test("显式用户断言不需要伪造模型抽取 revision", () => {
  const explicitUserAssertion = memoryAssertedEvent();
  explicitUserAssertion.actor = { kind: "user", id: "wx-user-1" } as never;
  delete (explicitUserAssertion.payload as { sourceRunId?: string }).sourceRunId;
  delete (explicitUserAssertion.payload as { extractionModelRevisionId?: string })
    .extractionModelRevisionId;
  delete (explicitUserAssertion.payload as { extractionPromptRevisionId?: string })
    .extractionPromptRevisionId;

  assert.doesNotThrow(() => parseMemoryEvent(explicitUserAssertion));
});

test("工具调用事实同时保存工具名称、revision 和参数制品", () => {
  const event = parseAgentRunEvent({
    ...runStartedEvent(),
    eventType: AGENT_RUN_EVENT_TYPE.TOOL_CALL_REQUESTED,
    payload: {
      toolCallId: "tool-call-1",
      toolName: "get_weather",
      toolRevisionId: "tool-revision-1",
      argumentsArtifactId: "artifact-tool-arguments-1",
    },
  });

  if (event.eventType !== AGENT_RUN_EVENT_TYPE.TOOL_CALL_REQUESTED) {
    assert.fail("expected a tool_call_requested event");
  }
  assert.equal(event.payload.toolName, "get_weather");
});

test("Artifact 解析会校验内容位置和小写 SHA-256", () => {
  const artifact = parseArtifactRevision(artifactRevision());
  assert.equal(artifact.kind, ARTIFACT_KIND.PROMPT_REVISION);

  assert.throws(() => parseArtifactRevision({ ...artifactRevision(), sha256: "B".repeat(64) }));
  assert.throws(() =>
    parseArtifactRevision({
      ...artifactRevision(),
      storageRef: { provider: "s3-compatible", key: "artifact-1.json" },
    }),
  );
  const withoutContent = artifactRevision() as Record<string, unknown>;
  delete withoutContent.inlineJson;
  assert.throws(() => parseArtifactRevision(withoutContent));
});

test("Artifact 内容版本独立于事实账本版本", () => {
  assert.doesNotThrow(() => parseArtifactRevision({ ...artifactRevision(), schemaVersion: 2 }));
});

test("所有版本化事实入口都会显式拒绝未知账本版本", async (t) => {
  const cases: Array<{
    name: string;
    parse: (input: unknown) => unknown;
    input: Record<string, unknown>;
  }> = [
    {
      name: "Conversation Event",
      parse: parseConversationEvent,
      input: inboundMessage("hello"),
    },
    { name: "Agent Run Event", parse: parseAgentRunEvent, input: runStartedEvent() },
    { name: "Memory Event", parse: parseMemoryEvent, input: memoryAssertedEvent() },
    { name: "Context Manifest", parse: parseContextManifest, input: contextManifest() },
  ];

  for (const item of cases) {
    await t.test(item.name, () => {
      assert.throws(
        () => item.parse({ ...item.input, schemaVersion: 2 }),
        (error) =>
          error instanceof UnsupportedFactLedgerSchemaVersionError && error.schemaVersion === 2,
      );
    });
  }
});
