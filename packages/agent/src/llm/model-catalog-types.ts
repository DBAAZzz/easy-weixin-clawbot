/**
 * Shape of the generated model catalog under `src/llm/data/`.
 *
 * Kept separate from `types.ts` so the generator can import it without pulling
 * in the AI SDK types that `ModelMeta` sits next to.
 */

/**
 * One model's metadata as stored in JSON — the serializable subset of
 * {@link import("./types.js").ModelMeta}.
 */
export interface GeneratedModelMeta {
  contextWindow: number;
  maxOutputTokens: number;
  supportsImageInput: boolean;
  /**
   * Present only when true. Absent is the common case, and an explicit `false`
   * on hundreds of models would be noise in every data file.
   */
  requiresReasonedToolHistory?: boolean;
}

/** provider id → model id → metadata. */
export type GeneratedModelCatalog = Record<string, Record<string, GeneratedModelMeta>>;
