-- DropTable
DROP TABLE "pending_goals";

-- CreateTable
CREATE TABLE "reminders" (
    "id" BIGSERIAL NOT NULL,
    "reminder_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "fire_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reminders_reminder_id_key" ON "reminders"("reminder_id");

-- CreateIndex
CREATE INDEX "idx_reminders_fire_at" ON "reminders"("fire_at");

-- CreateIndex
CREATE INDEX "idx_reminders_account" ON "reminders"("account_id");


-- Drop a legacy role CHECK left over from supabase/schema.sql, if present.
-- Prisma never declared it, so `db push` could not have removed it. The new
-- "trigger" role would violate it. No-op when the constraint is absent.
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_role_check";
