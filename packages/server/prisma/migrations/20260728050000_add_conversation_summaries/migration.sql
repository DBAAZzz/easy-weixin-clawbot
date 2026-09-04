
-- CreateTable
CREATE TABLE "conversation_summaries" (
    "id" BIGSERIAL NOT NULL,
    "account_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "seq_start" INTEGER NOT NULL,
    "seq_end" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_version" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_summaries_account_id_conversation_id_seq_end_idx" ON "conversation_summaries"("account_id", "conversation_id", "seq_end");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_summaries_account_id_conversation_id_seq_start_key" ON "conversation_summaries"("account_id", "conversation_id", "seq_start");

