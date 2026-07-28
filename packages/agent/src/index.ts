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

export type {
  ChatMedia,
  ChatResponse,
} from "./shared/types.js";

export type {
  AgentConfig,
  AgentRunner,
  ModelOverride,
  RunCallbacks,
  RunResult,
} from "./engine/runner.js";
export { createAgentRunner } from "./engine/runner.js";
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
export { createRuntimeProvisioner, readManagedMeta } from "./capabilities/skills/runtime-provisioner.js";
export type {
  RuntimeProvisioner,
  ProvisionPlan,
  ProvisionLog,
  ManagedMeta,
} from "./capabilities/skills/runtime-provisioner.js";
export type {
  ToolCatalogItem,
  ToolRegistry,
  ToolSnapshot,
} from "./capabilities/tools/types.js";
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

// ── Chat orchestration ──────────────────────────────────────────────
export { createChatEngine, type ChatEngine, type ChatLog } from "./engine/chat-engine.js";
export { type RunContext, toolContextFrom } from "./engine/context.js";

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

// ── Errors ──────────────────────────────────────────────────────────
export { AgentError, TimeoutError, ModelResolutionError, SkillProvisionError } from "./shared/errors.js";
