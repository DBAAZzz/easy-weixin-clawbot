// ── LLM adapter layer ───────────────────────────────────────────────
export type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TriggerMessage,
  TriggerMeta,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCallContent,
  ModelMeta,
  VisualContext,
  VisionFallbackReason,
  LanguageModel,
} from "./llm/types.js";
export { agentToModelMessages, legacyPayloadToAgentMessage } from "./llm/messages.js";
export { createLanguageModel } from "./llm/provider-factory.js";
export { modelSupportsVision } from "./llm/model-meta.js";
export type { ResolvedModel } from "./llm/model-resolver.js";
export {
  buildModelFromConfig,
  resolveConfiguredModel,
  resolveModel,
  invalidateModelCache,
  LLMProviderNotConfiguredError,
  isLLMProviderNotConfiguredError,
  LLM_PROVIDER_NOT_CONFIGURED_CODE,
  LLM_PROVIDER_NOT_CONFIGURED_MESSAGE,
  LLM_PROVIDER_NOT_CONFIGURED_USER_MESSAGE,
} from "./llm/model-resolver.js";

export type { ChatMedia, ChatResponse } from "./shared/types.js";

export type {
  AgentConfig,
  AgentRunner,
  ModelOverride,
  RunCallbacks,
  RunResult,
} from "./engine/runner.js";
export { createAgentRunner, buildRoundRequest, serializeMessage } from "./engine/runner.js";
export type { RunnerLedger, RoundRequestSnapshot } from "./engine/runner.js";
export type {
  SkillActivation,
  SkillCatalogItem,
  SkillDependency,
  SkillDependencyCheck,
  SkillRuntimeCheck,
  DependencyStatus,
  SkillInstaller,
  SkillInstallerResult,
  SkillRegistry,
  SkillSnapshot,
  SkillSource,
  SkillPackageIndex,
  SkillEntrypoint,
  SkillRuntime,
  DetectedSkillKind,
  DetectedSkillRuntime,
  SkillProvisionInstaller,
  ProvisionStatus,
  InstalledSkill,
} from "./capabilities/skills/types.js";
export { createSkillRegistry } from "./capabilities/skills/registry.js";
export { createSkillInstaller } from "./capabilities/skills/installer.js";
export { scanSkillPackage } from "./capabilities/skills/package-scanner.js";
export { analyzeScript } from "./capabilities/skills/script-analyzer.js";
export { detectSkillRuntime } from "./capabilities/skills/runtime-detector.js";
export { createSkillRuntimeToolSnapshot } from "./capabilities/skills/runtime-tools.js";
export { normalizeFrontmatter } from "./capabilities/skills/normalizer.js";
export type { NormalizeResult } from "./capabilities/skills/normalizer.js";
export {
  createRuntimeProvisioner,
  readManagedMeta,
} from "./capabilities/skills/runtime-provisioner.js";
export type {
  RuntimeProvisioner,
  ProvisionPlan,
  ProvisionLog,
  ManagedMeta,
} from "./capabilities/skills/runtime-provisioner.js";
export type { ToolCatalogItem, ToolRegistry, ToolSnapshot } from "./capabilities/tools/types.js";
export { createToolRegistry } from "./capabilities/tools/registry.js";
export { createCompositeToolRegistry } from "./capabilities/tools/composite-registry.js";
export {
  createBuiltinToolSnapshot,
  getBuiltinToolCatalogItem,
  listBuiltinToolCatalog,
} from "./capabilities/tools/builtins.js";
export type {
  McpRemoteTool,
  McpToolBinding,
  McpToolCallResult,
  StdioMcpClient,
  StdioMcpClientOptions,
} from "./capabilities/mcp/types.js";
export { createStdioMcpClient } from "./capabilities/mcp/stdio-client.js";
export { createMcpToolSnapshotItem } from "./capabilities/mcp/tool-adapter.js";

// ── Ports (dependency injection interfaces) ─────────────────────────
export {
  setConversationEventStore,
  getConversationEventStore,
  setAgentRunStore,
  getAgentRunStore,
  setMemoryEventStore,
  getMemoryEventStore,
  setArtifactRevisionStore,
  getArtifactRevisionStore,
  setMessageStore,
  getMessageStore,
  setUsageStore,
  getUsageStore,
  setTapeStore,
  getTapeStore,
  setSchedulerStore,
  getSchedulerStore,
  setScheduledTaskHandler,
  getScheduledTaskHandler,
  setPushService,
  getPushService,
  setModelConfigStore,
  getModelConfigStore,
  setHeartbeatStore,
  getHeartbeatStore,
  setChatExecutor,
  getChatExecutor,
  setWebToolService,
  getWebToolService,
} from "./ports/index.js";
export type {
  ConversationEventStore,
  ListConversationEventsInput,
  ContextCompilerShadowResultStore,
  ContextCompilerShadowResultRecord,
  ContextCompilerShadowResultDiffCounts,
  ContextCompilerShadowResultDiffCategory,
  AgentRunStore,
  ListAgentRunEventsInput,
  ListRunEventsByStreamInput,
  ArtifactContentSink,
  MemoryEventStore,
  ListMemoryEventsInput,
  MemoryAssertionCategory,
  ArtifactRevisionStore,
  ArtifactContentIdentity,
  MessageStore,
  RestoredHistory,
  PersistMessageParams,
  TapeStore,
  TapeEntryRow,
  TapeAnchorRow,
  SchedulerStore,
  ScheduledTaskRow,
  ScheduledTaskRunRow,
  ScheduledTaskHandlerPort,
  ScheduledTaskHandlerResult,
  ScheduledTaskExecutionContext,
  PushService,
  PushOptions,
  ModelConfigStore,
  ModelProviderTemplateRow,
  CreateModelProviderTemplateInput,
  UpdateModelProviderTemplateInput,
  ModelConfigRow,
  UpsertModelConfigInput,
  ModelPurpose,
  ModelScope,
  ModelVisionOverride,
  HeartbeatStore,
  ChatExecutorPort,
  ChatExecutionRequest,
  ChatExecutionResult,
  WebSearchResult,
  WebSearchRequest,
  WebSearchResponse,
  WebFetchRequest,
  WebFetchResponse,
  WebToolService,
} from "./ports/index.js";
export {
  CONTEXT_COMPILER_SHADOW_RESULT_DIFF_CATEGORIES,
  ContextCompilerShadowResultEquivalenceError,
} from "./ports/index.js";

// ── Context Compiler shadow v1 ────────────────────────────────────
export {
  CONTEXT_COMPILER_VERSION,
  CONTEXT_POLICY_REVISION_ID,
  CONTEXT_POLICY_REVISION_ID_V2,
  CONTEXT_POLICY_REVISION_ID_V3,
  CONTEXT_TIMEZONE,
  ContextCompilerError,
  CONTEXT_COMPILER_SHADOW_DIFF_CATEGORIES,
  createContextCompilerV1,
  reduceConversationEvents,
  reduceRunFacts,
  compareCanonicalEntries,
  extractArtifactText,
  extractRound1TriggerPrompt,
  buildTriggerSeqIndex,
  buildCanonicalRequestDocument,
  buildContextManifestDocument,
  hashCanonicalRequestDocument,
  unresolvedAttachmentArtifactResolver,
  buildCanonicalMemoryExtractionInput,
  hashCanonicalValue,
  emptyContextCompilerShadowDiffCounts,
} from "./context-compiler/index.js";
export type {
  CompileContextInputV1,
  ContextPolicyRevisionId,
  CanonicalAttachment,
  CanonicalConversationEntryV1,
  CanonicalContextV1,
  CompiledContextV1,
  ContextCompilerDiagnostic,
  ContextCompilerDiagnosticCode,
  ResolvedAttachmentArtifact,
  AttachmentArtifactResolver,
  ContextCompilerV1,
  CanonicalMemoryExtractionInputV1,
  ContextCompilerShadowDiffCategory,
  ContextCompilerShadowDiffCounts,
  ReduceRunFactsInput,
  RunFactReduction,
  CanonicalRequestDocumentV1,
  CanonicalRequestTrimV1,
  BuildContextManifestInput,
} from "./context-compiler/index.js";

// ── Run Ledger (Phase 4) ────────────────────────────────────────────
export {
  createRunLedgerRecorder,
  bootstrapRunLedger,
  readMemoryCoverage,
  readSummaryArtifactIds,
  putDocumentArtifact,
  createRunId,
  createTriggerRunId,
  createCallId,
  createDeliveryId,
  createManifestId,
  createRunEventId,
  createOutboundFactEventId,
  toStableErrorCode,
  INLINE_ARTIFACT_LIMIT_BYTES,
} from "./engine/run-ledger/index.js";
export type {
  RunLedgerRecorder,
  RunLedgerMetrics,
  RunLedgerRecorderOptions,
  RunStartInput,
  ArtifactPutResult,
  ArtifactPutterDeps,
} from "./engine/run-ledger/index.js";

// ── Tape (memory system) ────────────────────────────────────────────
export {
  emptyState,
  recall,
  compactIfNeeded,
  createHandoffAnchors,
  formatMemoryForPrompt,
  fireExtractAndRecord,
  queueRecordEntry,
  getPendingTapeWriteCount,
  deriveMemoryAssertionEventId,
  deriveMemorySupersededEventId,
  writeMemoryFactToLedger,
  lookupPreviousValue,
  branchForScope,
  buildSummaryDocument,
  putSummaryArtifact,
  appendMemoryAnchorCreated,
} from "./memory/index.js";
export type {
  TapeState,
  TapeFact,
  TapePreference,
  TapeDecision,
  RecordParams,
} from "./memory/index.js";

// ── Conversation (history management) ───────────────────────────────
export {
  createConversationCache,
  type ConversationCache,
  type ConversationCacheOptions,
  generateConversationTitle,
} from "./engine/conversation/index.js";

// ── Commands ────────────────────────────────────────────────────────
export { CommandRegistry } from "./commands/registry.js";
export { createBuiltinCommands } from "./commands/builtins.js";
export { createDebugFlags, type DebugFlags } from "./commands/debug.js";
export type { Command, CommandContext } from "./commands/types.js";

// ── Scheduler ───────────────────────────────────────────────────────
export {
  schedulerManager,
  schedulerToolRegistry,
  scheduleCommand,
  executeTask,
} from "./capabilities/scheduler/index.js";

// ── Heartbeat ───────────────────────────────────────────────────────
export {
  startHeartbeat,
  stopHeartbeat,
  runHeartbeatTick,
  notePulseActivity,
} from "./capabilities/heartbeat/index.js";
export type {
  PulseRow,
  PulseUpdate,
  PulseVerdict,
  PulseDecision,
} from "./capabilities/heartbeat/types.js";

// ── Proactive outbound facts (Phase 6) ─────────────────────────────
export { recordProactiveOutbound } from "./capabilities/outbound-facts.js";
export type { ProactiveOutboundInput } from "./capabilities/outbound-facts.js";

// ── Context build / read switch (Phase 6) ──────────────────────────
export {
  buildCanonicalHistory,
  CanonicalContextBuildError,
  canonicalMessagesHash,
  compareDualHistories,
  DEFAULT_MEDIA_REPLAY_LIMIT,
  loadLegacyContext,
} from "./engine/context-build/index.js";
export type {
  CanonicalHistoryBuild,
  CanonicalHistoryBuildDeps,
  ContextReadPath,
  DualComparison,
  DualDiffDimension,
} from "./engine/context-build/index.js";

// ── Chat orchestration ──────────────────────────────────────────────
export { createChatEngine, type ChatEngine, type ChatLog } from "./engine/chat-engine.js";
export { type ChatTurnInput } from "./engine/turn.js";
export { type RunContext, toolContextFrom } from "./engine/context.js";
export {
  createContextShadowObserver,
  normalizeLegacyContext,
  diffCanonicalAndLegacy,
} from "./engine/context-shadow/index.js";
export type {
  ContextShadowObserver,
  ContextShadowObserverMetrics,
  PendingContextShadowHandle,
  LegacyContextSummary,
  LegacyUserSummaryEntry,
  ContextShadowDiffResult,
} from "./engine/context-shadow/index.js";

// ── Prompt system ───────────────────────────────────────────────────
export type {
  PromptLane,
  PromptProfile,
  PromptAssets,
  PromptAssetSpec,
  LoadPromptAssetsOptions,
} from "./prompts/index.js";
export {
  PROMPT_PROFILES,
  PROMPT_ASSET_SPECS,
  loadPromptAssets,
  resolveBundledPromptsDir,
  validateTemplateVars,
  setPromptAssets,
  getPromptAssets,
} from "./prompts/index.js";
export { extractMediaFromText, resolveFilePath } from "./shared/media.js";

// ── Fact ledger v1 contracts ──────────────────────────────────────
export {
  FACT_LEDGER_SCHEMA_VERSION,
  CONVERSATION_EVENT_TYPE,
  AGENT_RUN_EVENT_TYPE,
  MEMORY_EVENT_TYPE,
  ARTIFACT_KIND,
  jsonValueSchema,
  conversationEventSchema,
  appendConversationEventInputSchema,
  appendAgentRunEventInputSchema,
  appendMemoryEventInputSchema,
  putArtifactRevisionInputSchema,
  agentRunEventSchema,
  memoryEventSchema,
  contextManifestSchema,
  artifactRevisionSchema,
  UnsupportedFactLedgerSchemaVersionError,
  parseJsonValue,
  parseAppendConversationEventInput,
  parseAppendAgentRunEventInput,
  parseAppendMemoryEventInput,
  parsePutArtifactRevisionInput,
  parseConversationEvent,
  parseAgentRunEvent,
  parseMemoryEvent,
  parseContextManifest,
  parseArtifactRevision,
  canonicalizeJson,
  sha256CanonicalJson,
  FactLedgerIdConflictError,
  FactLedgerIdempotencyConflictError,
  FactLedgerContentHashMismatchError,
  FactLedgerCorruptionError,
  FactLedgerSequenceOverflowError,
} from "./shared/fact-ledger/index.js";
export type {
  JsonValue,
  ArtifactKind,
  ChannelMetadata,
  AppendConversationEventInput,
  AppendAgentRunEventInput,
  AppendMemoryEventInput,
  PutArtifactRevisionInput,
  AppendResult,
  ConversationEvent,
  AgentRunEvent,
  MemoryEvent,
  ContextManifest,
  ArtifactRevision,
} from "./shared/fact-ledger/index.js";

// ── Errors ──────────────────────────────────────────────────────────
export {
  AgentError,
  TimeoutError,
  ModelResolutionError,
  SkillProvisionError,
} from "./shared/errors.js";
