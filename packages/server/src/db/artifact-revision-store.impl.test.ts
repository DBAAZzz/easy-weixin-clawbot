import assert from "node:assert/strict";
import test from "node:test";
import { ARTIFACT_KIND, FactLedgerContentHashMismatchError } from "@clawbot/agent";
import type { PrismaClient } from "@prisma/client";
import { PrismaArtifactRevisionStore } from "./artifact-revision-store.impl.js";

test("artifact store rejects an incorrect inline canonical hash before database access", async () => {
  const store = new PrismaArtifactRevisionStore({} as PrismaClient);

  await assert.rejects(
    () =>
      store.put({
        artifactId: "artifact-1",
        kind: ARTIFACT_KIND.SUMMARY,
        schemaVersion: 1,
        sha256: "a".repeat(64),
        inlineJson: { text: "summary" },
      }),
    FactLedgerContentHashMismatchError,
  );
});
