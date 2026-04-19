import assert from "node:assert/strict";
import test from "node:test";
import { formatRuntimeKindLabel, isAutoProvisionableRuntime } from "./skills-runtime-labels.js";

test("formatRuntimeKindLabel renders script-set runtimes explicitly", () => {
  assert.equal(formatRuntimeKindLabel("python-script-set"), "Python Script Set");
  assert.equal(formatRuntimeKindLabel("node-script-set"), "Node Script Set");
});

test("isAutoProvisionableRuntime treats script-set runtimes as auto provisionable", () => {
  assert.equal(isAutoProvisionableRuntime("python-script-set"), true);
  assert.equal(isAutoProvisionableRuntime("node-script-set"), true);
});
