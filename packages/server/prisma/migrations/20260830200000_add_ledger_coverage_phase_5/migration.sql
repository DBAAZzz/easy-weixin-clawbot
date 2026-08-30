-- Fact Ledger Phase 5: coverage 补全（memory facts / media artifacts / summary）。
-- Expand-only：不修改既有业务行；memory_events 冗余列随 Phase 5 起的新写入填充。

-- 1) attachment source ref → immutable MEDIA_ASSET 映射表
CREATE TABLE "conversation_attachment_artifacts" (
  "account_id" TEXT NOT NULL,
  "source_ref" TEXT NOT NULL,
  "artifact_id" TEXT NOT NULL,
  "mime_type" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "conversation_attachment_artifacts_pkey"
    PRIMARY KEY ("account_id", "source_ref"),
  CONSTRAINT "conversation_attachment_artifacts_account_fkey"
    FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "idx_attachment_artifacts_artifact"
  ON "conversation_attachment_artifacts"("artifact_id");

-- 2) TapeAnchor 关联 SUMMARY 制品（历史 anchor 为 NULL，不回填）
ALTER TABLE "tape_anchors" ADD COLUMN "summary_artifact_id" TEXT;

-- 3) memory_events 冗余列 + live 断言查询索引
--    仅 memory_asserted 行写入；superseded / anchor 行为 NULL，等值查询天然排除。
ALTER TABLE "memory_events" ADD COLUMN "category" TEXT;
ALTER TABLE "memory_events" ADD COLUMN "key" TEXT;

CREATE INDEX "idx_memory_events_live_lookup"
  ON "memory_events"("account_id", "branch", "category", "key", "memory_seq");
