-- Fact Ledger Phase 7: 旧路径退役与 memory projection 开关。
-- legacy 导入事件存于 conversation_events / memory_events（JSONB payload，无 DDL）。

ALTER TABLE "run_ledger_rollouts"
  ADD COLUMN "legacy_write_mode" TEXT NOT NULL DEFAULT 'prompt_shaped',
  ADD COLUMN "memory_read_path" TEXT NOT NULL DEFAULT 'tape';

ALTER TABLE "run_ledger_rollouts"
  ADD CONSTRAINT "run_ledger_rollouts_legacy_write_mode_check"
    CHECK ("legacy_write_mode" IN ('prompt_shaped', 'clean', 'suspended'));

ALTER TABLE "run_ledger_rollouts"
  ADD CONSTRAINT "run_ledger_rollouts_memory_read_path_check"
    CHECK ("memory_read_path" IN ('tape', 'dual', 'events'));
