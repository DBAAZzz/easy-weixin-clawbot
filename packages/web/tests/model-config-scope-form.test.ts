import assert from "node:assert/strict";
import test from "node:test";
import {
  buildScopeKey,
  parseScopeSelection,
} from "../src/pages/model-config/configForm.ts";

test("parseScopeSelection maps account scope key to account select state", () => {
  assert.deepEqual(parseScopeSelection("account", "wxid_abc123"), {
    accountId: "wxid_abc123",
    conversationId: "",
  });
});

test("parseScopeSelection maps conversation scope key to account and conversation selects", () => {
  assert.deepEqual(parseScopeSelection("conversation", "wxid_abc123:conv_001"), {
    accountId: "wxid_abc123",
    conversationId: "conv_001",
  });
});

test("buildScopeKey returns global wildcard for global scope", () => {
  assert.equal(buildScopeKey("global", "", ""), "*");
});

test("buildScopeKey returns account id for account scope", () => {
  assert.equal(buildScopeKey("account", "wxid_abc123", ""), "wxid_abc123");
});

test("buildScopeKey returns account and conversation composite for conversation scope", () => {
  assert.equal(
    buildScopeKey("conversation", "wxid_abc123", "conv_001"),
    "wxid_abc123:conv_001",
  );
});
