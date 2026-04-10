// ── LLM adapter layer ───────────────────────────────────────────────
export type {
  AgentMessage,
  UserMessage,
  AssistantMessage,
  ToolResultMessage,
  TextContent,
  ImageContent,
  ThinkingContent,
  ToolCallContent,
  ModelMeta,
  LanguageModel,
} from "./llm/types.js";
export { agentToModelMessages, legacyPayloadToAgentMessage } from "./llm/messages.js";
export { createLanguageModel } from "./llm/provider-factory.js";

export type {
  AgentConfig,
  AgentRunner,
  ModelOverride,
  RunCallbacks,
  RunResult,
} from "./runner.js";
export { createAgentRunner } from "./runner.js";
export type {
  SkillActivation,
  SkillCatalogItem,
  SkillInstaller,
  SkillInstallerResult,
  SkillRegistry,
  SkillSnapshot,
  SkillSource,
} from "./skills/types.js";
export { createSkillRegistry } from "./skills/registry.js";
export { createSkillInstaller } from "./skills/installer.js";
export type {
  ToolCatalogItem,
  ToolInstaller,
  ToolInstallerResult,
  ToolRegistry,
  ToolSnapshot,
  ToolSource,
} from "./tools/types.js";
export { createToolRegistry } from "./tools/registry.js";
export { createCompositeToolRegistry } from "./tools/composite-registry.js";
export { createToolInstaller } from "./tools/installer.js";
export type {
  McpRemoteTool,
  McpToolBinding,
  McpToolCallResult,
  StdioMcpClient,
  StdioMcpClientOptions,
} from "./mcp/types.js";
export { createStdioMcpClient } from "./mcp/stdio-client.js";
export { createMcpToolSnapshotItem } from "./mcp/tool-adapter.js";

// ── Ports (dependency injection interfaces) ─────────────────────────
export {
  setMessageStore,
  getMessageStore,
  setTapeStore,
  getTapeStore,
  setSchedulerStore,
  getSchedulerStore,
  setPushService,
  getPushService,
  setModelConfigStore,
  getModelConfigStore,
  setHeartbeatStore,
  getHeartbeatStore,
  setHeartbeatExecutor,
  getHeartbeatExecutor,
} from "./ports/index.js";
export type {
  MessageStore,
  RestoredHistory,
  PersistMessageParams,
  MessagesSinceRow,
  TapeStore,
  TapeEntryRow,
  TapeAnchorRow,
  SchedulerStore,
  ScheduledTaskRow,
  ScheduledTaskRunRow,
  PushService,
  ModelConfigStore,
  ModelProviderTemplateRow,
  CreateModelProviderTemplateInput,
  UpdateModelProviderTemplateInput,
  ModelConfigRow,
  UpsertModelConfigInput,
  ModelPurpose,
  ModelScope,
  HeartbeatStore,
  HeartbeatExecutorPort,
  HeartbeatExecutionRequest,
  HeartbeatExecutionResult,
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
} from "./tape/index.js";
export type {
  TapeState,
  TapeFact,
  TapePreference,
  TapeDecision,
  RecordParams,
} from "./tape/index.js";

// ── Conversation (history management) ───────────────────────────────
export {
  ensureHistoryLoaded,
  getHistory,
  nextSeq,
  currentSeq,
  evictConversation,
  clearConversation,
  withConversationLock,
  rollbackMessages,
} from "./conversation/index.js";

// ── Commands ────────────────────────────────────────────────────────
export { CommandRegistry } from "./commands/registry.js";
export { builtinCommands } from "./commands/builtins.js";
export { isDebugEnabled } from "./commands/debug.js";
export type { Command, CommandContext } from "./commands/types.js";

// ── Scheduler ───────────────────────────────────────────────────────
export {
  schedulerManager,
  schedulerToolRegistry,
  setSchedulerContext,
  scheduleCommand,
} from "./scheduler/index.js";

// ── Heartbeat ───────────────────────────────────────────────────────
export {
  startHeartbeat,
  stopHeartbeat,
  checkWaitingGoalsAsync,
  heartbeatToolRegistry,
  setHeartbeatToolContext,
  setHeartbeatContext,
  isHeartbeatContext,
} from "./heartbeat/index.js";
export type {
  GoalStatus,
  GoalOrigin,
  Verdict,
  PendingGoalRow,
  CreateGoalInput,
  UpdateGoalInput,
  GoalTransition,
} from "./heartbeat/types.js";

// ── Chat orchestration ──────────────────────────────────────────────
export { chat } from "./chat.js";

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
  PROMPT_TEMPLATES,
  PROMPT_ASSET_SPECS,
  loadPromptAssets,
  resolveBundledPromptsDir,
  validateTemplateVars,
  setPromptAssets,
  getPromptAssets,
} from "./prompts/index.js";
export { extractMediaFromText, resolveFilePath } from "./media.js";
