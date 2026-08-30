export type {
  Fragment,
  EntryPayload,
  TapeState,
  TapeFact,
  TapePreference,
  TapeDecision,
  RecordParams,
} from "./types.js";

export { emptyState, fold, serializeState, deserializeState } from "./fold.js";

export { GLOBAL_BRANCH, isGlobalBranch } from "./constants.js";

export {
  record,
  recall,
  compactIfNeeded,
  createHandoffAnchors,
  purgeCompacted,
  formatMemoryForPrompt,
} from "./service.js";

export type { MemoryPromptOptions } from "./service.js";

export { queueRecordEntry, getPendingTapeWriteCount } from "./queue.js";

export { fireExtractAndRecord } from "./extractor.js";
export {
  deriveMemoryAssertionEventId,
  deriveMemorySupersededEventId,
  writeMemoryFactToLedger,
  lookupPreviousValue,
  branchForScope,
  type MemoryFactInput,
  type MemoryFactEvidence,
  type MemoryFactLedgerResult,
} from "./fact-writer.js";
export {
  buildSummaryDocument,
  summaryArtifactId,
  putSummaryArtifact,
  appendMemoryAnchorCreated,
  type SummaryDocumentInput,
} from "./summary-artifacts.js";

export type {
  TapeGraphNode,
  TapeGraphEdge,
  TapeGraphGroup,
  TapeGraphResponse,
} from "./graph.js";
export { buildTapeGraphSnapshot, generateTapeGraph } from "./graph.js";
