-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "display_name" TEXT,
    "alias" TEXT,
    "deprecated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "sha256" TEXT,
    "provider" TEXT NOT NULL,
    "bucket" TEXT,
    "object_key" TEXT,
    "local_path" TEXT,
    "storage_ref" JSONB,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "title" TEXT,
    "last_message_at" TIMESTAMPTZ(6),
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "context_token" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_routes" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "wechat_conv_id" TEXT NOT NULL,
    "effective_conv_id" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "session_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "args_json" JSONB NOT NULL,
    "env_json" JSONB NOT NULL,
    "cwd" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'disconnected',
    "last_error" TEXT,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "resolved_command" TEXT,
    "resolved_args_json" JSONB,
    "resolved_env_json" JSONB,
    "resolved_from" TEXT,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_tools" (
    "id" BIGSERIAL NOT NULL,
    "server_id" BIGINT NOT NULL,
    "remote_name" TEXT NOT NULL,
    "local_name" TEXT NOT NULL,
    "summary" TEXT,
    "input_schema" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "mcp_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "content_text" TEXT,
    "payload" JSONB NOT NULL,
    "media_type" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_tokens" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "token_prefix" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),

    CONSTRAINT "webhook_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_account_permissions" (
    "token_id" BIGINT NOT NULL,
    "account_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_account_permissions_pkey" PRIMARY KEY ("token_id","account_id")
);

-- CreateTable
CREATE TABLE "webhook_logs" (
    "id" BIGSERIAL NOT NULL,
    "token_id" BIGINT NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "traces" (
    "id" BIGSERIAL NOT NULL,
    "trace_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "total_ms" INTEGER NOT NULL,
    "llm_rounds" INTEGER NOT NULL,
    "tool_calls" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "stop_reason" TEXT NOT NULL,
    "error" TEXT,
    "flags" TEXT NOT NULL DEFAULT '',
    "sampled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trace_spans" (
    "id" BIGSERIAL NOT NULL,
    "trace_id" TEXT NOT NULL,
    "span_id" TEXT NOT NULL,
    "parent_span_id" TEXT,
    "name" TEXT NOT NULL,
    "start_time" TIMESTAMPTZ(6) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "tool_name" TEXT,
    "model" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "stop_reason" TEXT,
    "error_message" TEXT,
    "payload" TEXT,

    CONSTRAINT "trace_spans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usage_events" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "provider" TEXT,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_tasks" (
    "id" BIGSERIAL NOT NULL,
    "task_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "task_kind" TEXT NOT NULL DEFAULT 'prompt',
    "config_json" JSONB NOT NULL DEFAULT '{}',
    "type" TEXT NOT NULL DEFAULT 'recurring',
    "cron" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "last_run_at" TIMESTAMPTZ(6),
    "next_run_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "run_count" INTEGER NOT NULL DEFAULT 0,
    "fail_streak" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_task_runs" (
    "id" BIGSERIAL NOT NULL,
    "task_id" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "result" TEXT,
    "duration_ms" INTEGER,
    "error" TEXT,
    "pushed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rss_sources" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "route_path" TEXT,
    "feed_url" TEXT,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'normal',
    "last_fetched_at" TIMESTAMPTZ(6),
    "last_success_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "failure_streak" INTEGER NOT NULL DEFAULT 0,
    "backoff_until" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "rss_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rss_entries" (
    "id" BIGSERIAL NOT NULL,
    "source_id" BIGINT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "guid" TEXT,
    "raw_link" TEXT,
    "normalized_link" TEXT,
    "title" TEXT NOT NULL,
    "author" TEXT,
    "published_at" TIMESTAMPTZ(6),
    "summary_text" TEXT,
    "content_text" TEXT,
    "media_json" JSONB NOT NULL DEFAULT '[]',
    "meta_json" JSONB NOT NULL DEFAULT '{}',
    "collected_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "rss_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rss_task_sources" (
    "task_id" BIGINT NOT NULL,
    "source_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rss_task_sources_pkey" PRIMARY KEY ("task_id","source_id")
);

-- CreateTable
CREATE TABLE "rss_deliveries" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "task_id" BIGINT,
    "entry_id" BIGINT,
    "delivered_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rss_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tape_entries" (
    "id" BIGSERIAL NOT NULL,
    "eid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "actor" TEXT NOT NULL,
    "source" TEXT,
    "prev_hash" TEXT,
    "compacted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tape_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tape_anchors" (
    "id" BIGSERIAL NOT NULL,
    "aid" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "anchor_type" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "manifest" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "predecessors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "last_entry_eid" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tape_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_provider_templates" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "api_key" TEXT,
    "api_key_ciphertext" TEXT,
    "base_url" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "model_provider_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "web_search_providers" (
    "id" BIGSERIAL NOT NULL,
    "provider_type" TEXT NOT NULL,
    "api_key_ciphertext" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "web_search_providers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "normal_rate" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "rsshub_base_url" TEXT,
    "rsshub_auth_type" TEXT NOT NULL DEFAULT 'none',
    "rsshub_username" TEXT,
    "rsshub_password" TEXT,
    "rsshub_password_ciphertext" TEXT,
    "rsshub_bearer_token" TEXT,
    "rsshub_bearer_token_ciphertext" TEXT,
    "rss_request_timeout_ms" INTEGER NOT NULL DEFAULT 15000,
    "asset_storage_provider" TEXT NOT NULL DEFAULT 'local',
    "asset_local_base_dir" TEXT,
    "asset_s3_name" TEXT,
    "asset_s3_endpoint" TEXT,
    "asset_s3_region" TEXT,
    "asset_s3_bucket" TEXT,
    "asset_s3_access_key_id" TEXT,
    "asset_s3_secret_access_key" TEXT,
    "asset_s3_secret_access_key_ciphertext" TEXT,
    "asset_s3_public_base_url" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "model_configs" (
    "id" BIGSERIAL NOT NULL,
    "scope" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "template_id" BIGINT NOT NULL,
    "model_id" TEXT NOT NULL,
    "supports_image_input_override" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "model_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_goals" (
    "id" BIGSERIAL NOT NULL,
    "goal_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" TEXT NOT NULL,
    "source_conversation_id" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "origin_type" TEXT NOT NULL,
    "origin_ref" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "next_check_at" TIMESTAMPTZ(6) NOT NULL,
    "check_count" INTEGER NOT NULL DEFAULT 0,
    "max_checks" INTEGER NOT NULL DEFAULT 10,
    "backoff_ms" INTEGER NOT NULL DEFAULT 300000,
    "latest_source_message_seq" INTEGER,
    "resume_signal" TEXT,
    "last_check_at" TIMESTAMPTZ(6),
    "last_check_result" TEXT,
    "resolution" TEXT,
    "total_input_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_output_tokens" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "pending_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weixin_account_credentials" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "token_encrypted" BYTEA NOT NULL,
    "token_iv" BYTEA NOT NULL,
    "token_auth_tag" BYTEA NOT NULL,
    "base_url" TEXT NOT NULL,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "key_version" INTEGER NOT NULL DEFAULT 1,
    "last_login_at" TIMESTAMPTZ(6),
    "last_validated_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "weixin_account_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weixin_account_allow_from" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "wechat_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weixin_account_allow_from_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weixin_sync_state" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "sync_buf" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "weixin_sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_assets_account_kind_created" ON "assets"("account_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "idx_assets_sha256" ON "assets"("sha256");

-- CreateIndex
CREATE INDEX "idx_conversations_account" ON "conversations"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_account_id_conversation_id_key" ON "conversations"("account_id", "conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_routes_account_id_wechat_conv_id_key" ON "session_routes"("account_id", "wechat_conv_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_slug_key" ON "mcp_servers"("slug");

-- CreateIndex
CREATE INDEX "idx_mcp_servers_enabled" ON "mcp_servers"("enabled");

-- CreateIndex
CREATE INDEX "idx_mcp_tools_server" ON "mcp_tools"("server_id");

-- CreateIndex
CREATE INDEX "idx_mcp_tools_enabled" ON "mcp_tools"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tools_server_id_remote_name_key" ON "mcp_tools"("server_id", "remote_name");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tools_local_name_key" ON "mcp_tools"("local_name");

-- CreateIndex
CREATE INDEX "idx_messages_lookup" ON "messages"("account_id", "conversation_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_account_id_conversation_id_seq_key" ON "messages"("account_id", "conversation_id", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_tokens_source_key" ON "webhook_tokens"("source");

-- CreateIndex
CREATE INDEX "idx_webhook_tokens_hash" ON "webhook_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "idx_webhook_permissions_account" ON "webhook_account_permissions"("account_id");

-- CreateIndex
CREATE INDEX "idx_webhook_logs_token" ON "webhook_logs"("token_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_webhook_logs_account" ON "webhook_logs"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_webhook_logs_idempotency" ON "webhook_logs"("idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "traces_trace_id_key" ON "traces"("trace_id");

-- CreateIndex
CREATE INDEX "idx_traces_account_created" ON "traces"("account_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_traces_conversation_created" ON "traces"("conversation_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_traces_flags_created" ON "traces"("flags", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_traces_sampled_created" ON "traces"("sampled", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_trace_spans_trace" ON "trace_spans"("trace_id");

-- CreateIndex
CREATE INDEX "idx_trace_spans_name_start" ON "trace_spans"("name", "start_time" DESC);

-- CreateIndex
CREATE INDEX "idx_trace_spans_tool_status" ON "trace_spans"("tool_name", "status");

-- CreateIndex
CREATE INDEX "idx_trace_spans_status_start" ON "trace_spans"("status", "start_time" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "trace_spans_trace_id_span_id_key" ON "trace_spans"("trace_id", "span_id");

-- CreateIndex
CREATE INDEX "idx_usage_events_created" ON "usage_events"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_usage_events_model_created" ON "usage_events"("model", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_usage_events_account_created" ON "usage_events"("account_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_tasks_task_id_key" ON "scheduled_tasks"("task_id");

-- CreateIndex
CREATE INDEX "idx_scheduled_tasks_account_enabled" ON "scheduled_tasks"("account_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_tasks_account_id_seq_key" ON "scheduled_tasks"("account_id", "seq");

-- CreateIndex
CREATE INDEX "idx_scheduled_task_runs_task" ON "scheduled_task_runs"("task_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_rss_sources_enabled_status" ON "rss_sources"("enabled", "status");

-- CreateIndex
CREATE INDEX "idx_rss_sources_last_fetched_at" ON "rss_sources"("last_fetched_at");

-- CreateIndex
CREATE INDEX "idx_rss_entries_source_collected" ON "rss_entries"("source_id", "collected_at" DESC);

-- CreateIndex
CREATE INDEX "idx_rss_entries_fingerprint" ON "rss_entries"("fingerprint");

-- CreateIndex
CREATE INDEX "idx_rss_entries_expires_at" ON "rss_entries"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "rss_entries_source_id_fingerprint_key" ON "rss_entries"("source_id", "fingerprint");

-- CreateIndex
CREATE INDEX "idx_rss_task_sources_source" ON "rss_task_sources"("source_id");

-- CreateIndex
CREATE INDEX "idx_rss_deliveries_account_delivered" ON "rss_deliveries"("account_id", "delivered_at" DESC);

-- CreateIndex
CREATE INDEX "idx_rss_deliveries_task" ON "rss_deliveries"("task_id");

-- CreateIndex
CREATE UNIQUE INDEX "rss_deliveries_account_id_fingerprint_key" ON "rss_deliveries"("account_id", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "tape_entries_eid_key" ON "tape_entries"("eid");

-- CreateIndex
CREATE INDEX "idx_tape_branch_type" ON "tape_entries"("account_id", "branch", "type");

-- CreateIndex
CREATE INDEX "idx_tape_branch_created" ON "tape_entries"("account_id", "branch", "created_at");

-- CreateIndex
CREATE INDEX "idx_tape_branch_compacted" ON "tape_entries"("account_id", "branch", "compacted");

-- CreateIndex
CREATE UNIQUE INDEX "tape_anchors_aid_key" ON "tape_anchors"("aid");

-- CreateIndex
CREATE INDEX "idx_anchor_branch_type" ON "tape_anchors"("account_id", "branch", "anchor_type");

-- CreateIndex
CREATE INDEX "idx_anchor_branch_created" ON "tape_anchors"("account_id", "branch", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "web_search_providers_provider_type_key" ON "web_search_providers"("provider_type");

-- CreateIndex
CREATE INDEX "idx_model_config_scope" ON "model_configs"("scope", "scope_key");

-- CreateIndex
CREATE INDEX "idx_model_config_template_id" ON "model_configs"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "model_config_scope_key_purpose_key" ON "model_configs"("scope", "scope_key", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "pending_goals_goal_id_key" ON "pending_goals"("goal_id");

-- CreateIndex
CREATE INDEX "idx_pending_goals_status_next_check" ON "pending_goals"("status", "next_check_at");

-- CreateIndex
CREATE INDEX "idx_pending_goals_account_status" ON "pending_goals"("account_id", "status");

-- CreateIndex
CREATE INDEX "idx_pending_goals_account_conv_status" ON "pending_goals"("account_id", "source_conversation_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "weixin_account_credentials_account_id_key" ON "weixin_account_credentials"("account_id");

-- CreateIndex
CREATE INDEX "idx_weixin_credentials_status" ON "weixin_account_credentials"("status");

-- CreateIndex
CREATE INDEX "idx_weixin_allow_from_account" ON "weixin_account_allow_from"("account_id");

-- CreateIndex
CREATE UNIQUE INDEX "weixin_allow_from_account_user_key" ON "weixin_account_allow_from"("account_id", "wechat_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "weixin_sync_state_account_id_key" ON "weixin_sync_state"("account_id");

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_routes" ADD CONSTRAINT "session_routes_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_account_permissions" ADD CONSTRAINT "webhook_account_permissions_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "webhook_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_account_permissions" ADD CONSTRAINT "webhook_account_permissions_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_logs" ADD CONSTRAINT "webhook_logs_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "webhook_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trace_spans" ADD CONSTRAINT "trace_spans_trace_id_fkey" FOREIGN KEY ("trace_id") REFERENCES "traces"("trace_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_task_runs" ADD CONSTRAINT "scheduled_task_runs_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rss_entries" ADD CONSTRAINT "rss_entries_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "rss_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rss_task_sources" ADD CONSTRAINT "rss_task_sources_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rss_task_sources" ADD CONSTRAINT "rss_task_sources_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "rss_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rss_deliveries" ADD CONSTRAINT "rss_deliveries_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "scheduled_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rss_deliveries" ADD CONSTRAINT "rss_deliveries_entry_id_fkey" FOREIGN KEY ("entry_id") REFERENCES "rss_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tape_entries" ADD CONSTRAINT "tape_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tape_anchors" ADD CONSTRAINT "tape_anchors_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "model_configs" ADD CONSTRAINT "model_configs_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "model_provider_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weixin_account_credentials" ADD CONSTRAINT "weixin_account_credentials_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weixin_account_allow_from" ADD CONSTRAINT "weixin_account_allow_from_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weixin_sync_state" ADD CONSTRAINT "weixin_sync_state_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

