#!/usr/bin/env node
/**
 * Assert the committed model catalog is intact.
 *
 * Catches the two failure modes that no test would: a data file edited by hand
 * (its content hash stops matching the manifest), and a partially written
 * catalog from an interrupted generator run.
 *
 * It deliberately does NOT check freshness against models.dev — that would make
 * CI fail whenever upstream adds a model, which is not a defect in this repo.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readModelDataStructure, validateModelDataDirectory } from "./model-data.js";

const dataDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src/llm/data");

try {
  validateModelDataDirectory(readModelDataStructure(dataDir), dataDir);
  console.log("Generated model data is valid.");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error("\nRun `pnpm -F @clawbot/agent generate:models` to regenerate.");
  process.exitCode = 1;
}
