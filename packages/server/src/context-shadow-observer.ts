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
import { PrismaContextCompilerShadowResultStore } from "./db/context-compiler-shadow-result-store.js";
import { PrismaConversationEventStore } from "./db/conversation-event-store.impl.js";
import { createModuleLogger } from "./logger.js";

const shadowLogger = createModuleLogger("context-compiler-shadow");

export function createServerContextShadowObserver(): ContextShadowObserver {
  return createContextShadowObserver({
    compiler: createContextCompilerV1({
      conversationEventStore: new PrismaConversationEventStore(),
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
