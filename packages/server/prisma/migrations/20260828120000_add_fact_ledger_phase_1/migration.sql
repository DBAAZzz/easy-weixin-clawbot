BEGIN;

CREATE TABLE "conversation_stream_heads" (
    "account_id" TEXT NOT NULL,
    "stream_id" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conversation_stream_heads_pkey" PRIMARY KEY ("account_id", "stream_id"),
    CONSTRAINT "conversation_stream_heads_last_seq_check" CHECK ("last_seq" >= 0),
    CONSTRAINT "conversation_stream_heads_account_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "conversation_events" (
    "event_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "stream_id" TEXT NOT NULL,
    "stream_seq" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT,
    "causation_id" TEXT,
    "correlation_id" TEXT,
    "idempotency_key" TEXT,
    "payload" JSONB NOT NULL,
    CONSTRAINT "conversation_events_pkey" PRIMARY KEY ("event_id"),
    CONSTRAINT "conversation_events_stream_seq_check" CHECK ("stream_seq" > 0),
    CONSTRAINT "conversation_events_schema_version_check" CHECK ("schema_version" > 0),
    CONSTRAINT "conversation_events_actor_kind_check" CHECK ("actor_kind" IN ('user', 'agent', 'system')),
    CONSTRAINT "conversation_events_actor_id_check" CHECK ("actor_kind" = 'system' OR "actor_id" IS NOT NULL),
    CONSTRAINT "conversation_events_head_fkey" FOREIGN KEY ("account_id", "stream_id") REFERENCES "conversation_stream_heads"("account_id", "stream_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "conversation_events_stream_seq_key" ON "conversation_events"("account_id", "stream_id", "stream_seq");
CREATE UNIQUE INDEX "conversation_events_account_idempotency_key" ON "conversation_events"("account_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL;
CREATE INDEX "idx_conversation_events_causation" ON "conversation_events"("causation_id");
CREATE INDEX "idx_conversation_events_correlation" ON "conversation_events"("correlation_id");

CREATE TABLE "agent_run_heads" (
    "run_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversation_stream_id" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "agent_run_heads_pkey" PRIMARY KEY ("run_id"),
    CONSTRAINT "agent_run_heads_last_seq_check" CHECK ("last_seq" >= 0),
    CONSTRAINT "agent_run_heads_account_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_run_heads_identity_key" ON "agent_run_heads"("run_id", "account_id", "conversation_stream_id");

CREATE TABLE "agent_run_events" (
    "event_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "run_seq" INTEGER NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversation_stream_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "causation_id" TEXT,
    "correlation_id" TEXT,
    "payload" JSONB NOT NULL,
    CONSTRAINT "agent_run_events_pkey" PRIMARY KEY ("event_id"),
    CONSTRAINT "agent_run_events_run_seq_check" CHECK ("run_seq" > 0),
    CONSTRAINT "agent_run_events_schema_version_check" CHECK ("schema_version" > 0),
    CONSTRAINT "agent_run_events_head_fkey" FOREIGN KEY ("run_id", "account_id", "conversation_stream_id") REFERENCES "agent_run_heads"("run_id", "account_id", "conversation_stream_id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "agent_run_events_run_seq_key" ON "agent_run_events"("run_id", "run_seq");
CREATE INDEX "idx_agent_run_events_conversation" ON "agent_run_events"("account_id", "conversation_stream_id", "recorded_at");
CREATE INDEX "idx_agent_run_events_causation" ON "agent_run_events"("causation_id");
CREATE INDEX "idx_agent_run_events_correlation" ON "agent_run_events"("correlation_id");

CREATE TABLE "memory_stream_heads" (
    "account_id" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "last_seq" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "memory_stream_heads_pkey" PRIMARY KEY ("account_id", "branch"),
    CONSTRAINT "memory_stream_heads_last_seq_check" CHECK ("last_seq" >= 0),
    CONSTRAINT "memory_stream_heads_account_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "memory_events" (
    "event_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "memory_seq" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "recorded_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_kind" TEXT NOT NULL,
    "actor_id" TEXT,
    "causation_id" TEXT,
    "correlation_id" TEXT,
    "payload" JSONB NOT NULL,
    CONSTRAINT "memory_events_pkey" PRIMARY KEY ("event_id"),
    CONSTRAINT "memory_events_memory_seq_check" CHECK ("memory_seq" > 0),
    CONSTRAINT "memory_events_schema_version_check" CHECK ("schema_version" > 0),
    CONSTRAINT "memory_events_actor_kind_check" CHECK ("actor_kind" IN ('user', 'agent', 'system')),
    CONSTRAINT "memory_events_actor_id_check" CHECK ("actor_kind" = 'system' OR "actor_id" IS NOT NULL),
    CONSTRAINT "memory_events_head_fkey" FOREIGN KEY ("account_id", "branch") REFERENCES "memory_stream_heads"("account_id", "branch") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "memory_events_branch_seq_key" ON "memory_events"("account_id", "branch", "memory_seq");
CREATE INDEX "idx_memory_events_causation" ON "memory_events"("causation_id");
CREATE INDEX "idx_memory_events_correlation" ON "memory_events"("correlation_id");

CREATE TABLE "artifact_revisions" (
    "artifact_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "content_location" TEXT NOT NULL,
    "inline_json" JSONB,
    "storage_ref" JSONB,
    "encryption_metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "artifact_revisions_pkey" PRIMARY KEY ("artifact_id"),
    CONSTRAINT "artifact_revisions_schema_version_check" CHECK ("schema_version" > 0),
    CONSTRAINT "artifact_revisions_sha256_check" CHECK ("sha256" ~ '^[a-f0-9]{64}$'),
    CONSTRAINT "artifact_revisions_content_location_check" CHECK (
        ("content_location" = 'inline' AND "inline_json" IS NOT NULL AND "storage_ref" IS NULL)
        OR ("content_location" = 'external' AND "inline_json" IS NULL AND "storage_ref" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "artifact_revisions_content_key" ON "artifact_revisions"("kind", "schema_version", "sha256");

CREATE FUNCTION "reject_fact_ledger_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'immutable fact ledger relation % does not allow %', TG_TABLE_NAME, TG_OP
        USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER "conversation_events_append_only"
BEFORE UPDATE OR DELETE ON "conversation_events"
FOR EACH ROW EXECUTE FUNCTION "reject_fact_ledger_mutation"();

CREATE TRIGGER "agent_run_events_append_only"
BEFORE UPDATE OR DELETE ON "agent_run_events"
FOR EACH ROW EXECUTE FUNCTION "reject_fact_ledger_mutation"();

CREATE TRIGGER "memory_events_append_only"
BEFORE UPDATE OR DELETE ON "memory_events"
FOR EACH ROW EXECUTE FUNCTION "reject_fact_ledger_mutation"();

CREATE TRIGGER "artifact_revisions_append_only"
BEFORE UPDATE OR DELETE ON "artifact_revisions"
FOR EACH ROW EXECUTE FUNCTION "reject_fact_ledger_mutation"();

COMMIT;
