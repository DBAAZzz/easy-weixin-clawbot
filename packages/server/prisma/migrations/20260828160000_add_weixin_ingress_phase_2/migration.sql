BEGIN;

ALTER TABLE "conversation_events"
  ADD CONSTRAINT "conversation_events_event_account_key" UNIQUE ("event_id", "account_id");

CREATE TABLE "weixin_ingress_dispatches" (
  "event_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "outcome" TEXT,
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "claimed_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "error_code" TEXT,
  "recovery_operator" TEXT,
  "recovery_reason" TEXT,
  "recovered_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weixin_ingress_dispatches_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "weixin_ingress_dispatches_event_account_fkey" FOREIGN KEY ("event_id", "account_id") REFERENCES "conversation_events"("event_id", "account_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "weixin_ingress_dispatches_account_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "weixin_ingress_dispatches_status_check" CHECK ("status" IN ('pending', 'processing', 'completed', 'failed')),
  CONSTRAINT "weixin_ingress_dispatches_outcome_check" CHECK ("outcome" IS NULL OR "outcome" IN ('chat', 'command', 'failed')),
  CONSTRAINT "weixin_ingress_dispatches_attempt_check" CHECK ("attempt_count" BETWEEN 0 AND 1),
  CONSTRAINT "weixin_ingress_dispatches_reason_length_check" CHECK ("recovery_reason" IS NULL OR char_length("recovery_reason") <= 500)
);
CREATE UNIQUE INDEX "weixin_ingress_dispatches_event_account_key" ON "weixin_ingress_dispatches"("event_id", "account_id");
CREATE INDEX "idx_weixin_ingress_dispatches_account_status" ON "weixin_ingress_dispatches"("account_id", "status");
CREATE INDEX "idx_weixin_ingress_dispatches_stuck" ON "weixin_ingress_dispatches"("status", "claimed_at");

CREATE TABLE "weixin_ingress_rollouts" (
  "account_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "weixin_ingress_rollouts_pkey" PRIMARY KEY ("account_id"),
  CONSTRAINT "weixin_ingress_rollouts_account_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "legacy_message_projection_links" (
  "event_id" TEXT NOT NULL,
  "account_id" TEXT NOT NULL,
  "conversation_id" TEXT NOT NULL,
  "message_seq" INTEGER NOT NULL,
  "message_id" BIGINT,
  "state" TEXT NOT NULL DEFAULT 'persisted',
  "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cleared_at" TIMESTAMPTZ(6),
  CONSTRAINT "legacy_message_projection_links_pkey" PRIMARY KEY ("event_id"),
  CONSTRAINT "legacy_message_projection_links_event_fkey" FOREIGN KEY ("event_id") REFERENCES "conversation_events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "legacy_message_projection_links_account_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "legacy_message_projection_links_message_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "legacy_message_projection_links_message_id_key" UNIQUE ("message_id"),
  CONSTRAINT "legacy_message_projection_links_state_check" CHECK ("state" IN ('persisted', 'cleared')),
  CONSTRAINT "legacy_message_projection_links_state_fields_check" CHECK (("state" = 'persisted' AND "message_id" IS NOT NULL AND "cleared_at" IS NULL) OR ("state" = 'cleared' AND "message_id" IS NULL AND "cleared_at" IS NOT NULL))
);
CREATE INDEX "idx_legacy_projection_links_conversation" ON "legacy_message_projection_links"("account_id", "conversation_id");

CREATE OR REPLACE FUNCTION validate_legacy_message_projection_link()
RETURNS TRIGGER AS $$
DECLARE source_account TEXT;
DECLARE source_type TEXT;
BEGIN
  SELECT "account_id", "event_type" INTO source_account, source_type
  FROM "conversation_events" WHERE "event_id" = NEW."event_id";
  IF source_account IS NULL OR source_type <> 'inbound_message_received' OR source_account <> NEW."account_id" THEN
    RAISE EXCEPTION 'invalid legacy message projection source event';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "legacy_message_projection_links_validate_source"
BEFORE INSERT OR UPDATE ON "legacy_message_projection_links"
FOR EACH ROW EXECUTE FUNCTION validate_legacy_message_projection_link();

COMMIT;
