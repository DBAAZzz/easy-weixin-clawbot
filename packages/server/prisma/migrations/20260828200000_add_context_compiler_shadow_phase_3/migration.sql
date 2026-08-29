BEGIN;

ALTER TABLE "weixin_ingress_dispatches"
  ADD COLUMN "command_name" TEXT,
  ADD CONSTRAINT "weixin_ingress_dispatches_command_name_check"
    CHECK ("command_name" IS NULL OR "command_name" = 'clear');

CREATE TABLE "context_compiler_shadow_rollouts" (
  "account_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "context_compiler_shadow_rollouts_pkey" PRIMARY KEY ("account_id"),
  CONSTRAINT "context_compiler_shadow_rollouts_account_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "context_compiler_shadow_results" (
  "source_event_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "compiler_version" TEXT NOT NULL,
  "context_policy_revision_id" TEXT NOT NULL,
  "event_cursor" INTEGER NOT NULL,
  "effective_time" TIMESTAMPTZ(6) NOT NULL,
  "timezone" TEXT NOT NULL,
  "canonical_context_hash" TEXT,
  "canonical_memory_input_hash" TEXT,
  "legacy_summary_hash" TEXT,
  "canonical_entry_count" INTEGER,
  "legacy_entry_count" INTEGER,
  "diff_counts" JSONB NOT NULL,
  "status" TEXT NOT NULL,
  "error_code" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "context_compiler_shadow_results_pkey"
    PRIMARY KEY ("source_event_id", "compiler_version", "context_policy_revision_id"),
  CONSTRAINT "context_compiler_shadow_results_event_account_fkey"
    FOREIGN KEY ("source_event_id", "account_id")
    REFERENCES "conversation_events"("event_id", "account_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "context_compiler_shadow_results_account_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "context_compiler_shadow_results_status_check"
    CHECK ("status" IN ('success', 'failed')),
  CONSTRAINT "context_compiler_shadow_results_cursor_check"
    CHECK ("event_cursor" > 0),
  CONSTRAINT "context_compiler_shadow_results_counts_check"
    CHECK (("canonical_entry_count" IS NULL OR "canonical_entry_count" >= 0)
      AND ("legacy_entry_count" IS NULL OR "legacy_entry_count" >= 0)),
  CONSTRAINT "context_compiler_shadow_results_hash_check" CHECK (
    ("canonical_context_hash" IS NULL OR "canonical_context_hash" ~ '^[a-f0-9]{64}$')
    AND ("canonical_memory_input_hash" IS NULL OR "canonical_memory_input_hash" ~ '^[a-f0-9]{64}$')
    AND ("legacy_summary_hash" IS NULL OR "legacy_summary_hash" ~ '^[a-f0-9]{64}$')
  ),
  CONSTRAINT "context_compiler_shadow_results_status_fields_check" CHECK (
    ("status" = 'success' AND "error_code" IS NULL
      AND "canonical_context_hash" IS NOT NULL
      AND "canonical_memory_input_hash" IS NOT NULL
      AND "legacy_summary_hash" IS NOT NULL
      AND "canonical_entry_count" IS NOT NULL
      AND "legacy_entry_count" IS NOT NULL)
    OR ("status" = 'failed' AND "error_code" IS NOT NULL)
  ),
  CONSTRAINT "context_compiler_shadow_results_diff_counts_check" CHECK (
    jsonb_typeof("diff_counts") = 'object'
    AND jsonb_typeof("diff_counts"->'match_user_text') = 'number'
    AND jsonb_typeof("diff_counts"->'legacy_user_has_runtime_time') = 'number'
    AND jsonb_typeof("diff_counts"->'legacy_user_has_tape_memory') = 'number'
    AND jsonb_typeof("diff_counts"->'legacy_user_has_visual_fallback') = 'number'
    AND jsonb_typeof("diff_counts"->'legacy_quoted_display_only') = 'number'
    AND jsonb_typeof("diff_counts"->'legacy_only_assistant_entry') = 'number'
    AND jsonb_typeof("diff_counts"->'legacy_only_tool_entry') = 'number'
    AND jsonb_typeof("diff_counts"->'canonical_unresolved_attachment') = 'number'
    AND jsonb_typeof("diff_counts"->'session_boundary_difference') = 'number'
    AND jsonb_typeof("diff_counts"->'entry_order_difference') = 'number'
    AND jsonb_typeof("diff_counts"->'unclassified_difference') = 'number'
    AND jsonb_typeof("diff_counts"->'shadow_compile_failed') = 'number'
    AND ("diff_counts"->>'match_user_text') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'legacy_user_has_runtime_time') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'legacy_user_has_tape_memory') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'legacy_user_has_visual_fallback') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'legacy_quoted_display_only') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'legacy_only_assistant_entry') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'legacy_only_tool_entry') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'canonical_unresolved_attachment') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'session_boundary_difference') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'entry_order_difference') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'unclassified_difference') ~ '^(0|[1-9][0-9]*)$'
    AND ("diff_counts"->>'shadow_compile_failed') ~ '^(0|[1-9][0-9]*)$'
    AND "diff_counts"
      - 'match_user_text'
      - 'legacy_user_has_runtime_time'
      - 'legacy_user_has_tape_memory'
      - 'legacy_user_has_visual_fallback'
      - 'legacy_quoted_display_only'
      - 'legacy_only_assistant_entry'
      - 'legacy_only_tool_entry'
      - 'canonical_unresolved_attachment'
      - 'session_boundary_difference'
      - 'entry_order_difference'
      - 'unclassified_difference'
      - 'shadow_compile_failed' = '{}'::jsonb
  )
);

CREATE INDEX "idx_context_compiler_shadow_results_account_status"
  ON "context_compiler_shadow_results"("account_id", "status");

COMMIT;
