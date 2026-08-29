import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { ArtifactContentSink } from "@clawbot/agent";
import { createModuleLogger } from "../logger.js";

const sinkLogger = createModuleLogger("artifact-content-sink");

/**
 * Local-directory implementation of the oversized-artifact content sink
 * (Phase 4 design §8/§11.1). Keys are constrained to a flat
 * `<kind>/<sha256>.json` layout under the fact-ledger artifact directory.
 *
 * S3-backed storage can reuse this Port without touching callers; Phase 4
 * ships the local implementation because content above the 256 KiB inline cap
 * is expected to be rare.
 */
export function createLocalArtifactContentSink(baseDir: string): ArtifactContentSink {
  const root = resolve(baseDir);
  const pathForKey = (key: string): string => {
    if (!/^[a-z0-9_]+\/[a-f0-9]{64}\.json$/.test(key)) {
      throw new Error("invalid_artifact_content_sink_key");
    }
    const target = resolve(root, key);
    if (!target.startsWith(root + "/")) {
      throw new Error("invalid_artifact_content_sink_key");
    }
    return target;
  };
  return {
    async put(key, content) {
      const target = pathForKey(key);
      await mkdir(resolve(root, key.split("/")[0]!), { recursive: true });
      await writeFile(target, content);
      sinkLogger.debug({ key }, "artifact content persisted");
      return { provider: "local-fact-ledger", key };
    },
    async get(key) {
      try {
        return new Uint8Array(await readFile(pathForKey(key)));
      } catch {
        return null;
      }
    },
  };
}
