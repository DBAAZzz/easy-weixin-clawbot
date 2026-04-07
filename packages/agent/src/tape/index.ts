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

export {
  record,
  recall,
  compactIfNeeded,
  createHandoffAnchors,
  purgeCompacted,
  formatMemoryForPrompt,
} from "./service.js";

export { queueRecordEntry, getPendingTapeWriteCount } from "./queue.js";

export { fireExtractAndRecord } from "./extractor.js";

export type {
  TapeGraphNode,
  TapeGraphEdge,
  TapeGraphGroup,
  TapeGraphResponse,
} from "./graph.js";
export { buildTapeGraphSnapshot, generateTapeGraph } from "./graph.js";
