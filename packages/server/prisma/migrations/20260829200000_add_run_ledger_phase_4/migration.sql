-- Fact Ledger Phase 4: Run Ledger rollout gate.
-- Expand-only: run/artifact tables exist from Phase 1; the payload contract
-- extension (model_call_started.requestArtifactId) lives in JSONB. No existing
-- table is modified. Keyset pagination of listRunEventsByStream relies on the
-- existing idx_agent_run_events_conversation (account, stream, recorded_at)
-- index; the eventId tiebreak sorts the rare same-timestamp tail in memory.

CREATE TABLE "run_ledger_rollouts" (
  "account_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "run_ledger_rollouts_pkey" PRIMARY KEY ("account_id"),
  CONSTRAINT "run_ledger_rollouts_account_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
