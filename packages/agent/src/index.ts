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
  PushService,
  ModelConfigStore,
  ModelConfigRow,
  UpsertModelConfigInput,
  ModelPurpose,
  ModelScope,
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

// ── Chat orchestration ──────────────────────────────────────────────
export { chat } from "./chat.js";
export { extractMediaFromText, resolveFilePath } from "./media.js";
