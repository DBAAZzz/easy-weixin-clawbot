/**
 * Fact-ledger runtime composition shared by the ingress path (agent.ts) and
 * the trigger-run path (chat-executor.impl, Phase 6 design §5.1).
 *
 * Lives outside agent.ts on purpose: ai.ts must wire the chat executor before
 * agent.ts finishes evaluating, and importing agent.ts from ai.ts would close
 * an initialization cycle (agent.ts depends on ai.ts for the chat engine).
 */

import {
  createContextCompilerV1,
  getAgentRunStore,
  getArtifactRevisionStore,
  type RunLedgerMetrics,
} from "@clawbot/agent";
import {
  runLedgerTotal,
  runLedgerEventTotal,
  runLedgerInlineLatencyMs,
  contextManifestTotal,
  artifactPutTotal,
} from "@clawbot/observability";
import { PrismaConversationEventStore } from "./conversation-event-store.impl.js";
import { createLocalArtifactContentSink } from "./artifact-content-sink.js";
import { createPrismaAttachmentArtifactResolver } from "./prisma-attachment-artifact-resolver.js";
import { FACT_LEDGER_ARTIFACTS_DIR } from "../paths.js";

/** Run-ledger metrics adapter shared by all account agents and trigger runs. */
export const runLedgerMetrics: RunLedgerMetrics = {
  total(result) {
    runLedgerTotal.inc({ result });
  },
  event(eventType) {
    runLedgerEventTotal.inc({ event_type: eventType });
  },
  inlineLatencyMs(duration) {
    runLedgerInlineLatencyMs.observe({}, duration);
  },
  artifactPut(kind, result) {
    artifactPutTotal.inc({ kind, result });
  },
  manifest(result) {
    contextManifestTotal.inc({ result });
  },
};

export const factLedgerContentSink = createLocalArtifactContentSink(FACT_LEDGER_ARTIFACTS_DIR);

/**
 * Account-agnostic policy-v3 context compiler — stores take accountId per
 * call, so one instance serves ingress runs and trigger runs alike.
 */
export function createServerRunLedgerCompiler() {
  return createContextCompilerV1({
    conversationEventStore: new PrismaConversationEventStore(),
    agentRunStore: getAgentRunStore(),
    artifactRevisionStore: getArtifactRevisionStore(),
    contentSink: factLedgerContentSink,
    attachmentArtifactResolver: createPrismaAttachmentArtifactResolver({
      artifactRevisionStore: getArtifactRevisionStore(),
    }),
  });
}
