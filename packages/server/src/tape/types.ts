/** Tape memory system type definitions — based on tape.systems spec */

/** Fragment: atomic, typed, referential content unit inside Entry.payload */
export interface Fragment {
  kind: "text" | "image" | "tool_call" | "observation" | "reference";
  data: Record<string, unknown>;
  ref?: string;
}

/** Entry payload shape stored in TapeEntry.payload JSONB */
export interface EntryPayload {
  fragments: Fragment[];
}

/** Tape state: the structured result of folding all entries */
export interface TapeState {
  facts: Map<string, TapeFact>;
  preferences: Map<string, TapePreference>;
  decisions: TapeDecision[];
  version: number;
}

export interface TapeFact {
  key: string;
  value: unknown;
  confidence: number;
  sourceEid: string;
  updatedAt: string;
}

export interface TapePreference {
  key: string;
  value: unknown;
  sourceEid: string;
  updatedAt: string;
}

export interface TapeDecision {
  description: string;
  context: string;
  sourceEid: string;
  createdAt: string;
}

/** Serializable form of TapeState for JSONB storage (Maps → plain objects) */
export interface SerializedTapeState {
  facts: Record<string, TapeFact>;
  preferences: Record<string, TapePreference>;
  decisions: TapeDecision[];
  version: number;
}

/** Parameters for recording a new tape entry */
export interface RecordParams {
  category: string;
  actor: string;
  source?: string;
  payload: EntryPayload;
}
