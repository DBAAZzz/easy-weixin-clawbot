import { z } from "zod";
import { cloneJsonValue, isJsonValue, type JsonValue } from "./json-value.js";

export type { JsonValue } from "./json-value.js";

/** 当前代码能够直接校验和读取的事实账本契约版本。 */
export const FACT_LEDGER_SCHEMA_VERSION = 1 as const;

/**
 * 外部会话世界中已经发生的事实。
 *
 * 这里只描述用户、平台和已送达消息，不记录 Prompt、Tape、模型推理或工具执行过程。
 */
export const CONVERSATION_EVENT_TYPE = {
  INBOUND_MESSAGE_RECEIVED: "inbound_message_received",
  INBOUND_MESSAGE_EDITED: "inbound_message_edited",
  INBOUND_MESSAGE_DELETED: "inbound_message_deleted",
  SESSION_STARTED: "session_started",
  SESSION_ROTATED: "session_rotated",
  OUTBOUND_MESSAGE_DELIVERED: "outbound_message_delivered",
  OUTBOUND_MESSAGE_DELIVERY_FAILED: "outbound_message_delivery_failed",
  REACTION_RECEIVED: "reaction_received",
  REACTION_DELIVERED: "reaction_delivered",
} as const;

/**
 * 一次 Agent run 内部发生的执行事实。
 *
 * 这些事件用于解释 Agent 为什么以及如何得到结果，但不会自动成为用户可见的会话消息。
 */
export const AGENT_RUN_EVENT_TYPE = {
  RUN_STARTED: "run_started",
  CONTEXT_COMPILED: "context_compiled",
  MODEL_CALL_STARTED: "model_call_started",
  MODEL_CALL_COMPLETED: "model_call_completed",
  MODEL_CALL_FAILED: "model_call_failed",
  TOOL_CALL_REQUESTED: "tool_call_requested",
  TOOL_CALL_COMPLETED: "tool_call_completed",
  TOOL_CALL_FAILED: "tool_call_failed",
  SKILL_LOADED: "skill_loaded",
  RUN_INTERRUPTED: "run_interrupted",
  RUN_COMPLETED: "run_completed",
  DELIVERY_REQUESTED: "delivery_requested",
  DELIVERY_SUCCEEDED: "delivery_succeeded",
  DELIVERY_FAILED: "delivery_failed",
} as const;

/**
 * Agent 对用户或会话形成、修正和撤回的记忆断言。
 *
 * Memory Event 表示“Agent 当前相信什么”，不等同于客观的外部会话事实。
 */
export const MEMORY_EVENT_TYPE = {
  MEMORY_ASSERTED: "memory_asserted",
  MEMORY_SUPERSEDED: "memory_superseded",
  MEMORY_RETRACTED: "memory_retracted",
  MEMORY_CORRECTED_BY_USER: "memory_corrected_by_user",
  MEMORY_ANCHOR_CREATED: "memory_anchor_created",
} as const;

/**
 * 需要按内容寻址并保持历史版本不变的制品种类。
 *
 * Secret 不属于制品内容；历史只保存脱敏配置身份或 revision 引用。
 */
export const ARTIFACT_KIND = {
  MEDIA_ASSET: "media_asset",
  VISUAL_OBSERVATION: "visual_observation",
  PROMPT_REVISION: "prompt_revision",
  SKILL_REVISION: "skill_revision",
  TOOL_REVISION: "tool_revision",
  MODEL_CONFIG_REVISION: "model_config_revision",
  CONTEXT_MANIFEST: "context_manifest",
  CANONICAL_REQUEST: "canonical_request",
  PROVIDER_REQUEST: "provider_request",
  MODEL_RESPONSE: "model_response",
  SUMMARY: "summary",
  TOOL_ARGUMENTS: "tool_arguments",
  TOOL_RESULT: "tool_result",
  MEMORY_SNAPSHOT: "memory_snapshot",
} as const;

const idSchema = z.string().trim().min(1);
const timestampSchema = z.string().datetime({ offset: true });

export const jsonValueSchema = z
  .custom<JsonValue>(isJsonValue, {
    message: "value must be finite, plain, acyclic I-JSON without lossy properties",
  })
  .transform(cloneJsonValue);
const metadataSchema = z.record(z.string(), jsonValueSchema);
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

/**
 * 事件 actor 记录行为主体，不承担用户资料的当前态查询。
 *
 * 用户和 Agent 产生的事实必须固定主体 ID；只有系统行为允许省略 ID。
 */
const actorSchema = z
  .object({
    kind: z.enum(["user", "agent", "system"]),
    id: idSchema.optional(),
  })
  .strict()
  .superRefine((actor, ctx) => {
    if (actor.kind !== "system" && !actor.id) {
      ctx.addIssue({
        code: "custom",
        path: ["id"],
        message: "user and agent actors require an id",
      });
    }
  });

const senderSnapshotSchema = z
  .object({
    id: idSchema,
    displayName: z.string().optional(),
  })
  .strict();

/**
 * 渠道拥有 `schemaId` 对应的数据契约；核心只保证信封版本明确且 `data` 可作为 JSON 持久化。
 * Context Compiler、Memory Extractor 和模型请求构建不得读取该审计字段。
 */
const channelMetadataSchema = z
  .object({
    schemaId: idSchema,
    schemaVersion: z.number().int().positive(),
    data: z.record(z.string(), jsonValueSchema),
  })
  .strict();

/**
 * Conversation Event 的公共信封。
 *
 * `occurredAt` 是平台发生时间，`receivedAt` 是本地接收时间，`recordedAt` 是事实提交时间；
 * 流内权威顺序只由数据库分配的 `streamSeq` 决定。
 */
const conversationEnvelopeSchema = z
  .object({
    eventId: idSchema,
    accountId: idSchema,
    streamId: idSchema,
    streamSeq: z.number().int().positive(),
    schemaVersion: z.literal(FACT_LEDGER_SCHEMA_VERSION),
    occurredAt: timestampSchema,
    receivedAt: timestampSchema,
    recordedAt: timestampSchema,
    actor: actorSchema,
    causationId: idSchema.optional(),
    correlationId: idSchema.optional(),
    idempotencyKey: idSchema.optional(),
  })
  .strict();

/**
 * 入站消息只允许保存平台原始内容及来源信息。
 *
 * `text` 必须保持用户原文；Tape、当前时间、视觉观察和 provider message 必须在其他边界保存。
 */
const inboundMessageReceivedPayloadSchema = z
  .object({
    channel: idSchema,
    channelMessageId: idSchema.optional(),
    senderSnapshot: senderSnapshotSchema.optional(),
    text: z.string(),
    attachmentRefs: z.array(idSchema),
    replyToEventId: idSchema.optional(),
    channelMetadata: channelMetadataSchema.optional(),
  })
  .strict();

const inboundMessageEditedPayloadSchema = z
  .object({
    targetEventId: idSchema,
    text: z.string(),
    attachmentRefs: z.array(idSchema),
  })
  .strict();

const inboundMessageDeletedPayloadSchema = z
  .object({
    targetEventId: idSchema,
    reason: z.string().optional(),
  })
  .strict();

const sessionStartedPayloadSchema = z
  .object({
    channel: idSchema,
    channelConversationId: idSchema,
  })
  .strict();

const sessionRotatedPayloadSchema = z
  .object({
    /** Compatibility-only history field; consumers use the boundary event's streamSeq. */
    previousStreamId: idSchema,
    reason: z.string(),
  })
  .strict();

const outboundMessageDeliveredPayloadSchema = z
  .object({
    deliveryId: idSchema,
    channel: idSchema,
    channelMessageId: idSchema.optional(),
    text: z.string(),
    attachmentRefs: z.array(idSchema),
  })
  .strict();

/**
 * 平台明确返回失败时才进入 Conversation Event。
 *
 * 每次投递尝试始终先写 Run Fact；本事件只补充外部平台事实，Projection 不得把它当作已送达消息。
 */
const outboundMessageDeliveryFailedPayloadSchema = z
  .object({
    deliveryId: idSchema,
    channel: idSchema,
    reason: z.string(),
    retryable: z.boolean(),
  })
  .strict();

const reactionPayloadSchema = z
  .object({
    targetEventId: idSchema,
    reaction: z.string(),
  })
  .strict();

/**
 * Conversation Event v1 的严格判别联合。
 *
 * 每种事件只接受对应 payload，额外字段会被拒绝，从契约层阻止运行时派生内容污染会话事实。
 */
export const conversationEventSchema = z.discriminatedUnion("eventType", [
  conversationEnvelopeSchema.extend({
    eventType: z.literal(CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_RECEIVED),
    payload: inboundMessageReceivedPayloadSchema,
  }),
  conversationEnvelopeSchema.extend({
    eventType: z.literal(CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_EDITED),
    payload: inboundMessageEditedPayloadSchema,
  }),
  conversationEnvelopeSchema.extend({
    eventType: z.literal(CONVERSATION_EVENT_TYPE.INBOUND_MESSAGE_DELETED),
    payload: inboundMessageDeletedPayloadSchema,
  }),
  conversationEnvelopeSchema.extend({
    eventType: z.literal(CONVERSATION_EVENT_TYPE.SESSION_STARTED),
    payload: sessionStartedPayloadSchema,
  }),
  conversationEnvelopeSchema.extend({
    eventType: z.literal(CONVERSATION_EVENT_TYPE.SESSION_ROTATED),
    payload: sessionRotatedPayloadSchema,
  }),
  conversationEnvelopeSchema.extend({
    eventType: z.literal(CONVERSATION_EVENT_TYPE.OUTBOUND_MESSAGE_DELIVERED),
    payload: outboundMessageDeliveredPayloadSchema,
  }),
  conversationEnvelopeSchema.extend({
    eventType: z.literal(CONVERSATION_EVENT_TYPE.OUTBOUND_MESSAGE_DELIVERY_FAILED),
    payload: outboundMessageDeliveryFailedPayloadSchema,
  }),
  conversationEnvelopeSchema.extend({
    eventType: z.literal(CONVERSATION_EVENT_TYPE.REACTION_RECEIVED),
    payload: reactionPayloadSchema,
  }),
  conversationEnvelopeSchema.extend({
    eventType: z.literal(CONVERSATION_EVENT_TYPE.REACTION_DELIVERED),
    payload: reactionPayloadSchema,
  }),
]);

/**
 * Agent Run Event 的公共信封。
 *
 * `runSeq` 只在同一个 run 内排序；`causationId` 与 `correlationId` 用于连接触发事件、工具、模型和投递链路。
 */
const runEnvelopeSchema = z
  .object({
    eventId: idSchema,
    runId: idSchema,
    runSeq: z.number().int().positive(),
    accountId: idSchema,
    conversationStreamId: idSchema,
    schemaVersion: z.literal(FACT_LEDGER_SCHEMA_VERSION),
    occurredAt: timestampSchema,
    recordedAt: timestampSchema,
    causationId: idSchema.optional(),
    correlationId: idSchema.optional(),
  })
  .strict();

const runStartedPayloadSchema = z
  .object({
    runKind: z.enum(["chat", "scheduler", "heartbeat"]),
    triggerEventId: idSchema.optional(),
    /** Phase 6：trigger run 发起时执行流的最后 streamSeq（trigger entry 排序锚点）。 */
    anchorStreamSeq: z.number().int().nonnegative().optional(),
  })
  .strict();

const contextCompiledPayloadSchema = z.object({ manifestId: idSchema }).strict();

const modelCallStartedPayloadSchema = z
  .object({
    callId: idSchema,
    round: z.number().int().positive(),
    manifestId: idSchema,
    /** Phase 4: content-addressed CANONICAL_REQUEST artifact for this exact call input. */
    requestArtifactId: idSchema.optional(),
  })
  .strict();

const modelCallCompletedPayloadSchema = z
  .object({
    callId: idSchema,
    responseArtifactId: idSchema,
    stopReason: z.string(),
  })
  .strict();

const modelCallFailedPayloadSchema = z
  .object({
    callId: idSchema,
    error: z.string(),
  })
  .strict();

const toolCallRequestedPayloadSchema = z
  .object({
    toolCallId: idSchema,
    toolName: idSchema,
    toolRevisionId: idSchema,
    argumentsArtifactId: idSchema,
  })
  .strict();

const toolCallCompletedPayloadSchema = z
  .object({
    toolCallId: idSchema,
    resultArtifactId: idSchema,
  })
  .strict();

const toolCallFailedPayloadSchema = z
  .object({
    toolCallId: idSchema,
    error: z.string(),
    errorArtifactId: idSchema.optional(),
  })
  .strict();

/**
 * v1 的 `skill_loaded` 专指 `use_skill` 触发的渐进式披露。
 *
 * Always-on 和显式配置技能由 Context Manifest 的 revision 列表表达，不产生本事件。
 */
const skillLoadedPayloadSchema = z
  .object({
    skillName: idSchema,
    skillRevisionId: idSchema,
    round: z.number().int().positive(),
    causationToolCallId: idSchema,
  })
  .strict();

const runInterruptedPayloadSchema = z.object({ reason: z.string() }).strict();

const runCompletedPayloadSchema = z
  .object({
    rounds: z.number().int().nonnegative(),
    finalResponseArtifactId: idSchema.optional(),
  })
  .strict();

const deliveryRequestedPayloadSchema = z
  .object({
    deliveryId: idSchema,
    responseArtifactId: idSchema,
  })
  .strict();

const deliverySucceededPayloadSchema = z
  .object({
    deliveryId: idSchema,
    channelMessageId: idSchema.optional(),
  })
  .strict();

const deliveryFailedPayloadSchema = z
  .object({
    deliveryId: idSchema,
    error: z.string(),
    retryable: z.boolean(),
  })
  .strict();

/**
 * Agent Run Event v1 的严格判别联合。
 *
 * `delivery_succeeded` 和 `delivery_failed` 记录投递过程；只有成功事件才能进一步产生已送达会话事实。
 */
export const agentRunEventSchema = z.discriminatedUnion("eventType", [
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.RUN_STARTED),
    payload: runStartedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.CONTEXT_COMPILED),
    payload: contextCompiledPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.MODEL_CALL_STARTED),
    payload: modelCallStartedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.MODEL_CALL_COMPLETED),
    payload: modelCallCompletedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.MODEL_CALL_FAILED),
    payload: modelCallFailedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.TOOL_CALL_REQUESTED),
    payload: toolCallRequestedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.TOOL_CALL_COMPLETED),
    payload: toolCallCompletedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.TOOL_CALL_FAILED),
    payload: toolCallFailedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.SKILL_LOADED),
    payload: skillLoadedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.RUN_INTERRUPTED),
    payload: runInterruptedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.RUN_COMPLETED),
    payload: runCompletedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.DELIVERY_REQUESTED),
    payload: deliveryRequestedPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.DELIVERY_SUCCEEDED),
    payload: deliverySucceededPayloadSchema,
  }),
  runEnvelopeSchema.extend({
    eventType: z.literal(AGENT_RUN_EVENT_TYPE.DELIVERY_FAILED),
    payload: deliveryFailedPayloadSchema,
  }),
]);

/**
 * Memory Event 的公共信封。
 *
 * `memorySeq` 是分支内的权威顺序，便于按 watermark 重建某一时刻的 Memory Projection。
 */
const memoryEnvelopeSchema = z
  .object({
    eventId: idSchema,
    accountId: idSchema,
    branch: idSchema,
    memorySeq: z.number().int().positive(),
    schemaVersion: z.literal(FACT_LEDGER_SCHEMA_VERSION),
    occurredAt: timestampSchema,
    recordedAt: timestampSchema,
    actor: actorSchema,
    causationId: idSchema.optional(),
    correlationId: idSchema.optional(),
  })
  .strict();

/**
 * 一条可审计的记忆断言。
 *
 * 来源会话事件不能为空；由模型抽取时还应固定抽取模型和 Prompt revision。
 */
const memoryAssertionSchema = z
  .object({
    category: z.enum(["fact", "preference", "decision"]),
    scope: z.enum(["global", "session"]),
    key: idSchema,
    value: jsonValueSchema,
    confidence: z.number().min(0).max(1),
    sourceConversationEventIds: z.array(idSchema).min(1),
    sourceRunId: idSchema.optional(),
    extractionModelRevisionId: idSchema.optional(),
    extractionPromptRevisionId: idSchema.optional(),
  })
  .strict()
  .superRefine((assertion, ctx) => {
    const hasModelRevision = assertion.extractionModelRevisionId !== undefined;
    const hasPromptRevision = assertion.extractionPromptRevisionId !== undefined;

    if (hasModelRevision !== hasPromptRevision) {
      ctx.addIssue({
        code: "custom",
        path: hasModelRevision ? ["extractionPromptRevisionId"] : ["extractionModelRevisionId"],
        message: "extraction model and prompt revisions must be provided together",
      });
    }

    if (hasModelRevision && !assertion.sourceRunId) {
      ctx.addIssue({
        code: "custom",
        path: ["sourceRunId"],
        message: "model-extracted memory requires a source run id",
      });
    }
  });

const memorySupersededPayloadSchema = z
  .object({
    targetMemoryEventId: idSchema,
    replacementMemoryEventId: idSchema,
    reason: z.string(),
  })
  .strict();

const memoryRetractedPayloadSchema = z
  .object({
    targetMemoryEventId: idSchema,
    reason: z.string(),
  })
  .strict();

const memoryCorrectedByUserPayloadSchema = z
  .object({
    targetMemoryEventId: idSchema,
    sourceConversationEventId: idSchema,
    replacement: memoryAssertionSchema,
  })
  .strict();

const memoryAnchorCreatedPayloadSchema = z
  .object({
    snapshotArtifactId: idSchema,
    throughMemorySeq: z.number().int().nonnegative(),
  })
  .strict();

/**
 * Memory Event v1 的严格判别联合。
 *
 * 用户纠正、撤回和 supersede 都追加新事件，不通过覆盖旧断言修改历史。
 */
export const memoryEventSchema = z.discriminatedUnion("eventType", [
  memoryEnvelopeSchema.extend({
    eventType: z.literal(MEMORY_EVENT_TYPE.MEMORY_ASSERTED),
    payload: memoryAssertionSchema,
  }),
  memoryEnvelopeSchema.extend({
    eventType: z.literal(MEMORY_EVENT_TYPE.MEMORY_SUPERSEDED),
    payload: memorySupersededPayloadSchema,
  }),
  memoryEnvelopeSchema.extend({
    eventType: z.literal(MEMORY_EVENT_TYPE.MEMORY_RETRACTED),
    payload: memoryRetractedPayloadSchema,
  }),
  memoryEnvelopeSchema.extend({
    eventType: z.literal(MEMORY_EVENT_TYPE.MEMORY_CORRECTED_BY_USER),
    payload: memoryCorrectedByUserPayloadSchema,
  }),
  memoryEnvelopeSchema.extend({
    eventType: z.literal(MEMORY_EVENT_TYPE.MEMORY_ANCHOR_CREATED),
    payload: memoryAnchorCreatedPayloadSchema,
  }),
]);

/**
 * 一次模型调用所使用输入的可验证清单。
 *
 * 历史重放必须复用原清单；反事实重编译必须创建新清单，不能修改旧 revision 或动态值。
 */
export const contextManifestSchema = z
  .object({
    schemaVersion: z.literal(FACT_LEDGER_SCHEMA_VERSION),
    manifestId: idSchema,
    compilerVersion: idSchema,
    contextPolicyRevisionId: idSchema,
    conversationEventIds: z.array(idSchema),
    runEventIds: z.array(idSchema),
    summaryArtifactIds: z.array(idSchema),
    memoryEventWatermark: idSchema,
    memoryArtifactId: idSchema.optional(),
    visualObservationIds: z.array(idSchema),
    modelRevisionId: idSchema,
    promptRevisionId: idSchema,
    skillRevisionIds: z.array(idSchema),
    toolRevisionIds: z.array(idSchema),
    effectiveTime: timestampSchema,
    timezone: idSchema,
    trimDecision: metadataSchema,
    canonicalRequestHash: sha256Schema,
    providerRequestArtifactId: idSchema.optional(),
  })
  .strict();

const storageRefSchema = z
  .object({
    provider: idSchema,
    key: idSchema,
  })
  .strict();

/**
 * 不可变制品的内容寻址记录。
 *
 * 这里的 `schemaVersion` 表示该种制品自身的内容版本，不要求等于事实账本契约版本。
 * 小制品内联保存，大制品使用外部存储引用，两种位置必须且只能选择一种。
 */
function validateArtifactLocation(
  artifact: { inlineJson?: unknown; storageRef?: unknown },
  ctx: z.RefinementCtx,
): void {
  const hasInline = artifact.inlineJson !== undefined;
  const hasStorage = artifact.storageRef !== undefined;
  if (hasInline === hasStorage) {
    ctx.addIssue({
      code: "custom",
      message: "exactly one of inlineJson or storageRef is required",
    });
  }
}

const artifactRevisionBaseSchema = z
  .object({
    artifactId: idSchema,
    kind: z.enum(Object.values(ARTIFACT_KIND)),
    sha256: sha256Schema,
    schemaVersion: z.number().int().positive(),
    inlineJson: jsonValueSchema.optional(),
    storageRef: storageRefSchema.optional(),
    createdAt: timestampSchema,
    encryptionMetadata: metadataSchema.optional(),
  })
  .strict();

export const artifactRevisionSchema =
  artifactRevisionBaseSchema.superRefine(validateArtifactLocation);

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** 解析一个可持久化的 JSON 值。 */
export function parseJsonValue(input: unknown): JsonValue {
  return jsonValueSchema.parse(input);
}

/** 渠道适配器校验并构造、核心仅按 opaque 审计数据保存的版本化信封。 */
export type ChannelMetadata = z.infer<typeof channelMetadataSchema>;

/** 已通过 Conversation Event v1 契约校验的外部会话事实。 */
export type ConversationEvent = z.infer<typeof conversationEventSchema>;

/** 已通过 Agent Run Event v1 契约校验的执行事实。 */
export type AgentRunEvent = z.infer<typeof agentRunEventSchema>;

/** 已通过 Memory Event v1 契约校验的记忆事实。 */
export type MemoryEvent = z.infer<typeof memoryEventSchema>;

/** 已通过 v1 契约校验的模型输入清单。 */
export type ContextManifest = z.infer<typeof contextManifestSchema>;

/** 已通过制品契约校验的不可变 revision。 */
export type ArtifactRevision = z.infer<typeof artifactRevisionSchema>;

/** Artifact kind 的领域联合类型。 */
export type ArtifactKind = (typeof ARTIFACT_KIND)[keyof typeof ARTIFACT_KIND];

export type AppendConversationEventInput = DistributiveOmit<
  ConversationEvent,
  "streamSeq" | "recordedAt"
>;
export type AppendAgentRunEventInput = DistributiveOmit<AgentRunEvent, "runSeq" | "recordedAt">;
export type AppendMemoryEventInput = DistributiveOmit<MemoryEvent, "memorySeq" | "recordedAt">;
export type PutArtifactRevisionInput = Omit<ArtifactRevision, "createdAt">;

export interface AppendResult<T> {
  value: T;
  appended: boolean;
}

const appendConversationEventOptions = conversationEventSchema.options.map((schema) =>
  schema.omit({ streamSeq: true, recordedAt: true }),
);
const appendAgentRunEventOptions = agentRunEventSchema.options.map((schema) =>
  schema.omit({ runSeq: true, recordedAt: true }),
);
const appendMemoryEventOptions = memoryEventSchema.options.map((schema) =>
  schema.omit({ memorySeq: true, recordedAt: true }),
);

export const appendConversationEventInputSchema = z.union(
  appendConversationEventOptions as [
    (typeof appendConversationEventOptions)[number],
    (typeof appendConversationEventOptions)[number],
    ...(typeof appendConversationEventOptions)[number][],
  ],
) as unknown as z.ZodType<AppendConversationEventInput>;
export const appendAgentRunEventInputSchema = z.union(
  appendAgentRunEventOptions as [
    (typeof appendAgentRunEventOptions)[number],
    (typeof appendAgentRunEventOptions)[number],
    ...(typeof appendAgentRunEventOptions)[number][],
  ],
) as unknown as z.ZodType<AppendAgentRunEventInput>;
export const appendMemoryEventInputSchema = z.union(
  appendMemoryEventOptions as [
    (typeof appendMemoryEventOptions)[number],
    (typeof appendMemoryEventOptions)[number],
    ...(typeof appendMemoryEventOptions)[number][],
  ],
) as unknown as z.ZodType<AppendMemoryEventInput>;
export const putArtifactRevisionInputSchema = artifactRevisionBaseSchema
  .omit({ createdAt: true })
  .superRefine(validateArtifactLocation);

/** 调用方尝试按当前代码读取未知事实账本版本时抛出的错误。 */
export class UnsupportedFactLedgerSchemaVersionError extends Error {
  constructor(readonly schemaVersion: unknown) {
    super(`Unsupported fact ledger schema version: ${String(schemaVersion)}`);
    this.name = "UnsupportedFactLedgerSchemaVersionError";
  }
}

function assertCurrentSchemaVersion(input: unknown): void {
  const schemaVersion =
    input && typeof input === "object" && "schemaVersion" in input
      ? (input as { schemaVersion?: unknown }).schemaVersion
      : undefined;
  if (schemaVersion !== FACT_LEDGER_SCHEMA_VERSION) {
    throw new UnsupportedFactLedgerSchemaVersionError(schemaVersion);
  }
}

/**
 * 校验尚未由 Store 分配顺序和记录时间的 Conversation Event。
 */
export function parseAppendConversationEventInput(input: unknown): AppendConversationEventInput {
  assertCurrentSchemaVersion(input);
  return appendConversationEventInputSchema.parse(input);
}

/** 校验尚未由 Store 分配顺序和记录时间的 Agent Run Event。 */
export function parseAppendAgentRunEventInput(input: unknown): AppendAgentRunEventInput {
  assertCurrentSchemaVersion(input);
  return appendAgentRunEventInputSchema.parse(input);
}

/** 校验尚未由 Store 分配顺序和记录时间的 Memory Event。 */
export function parseAppendMemoryEventInput(input: unknown): AppendMemoryEventInput {
  assertCurrentSchemaVersion(input);
  return appendMemoryEventInputSchema.parse(input);
}

/** 校验尚未由 Store 分配创建时间的 Artifact revision。 */
export function parsePutArtifactRevisionInput(input: unknown): PutArtifactRevisionInput {
  return putArtifactRevisionInputSchema.parse(input);
}

/**
 * 解析并校验 Conversation Event v1。
 *
 * 未知版本抛出 `UnsupportedFactLedgerSchemaVersionError`；当前版本字段不合法时抛出 Zod 校验错误。
 */
export function parseConversationEvent(input: unknown): ConversationEvent {
  assertCurrentSchemaVersion(input);
  return conversationEventSchema.parse(input);
}

/**
 * 解析并校验 Agent Run Event v1。
 *
 * 未知版本抛出 `UnsupportedFactLedgerSchemaVersionError`；当前版本字段不合法时抛出 Zod 校验错误。
 */
export function parseAgentRunEvent(input: unknown): AgentRunEvent {
  assertCurrentSchemaVersion(input);
  return agentRunEventSchema.parse(input);
}

/**
 * 解析并校验 Memory Event v1。
 *
 * 未知版本抛出 `UnsupportedFactLedgerSchemaVersionError`；当前版本字段不合法时抛出 Zod 校验错误。
 */
export function parseMemoryEvent(input: unknown): MemoryEvent {
  assertCurrentSchemaVersion(input);
  return memoryEventSchema.parse(input);
}

/**
 * 解析并校验 Context Manifest v1。
 *
 * 未知版本抛出 `UnsupportedFactLedgerSchemaVersionError`；当前版本字段不合法时抛出 Zod 校验错误。
 */
export function parseContextManifest(input: unknown): ContextManifest {
  assertCurrentSchemaVersion(input);
  return contextManifestSchema.parse(input);
}

/**
 * 解析并校验不可变 Artifact revision。
 *
 * Artifact 的 `schemaVersion` 属于制品内容本身，因此这里只校验其为正整数，不套用事实账本版本拒绝规则。
 */
export function parseArtifactRevision(input: unknown): ArtifactRevision {
  return artifactRevisionSchema.parse(input);
}
