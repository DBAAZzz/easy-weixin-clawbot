-- DropTable
DROP TABLE "reminders";

-- CreateTable
CREATE TABLE "conversation_pulse" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "next_eval_at" TIMESTAMPTZ(6) NOT NULL,
    "last_user_at" TIMESTAMPTZ(6),
    "last_spoke_at" TIMESTAMPTZ(6),
    "quiet_streak" INTEGER NOT NULL DEFAULT 0,
    "spoken_date_key" TEXT,
    "spoken_today" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "conversation_pulse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_conversation_pulse_next_eval" ON "conversation_pulse"("next_eval_at");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_pulse_account_conv_key" ON "conversation_pulse"("account_id", "conversation_id");

