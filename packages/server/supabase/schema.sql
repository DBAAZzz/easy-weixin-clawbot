CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  display_name TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS conversations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  title TEXT,
  last_message_at TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (account_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_account ON conversations(account_id);

CREATE TABLE IF NOT EXISTS messages (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'toolResult')),
  content_text TEXT,
  payload JSONB NOT NULL,
  media_type TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (account_id, conversation_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_messages_lookup
  ON messages(account_id, conversation_id, id);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT,
  sha256 TEXT,
  provider TEXT NOT NULL,
  bucket TEXT,
  object_key TEXT,
  local_path TEXT,
  storage_ref JSONB,
  width INTEGER,
  height INTEGER,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_assets_account_kind_created
  ON assets(account_id, kind, created_at);

CREATE INDEX IF NOT EXISTS idx_assets_sha256
  ON assets(sha256);

CREATE TABLE IF NOT EXISTS app_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  normal_rate DOUBLE PRECISION DEFAULT 0.1,
  rsshub_base_url TEXT,
  rsshub_auth_type TEXT DEFAULT 'none',
  rsshub_username TEXT,
  rsshub_password TEXT,
  rsshub_bearer_token TEXT,
  rss_request_timeout_ms INTEGER DEFAULT 15000,
  asset_storage_provider TEXT DEFAULT 'local',
  asset_local_base_dir TEXT,
  asset_s3_name TEXT,
  asset_s3_endpoint TEXT,
  asset_s3_region TEXT,
  asset_s3_bucket TEXT,
  asset_s3_access_key_id TEXT,
  asset_s3_secret_access_key TEXT,
  asset_s3_public_base_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS asset_storage_provider TEXT DEFAULT 'local',
  ADD COLUMN IF NOT EXISTS asset_local_base_dir TEXT,
  ADD COLUMN IF NOT EXISTS asset_s3_name TEXT,
  ADD COLUMN IF NOT EXISTS asset_s3_endpoint TEXT,
  ADD COLUMN IF NOT EXISTS asset_s3_region TEXT,
  ADD COLUMN IF NOT EXISTS asset_s3_bucket TEXT,
  ADD COLUMN IF NOT EXISTS asset_s3_access_key_id TEXT,
  ADD COLUMN IF NOT EXISTS asset_s3_secret_access_key TEXT,
  ADD COLUMN IF NOT EXISTS asset_s3_public_base_url TEXT;
