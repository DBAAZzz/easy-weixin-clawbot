import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PrismaContextCompilerShadowRolloutStore } from "../../src/db/context-compiler-shadow-rollout-store.js";

test("missing context compiler rollout is disabled by default", async () => {
  const prisma = {
    contextCompilerShadowRollout: {
      async findUnique() {
        return null;
      },
    },
  } as unknown as PrismaClient;
  assert.equal(
    await new PrismaContextCompilerShadowRolloutStore(prisma).isEnabled("account-1"),
    false,
  );
});

test("explicit context compiler rollout enables startup composition", async () => {
  const prisma = {
    contextCompilerShadowRollout: {
      async findUnique() {
        return { enabled: true };
      },
    },
  } as unknown as PrismaClient;
  assert.equal(
    await new PrismaContextCompilerShadowRolloutStore(prisma).isEnabled("account-1"),
    true,
  );
});
