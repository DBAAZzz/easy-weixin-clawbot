import type { ArtifactRevisionStore } from "../../ports/artifact-revision-store.js";
import type { ArtifactContentSink } from "../../ports/artifact-content-sink.js";
import type { ArtifactKind, JsonValue } from "../../shared/fact-ledger/contracts.js";
import { canonicalizeJson, sha256CanonicalJson } from "../../shared/fact-ledger/canonical-json.js";

/**
 * Artifact put orchestration for the run ledger (Phase 4 design §7/§8).
 *
 * All documents are content-addressed: `artifactId = <kind-slug>-v1:<sha256>`,
 * except the CONTEXT_MANIFEST whose artifactId is the deterministic manifestId.
 * Content up to `INLINE_ARTIFACT_LIMIT_BYTES` is stored inline; anything larger
 * goes through the ArtifactContentSink, and missing/failed sink writes throw —
 * the recorder turns that into run degradation.
 */

export const INLINE_ARTIFACT_LIMIT_BYTES = 256 * 1024;

export interface ArtifactPutResult {
  artifactId: string;
  sha256: string;
  appended: boolean;
}

export interface ArtifactPutterDeps {
  artifactRevisionStore: ArtifactRevisionStore;
  contentSink?: ArtifactContentSink;
  onPut?: (kind: ArtifactKind, result: "appended" | "reused" | "failed") => void;
}

function kindSlug(kind: ArtifactKind): string {
  return kind.replace(/_/g, "-");
}

function serializedByteLength(document: unknown): number {
  return Buffer.byteLength(canonicalizeJson(document), "utf8");
}

export async function putDocumentArtifact(
  deps: ArtifactPutterDeps,
  kind: ArtifactKind,
  document: unknown,
  options: { artifactId?: string } = {},
): Promise<ArtifactPutResult> {
  const sha256 = sha256CanonicalJson(document);
  const artifactId = options.artifactId ?? `${kindSlug(kind)}-v1:${sha256}`;
  try {
    let storageRef: { provider: string; key: string } | undefined;
    if (serializedByteLength(document) > INLINE_ARTIFACT_LIMIT_BYTES) {
      if (!deps.contentSink) throw new Error("artifact_content_sink_required");
      // The sink receives the canonical JSON text — exactly the bytes that the
      // recorded sha256 refers to.
      storageRef = await deps.contentSink.put(
        `${kindSlug(kind)}/${sha256}.json`,
        Buffer.from(canonicalizeJson(document), "utf8"),
      );
    }
    const result = await deps.artifactRevisionStore.put({
      artifactId,
      kind,
      sha256,
      schemaVersion: 1,
      ...(storageRef ? { storageRef } : { inlineJson: document as JsonValue }),
    });
    deps.onPut?.(kind, result.appended ? "appended" : "reused");
    return { artifactId, sha256, appended: result.appended };
  } catch (error) {
    deps.onPut?.(kind, "failed");
    throw error;
  }
}
