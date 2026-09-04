import {
  createContextCompilerV1,
  createContextShadowObserver,
  type ContextShadowObserver,
} from "@clawbot/agent";
import {
  contextCompilerDiffTotal,
  contextCompilerDurationMs,
  contextCompilerEntries,
  contextCompilerShadowTotal,
  contextCompilerUnresolvedAttachmentTotal,
} from "@clawbot/observability";
import { PrismaAgentRunStore } from "./db/agent-run-store.impl.js";
import { PrismaArtifactRevisionStore } from "./db/artifact-revision-store.impl.js";
import { createLocalArtifactContentSink } from "./db/artifact-content-sink.js";
import { PrismaContextCompilerShadowResultStore } from "./db/context-compiler-shadow-result-store.js";
import { PrismaConversationEventStore } from "./db/conversation-event-store.impl.js";
import { createPrismaAttachmentArtifactResolver } from "./db/prisma-attachment-artifact-resolver.js";
import { FACT_LEDGER_ARTIFACTS_DIR } from "./paths.js";
import { createModuleLogger } from "./logger.js";

const shadowLogger = createModuleLogger("context-compiler-shadow");

/**
 * Phase 4/5：shadow observer 用 policy v2 编译（conversation + run facts），
 * 并接入真实 media resolver——`canonical_unresolved_attachment` 对新流量趋零
 * 的收敛信号来自这里。
 */
export function createServerContextShadowObserver(): ContextShadowObserver {
  return createContextShadowObserver({
    compiler: createContextCompilerV1({
      conversationEventStore: new PrismaConversationEventStore(),
      agentRunStore: new PrismaAgentRunStore(),
      artifactRevisionStore: new PrismaArtifactRevisionStore(),
      contentSink: createLocalArtifactContentSink(FACT_LEDGER_ARTIFACTS_DIR),
      attachmentArtifactResolver: createPrismaAttachmentArtifactResolver({
        artifactRevisionStore: new PrismaArtifactRevisionStore(),
      }),
    }),
    resultStore: new PrismaContextCompilerShadowResultStore(),
    metrics: {
      total(result) {
        contextCompilerShadowTotal.inc({ result });
      },
      diff(counts) {
        for (const [category, count] of Object.entries(counts)) {
          if (count > 0) contextCompilerDiffTotal.inc({ category }, count);
        }
      },
      entries(side, count) {
        contextCompilerEntries.observe({ side }, count);
      },
      unresolvedAttachments(count) {
        if (count > 0) contextCompilerUnresolvedAttachmentTotal.inc({}, count);
      },
      durationMs(duration) {
        contextCompilerDurationMs.observe({}, duration);
      },
    },
    onError(fields) {
      shadowLogger.warn(fields, "Context compiler shadow failed open");
    },
  });
}
