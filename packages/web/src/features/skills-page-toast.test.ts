import assert from "node:assert/strict";
import test from "node:test";

test("notifySkillInstallSuccess emits the upload success toast message", async () => {
  const { notifySkillInstallSuccess } = await import("./SkillsPage.js");
  const messages: string[] = [];

  assert.equal(typeof notifySkillInstallSuccess, "function");

  notifySkillInstallSuccess("local-rag", (message) => {
    messages.push(message);
  });

  assert.deepEqual(messages, ['技能 "local-rag" 安装成功']);
});
