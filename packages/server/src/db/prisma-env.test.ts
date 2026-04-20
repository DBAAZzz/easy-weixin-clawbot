import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { ensurePrismaUrls } from "./prisma-env.js";

const ORIGINAL_ENV = {
  DATABASE_URL: process.env.DATABASE_URL,
  DIRECT_URL: process.env.DIRECT_URL,
};

afterEach(() => {
  restoreEnv("DATABASE_URL", ORIGINAL_ENV.DATABASE_URL);
  restoreEnv("DIRECT_URL", ORIGINAL_ENV.DIRECT_URL);
});

describe("ensurePrismaUrls", () => {
  it("returns configured DATABASE_URL and DIRECT_URL", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@host:5432/app";
    process.env.DIRECT_URL = "postgresql://user:pass@host:5432/app_direct";

    const result = ensurePrismaUrls();

    assert.equal(result.databaseUrl, process.env.DATABASE_URL);
    assert.equal(result.directUrl, process.env.DIRECT_URL);
  });

  it("throws when DATABASE_URL is missing", () => {
    delete process.env.DATABASE_URL;
    process.env.DIRECT_URL = "postgresql://user:pass@host:5432/app_direct";

    assert.throws(
      () => ensurePrismaUrls(),
      /Missing required Prisma environment variable: DATABASE_URL/,
    );
  });

  it("throws when DIRECT_URL is missing", () => {
    process.env.DATABASE_URL = "postgresql://user:pass@host:5432/app";
    delete process.env.DIRECT_URL;

    assert.throws(
      () => ensurePrismaUrls(),
      /Missing required Prisma environment variable: DIRECT_URL/,
    );
  });
});

function restoreEnv(name: "DATABASE_URL" | "DIRECT_URL", value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
