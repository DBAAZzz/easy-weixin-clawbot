-- Fact Ledger Phase 6: 读取切换三态开关。
-- trigger run 的 anchorStreamSeq 存于 run_started payload（JSONB，无 DDL）。

ALTER TABLE "run_ledger_rollouts"
  ADD COLUMN "read_path" TEXT NOT NULL DEFAULT 'legacy';

ALTER TABLE "run_ledger_rollouts"
  ADD CONSTRAINT "run_ledger_rollouts_read_path_check"
    CHECK ("read_path" IN ('legacy', 'dual', 'canonical'));
