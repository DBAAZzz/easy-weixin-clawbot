/**
 * Context-window trimming.
 *
 * Every LLM round passes through `fitToContextWindow`, so its failure modes are
 * expensive in both directions: trimming too little blows the provider's window
 * (hard error), trimming carelessly drops a toolResult away from its tool call
 * (provider 400) or silently loses conversation the user can still see.
 *
 * Token counts come from the heuristic estimator (`ceil(chars / 3)` plus 4 per
 * message), so the assertions below are about *relationships and structure*
 * rather than exact numbers — retuning the heuristic should not break them.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { fitToContextWindow } from "../../../src/engine/conversation/context-window.js";
import { withSafetyMargin } from "../../../src/llm/token-estimator.js";
import type {
  AgentMessage,
  AssistantMessage,
  ToolResultMessage,
  TriggerMessage,
  UserMessage,
} from "../../../src/llm/types.js";

function user(text: string): UserMessage {
  return { role: "user", content: text, timestamp: 1 };
}

function userWithImage(text: string, imageBytes: number): UserMessage {
  return {
    role: "user",
    content: [
      { type: "text", text },
      { type: "image", data: "A".repeat(imageBytes), mimeType: "image/png" },
    ],
    timestamp: 1,
  };
}

function assistant(text: string): AssistantMessage {
  return { role: "assistant", content: [{ type: "text", text }], timestamp: 1, stopReason: "stop" };
}

function assistantToolCall(id: string, name: string): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "toolCall", id, name, arguments: { q: "x" } }],
    timestamp: 1,
    stopReason: "toolUse",
  };
}

function toolResult(id: string, name: string, text: string): ToolResultMessage {
  return {
    role: "toolResult",
    toolCallId: id,
    toolName: name,
    content: [{ type: "text", text }],
    isError: false,
    timestamp: 1,
  };
}

/** A budget so large nothing can trigger trimming. */
const ROOMY = { contextWindowTokens: 1_000_000, outputReserveTokens: 0, fixedOverheadTokens: 0 };

/**
 * The invariant the provider enforces: a toolResult may only appear after the
 * assistant turn that called it. A trim that drops the assistant but keeps its
 * results produces a 400 at request time, not a local error.
 */
function assertNoOrphanToolResults(messages: AgentMessage[]): void {
  const openCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "toolCall") openCallIds.add(block.id);
      }
      continue;
    }
    if (message.role === "toolResult") {
      assert.ok(
        openCallIds.has(message.toolCallId),
        `orphan toolResult ${message.toolCallId} kept without its assistant tool call`,
      );
    }
  }
}

// ── Requirements from docs/2026-04-08_15_29_context-window-management.md ──
//
// These assert what trimming is *for*, independently of how it is implemented.
// R1 is the reason the function exists; R2 and R3 are the properties a caller
// relies on without ever thinking about them.

function budgetOf(config: {
  contextWindowTokens: number;
  outputReserveTokens: number;
  fixedOverheadTokens: number;
}): number {
  return config.contextWindowTokens - config.outputReserveTokens - config.fixedOverheadTokens;
}

/**
 * R1: trimming brings history within the budget — §四 Level 2 「从最早的消息开始
 * 丢弃，直到总 token 数 ≤ 预算」.
 *
 * Scope: this is achievable only while there is droppable history in front of
 * the protected recent window. §三 P2 (「保证至少保留最近 2 轮对话」) is the
 * stronger guarantee, so a conversation whose recent turns alone blow the budget
 * stays over budget by design — see the dedicated case further down. This test
 * uses a history where both can be satisfied, which is the normal case.
 */
test("R1: trimming brings history within the budget", () => {
  const config = {
    contextWindowTokens: 900,
    outputReserveTokens: 100,
    fixedOverheadTokens: 100,
  };

  const history: AgentMessage[] = [];
  for (let i = 0; i < 12; i += 1) {
    history.push(user(`question ${i} ${"x".repeat(400)}`));
    history.push(assistant(`answer ${i} ${"y".repeat(400)}`));
  }

  const result = fitToContextWindow(history, config);

  assert.ok(
    withSafetyMargin(result.trimmedTokens) <= budgetOf(config),
    `trimmed to ${result.trimmedTokens} tokens (${withSafetyMargin(result.trimmedTokens)} with margin), ` +
      `budget is ${budgetOf(config)} — the request will still overflow the model's window`,
  );
});

test("R2: trimming never returns more tokens than it was given", () => {
  // A single oversized turn: there is nothing droppable in front of it, which is
  // exactly when a trimmer is most tempted to do something incoherent.
  const history: AgentMessage[] = [user(`one huge turn ${"x".repeat(9_000)}`)];

  const result = fitToContextWindow(history, {
    contextWindowTokens: 500,
    outputReserveTokens: 100,
    fixedOverheadTokens: 100,
  });

  assert.ok(
    result.trimmedTokens <= result.originalTokens,
    `trimming grew the history from ${result.originalTokens} to ${result.trimmedTokens} tokens`,
  );
});

test("R3: the truncation notice is only added when something was actually truncated", () => {
  const history: AgentMessage[] = [user(`one huge turn ${"x".repeat(9_000)}`)];

  const result = fitToContextWindow(history, {
    contextWindowTokens: 500,
    outputReserveTokens: 100,
    fixedOverheadTokens: 100,
  });

  const head = result.messages[0] as UserMessage;
  const notice = typeof head.content === "string" ? head.content : "";
  assert.doesNotMatch(
    notice,
    /以上 0 条/,
    "a '0 messages omitted' notice is a synthetic message the user never sent and the model must not read as context",
  );
  if (result.droppedMessageCount === 0) {
    assert.deepEqual(
      result.messages,
      history,
      "nothing was dropped, so the history should have been left alone",
    );
  }
});

test("history that already fits is passed through unchanged", () => {
  const history = [user("hello"), assistant("hi"), user("how are you")];

  const result = fitToContextWindow(history, ROOMY);

  assert.equal(result.trimLevel, 0);
  assert.equal(result.droppedMessageCount, 0);
  assert.equal(result.trimmedTokens, result.originalTokens);
  // Content equality, not array identity: whether the implementation reuses the
  // input array is its own business — what a caller depends on is that an
  // under-budget history reaches the model exactly as it was.
  assert.deepEqual(result.messages, history);
});

test("level 1 degrades images in older turns and leaves recent turns intact", () => {
  const history: AgentMessage[] = [
    userWithImage("old screenshot", 6_000),
    assistant("noted"),
    user("second question"),
    assistant("answered"),
    userWithImage("current screenshot", 300),
  ];

  // Roomy enough for the degraded history, far too small for the raw one.
  const result = fitToContextWindow(history, {
    contextWindowTokens: 400,
    outputReserveTokens: 50,
    fixedOverheadTokens: 50,
  });

  assert.equal(result.trimLevel, 1);
  assert.equal(result.droppedMessageCount, 0);
  assert.equal(result.messages.length, history.length);
  assert.ok(result.trimmedTokens < result.originalTokens);

  const degraded = result.messages[0] as UserMessage;
  assert.ok(Array.isArray(degraded.content));
  assert.equal(
    (degraded.content as Array<{ type: string }>).some((b) => b.type === "image"),
    false,
    "the old image should have been replaced by a placeholder",
  );

  // The image inside the protected recent turns survives — degrading it would
  // break the very request the user just made.
  const recent = result.messages[4] as UserMessage;
  assert.ok((recent.content as Array<{ type: string }>).some((b) => b.type === "image"));
});

test("level 1 does not mutate the caller's history", () => {
  const original = userWithImage("old screenshot", 6_000);
  const history: AgentMessage[] = [original, assistant("noted"), user("q"), assistant("a"), user("q2")];

  fitToContextWindow(history, {
    contextWindowTokens: 400,
    outputReserveTokens: 50,
    fixedOverheadTokens: 50,
  });

  assert.equal(history[0], original);
  assert.ok(
    (original.content as Array<{ type: string }>).some((b) => b.type === "image"),
    "the source message must still hold its image — history is shared, live state",
  );
});

test("level 2 drops the oldest messages and announces how many", () => {
  const history: AgentMessage[] = [];
  for (let i = 0; i < 12; i += 1) {
    history.push(user(`question ${i} ${"x".repeat(400)}`));
    history.push(assistant(`answer ${i} ${"y".repeat(400)}`));
  }

  const result = fitToContextWindow(history, {
    contextWindowTokens: 900,
    outputReserveTokens: 100,
    fixedOverheadTokens: 100,
  });

  assert.equal(result.trimLevel, 2);
  assert.ok(result.droppedMessageCount > 0);
  assert.ok(result.messages.length < history.length);

  const head = result.messages[0] as UserMessage;
  assert.equal(head.role, "user");
  assert.match(head.content as string, /以上 \d+ 条早期对话已省略/);
  // The notice's count is the real number of dropped messages, not a guess.
  assert.match(head.content as string, new RegExp(`以上 ${result.droppedMessageCount} 条`));

  // The tail of the conversation is what survives.
  assert.deepEqual(result.messages.at(-1), history.at(-1));
});

test("level 2 never cuts a toolResult away from the assistant that called it", () => {
  const history: AgentMessage[] = [];
  for (let i = 0; i < 10; i += 1) {
    history.push(user(`turn ${i} ${"x".repeat(300)}`));
    history.push(assistantToolCall(`call-${i}`, "search"));
    history.push(toolResult(`call-${i}`, "search", `result ${i} ${"z".repeat(300)}`));
    history.push(assistant(`summary ${i} ${"y".repeat(300)}`));
  }

  // A single budget only ever produces one cut position, and a history of
  // repeating 4-message groups can make that position land on a group boundary
  // by luck — which would let a broken findSafeCutIndex pass. Sweeping the
  // budget walks the raw cut across every offset within the tool-call group, so
  // the boundary logic is what makes these assertions hold, not the arithmetic.
  let sawLevel2 = false;

  for (let contextWindowTokens = 600; contextWindowTokens <= 3_000; contextWindowTokens += 37) {
    const result = fitToContextWindow(history, {
      contextWindowTokens,
      outputReserveTokens: 100,
      fixedOverheadTokens: 100,
    });

    if (result.trimLevel !== 2) continue;
    sawLevel2 = true;

    assertNoOrphanToolResults(result.messages);
    // First real message after the ellipsis must be a user turn — providers
    // reject a history that opens on an assistant or toolResult.
    assert.equal(
      result.messages[1]?.role,
      "user",
      `history opened on ${result.messages[1]?.role} at contextWindowTokens=${contextWindowTokens}`,
    );
  }

  assert.ok(sawLevel2, "the sweep never reached level 2 — the fixture no longer exercises trimming");
});

test("an impossible budget still preserves the protected recent turns", () => {
  const history: AgentMessage[] = [];
  for (let i = 0; i < 6; i += 1) {
    history.push(user(`question ${i} ${"x".repeat(2_000)}`));
    history.push(assistant(`answer ${i} ${"y".repeat(2_000)}`));
  }

  // Budget is negative once overhead is subtracted: nothing can fit.
  const result = fitToContextWindow(history, {
    contextWindowTokens: 100,
    outputReserveTokens: 60,
    fixedOverheadTokens: 60,
  });

  assert.equal(result.trimLevel, 2);
  // Degenerate input must not yield an empty history or loop forever; the
  // minRecentTurns guarantee outranks the budget.
  assert.ok(result.messages.length >= 2);
  assert.equal(result.messages[1]?.role, "user");
  assert.deepEqual(result.messages.at(-1), history.at(-1));
});

test("minRecentTurns controls how much of the tail is protected from dropping", () => {
  const history: AgentMessage[] = [];
  for (let i = 0; i < 10; i += 1) {
    history.push(user(`question ${i} ${"x".repeat(400)}`));
    history.push(assistant(`answer ${i} ${"y".repeat(400)}`));
  }

  const config = {
    contextWindowTokens: 900,
    outputReserveTokens: 100,
    fixedOverheadTokens: 100,
  };

  const protectedFew = fitToContextWindow(history, { ...config, minRecentTurns: 1 });
  const protectedMany = fitToContextWindow(history, { ...config, minRecentTurns: 5 });

  // Protecting more turns can only ever drop fewer messages.
  assert.ok(protectedMany.droppedMessageCount <= protectedFew.droppedMessageCount);
  assert.ok(protectedMany.messages.length >= protectedFew.messages.length);
});

function trigger(text: string): TriggerMessage {
  return {
    role: "trigger",
    content: [{ type: "text", text }],
    timestamp: 1,
    meta: { kind: "reminder", reminderId: "r-1" },
  };
}

/**
 * A trigger turn is the reason the assistant spoke unprompted. Cutting it away
 * while keeping the reply would leave that reply with no visible cause, so the
 * cut point must be allowed to land on one.
 */
test("R9: trimming may start at a trigger turn", () => {
  const config = {
    contextWindowTokens: 700,
    outputReserveTokens: 100,
    fixedOverheadTokens: 100,
  };

  const history: AgentMessage[] = [];
  for (let i = 0; i < 8; i += 1) {
    history.push(user(`question ${i} ${"x".repeat(400)}`));
    history.push(assistant(`answer ${i} ${"y".repeat(400)}`));
  }
  history.push(trigger("问问他面试结果"));
  history.push(assistant("面试结果怎么样？"));

  const result = fitToContextWindow(history, config);
  const first = result.messages[0];

  assert.ok(
    first.role === "user" || first.role === "trigger",
    `history must start on a user-role turn, got ${first.role}`,
  );

  const triggerKept = result.messages.some((message) => message.role === "trigger");
  const replyKept = result.messages.some(
    (message) => message.role === "assistant" && JSON.stringify(message.content).includes("面试结果怎么样"),
  );
  assert.equal(
    triggerKept,
    replyKept,
    "a proactive reply and the trigger that caused it must be kept or dropped together",
  );
});
