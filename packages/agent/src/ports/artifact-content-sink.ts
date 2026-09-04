/**
 * Storage for oversized artifact content (Phase 4 design §8/§11.1).
 *
 * The Artifact Revision Store only records metadata (`inlineJson` or a
 * `storageRef` reference); this sink is where the actual bytes of artifacts
 * above the inline size cap are durably written. Phase 4 adds a minimal read
 * path because the v2 compiler must read back MODEL_RESPONSE / TOOL_RESULT
 * texts for canonical entries — full replay/audit APIs remain out of scope.
 */
export interface ArtifactContentSink {
  /** Durably store the bytes and return the storage reference to record on the artifact row. */
  put(key: string, content: Uint8Array): Promise<{ provider: string; key: string }>;
  /** Read back exactly the bytes written by `put`, or null when unavailable. */
  get(key: string): Promise<Uint8Array | null>;
}
