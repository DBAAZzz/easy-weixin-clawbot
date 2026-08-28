import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { isDuplicateMessageSequenceError } from "./messages.js";

function uniqueError(target: string | string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("unique conflict", {
    code: "P2002",
    clientVersion: Prisma.prismaVersion.client,
    meta: { target },
  });
}

test("only the legacy message sequence conflict is tolerated", () => {
  assert.equal(
    isDuplicateMessageSequenceError(uniqueError(["account_id", "conversation_id", "seq"])),
    true,
  );
  assert.equal(
    isDuplicateMessageSequenceError(uniqueError("messages_account_id_conversation_id_seq_key")),
    true,
  );
  assert.equal(isDuplicateMessageSequenceError(uniqueError(["event_id"])), false);
  assert.equal(isDuplicateMessageSequenceError(uniqueError(["message_id"])), false);
});
