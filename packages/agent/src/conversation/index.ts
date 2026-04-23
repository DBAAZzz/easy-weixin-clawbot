export {
  ensureHistoryLoaded,
  getHistory,
  nextSeq,
  currentSeq,
  appendAssistantTextMessage,
  evictConversation,
  clearConversation,
  withConversationLock,
  rollbackMessages,
} from "./history.js";
export {
  fitToContextWindow,
  type ContextWindowConfig,
  type TrimResult,
} from "./context-window.js";
export {
  estimateTextTokens,
  estimateMessageTokens,
  estimateHistoryTokens,
} from "./token-estimator.js";
