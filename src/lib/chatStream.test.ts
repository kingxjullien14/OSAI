// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  detectCompaction,
  finalizeStreamingTurns,
  reduceChatStreamEvent,
  replayHistoryToTurns,
} from "./chatStream.ts";

let n = 0;
const uid = () => `t${++n}`;

test("reduceChatStreamEvent appends text deltas into one streaming assistant turn", () => {
  n = 0;
  const first = reduceChatStreamEvent(
    { turns: [], streamingTurnId: null, thinkingTurnId: null },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "hel" } } },
    { now: 100, uid },
  ).state;
  const second = reduceChatStreamEvent(
    first,
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "lo" } } },
    { now: 110, uid },
  ).state;

  assert.deepEqual(second.turns, [{ kind: "assistant", id: "t1", text: "hello", streaming: true }]);
  assert.equal(second.streamingTurnId, "t1");
});

test("reduceChatStreamEvent settles thinking and adds tool cards on assistant final", () => {
  n = 0;
  const thinking = reduceChatStreamEvent(
    { turns: [], streamingTurnId: null, thinkingTurnId: null },
    {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "checking" } },
    },
    { now: 100, uid },
  ).state;
  const final = reduceChatStreamEvent(
    thinking,
    {
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", id: "tool-1", name: "Read", input: { file_path: "src/App.tsx" } },
        ],
      },
    },
    { now: 400, uid },
  ).state;

  assert.deepEqual(final.turns, [
    { kind: "thinking", id: "t1", text: "checking", streaming: false, startedAt: 100, durationMs: 300 },
    { kind: "tool", id: "tool-1", name: "Read", input: { file_path: "src/App.tsx" } },
  ]);
  assert.equal(final.streamingTurnId, null);
  assert.equal(final.thinkingTurnId, null);
});

test("reduceChatStreamEvent patches tool results by tool_use_id", () => {
  const state = {
    streamingTurnId: null,
    thinkingTurnId: null,
    turns: [{ kind: "tool", id: "tool-1", name: "Bash", input: { command: "pwd" } }],
  };

  const next = reduceChatStreamEvent(
    state,
    {
      type: "user",
      message: {
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done", is_error: false }],
      },
    },
    { now: 0, uid },
  ).state;

  assert.deepEqual(next.turns, [
    { kind: "tool", id: "tool-1", name: "Bash", input: { command: "pwd" }, result: "done", isError: false },
  ]);
});

test("finalizeStreamingTurns closes live assistant and thinking blocks", () => {
  const next = finalizeStreamingTurns(
    {
      streamingTurnId: "a1",
      thinkingTurnId: "th1",
      turns: [
        { kind: "assistant", id: "a1", text: "hi", streaming: true },
        { kind: "thinking", id: "th1", text: "work", streaming: true, startedAt: 100 },
      ],
    },
    250,
  );

  assert.deepEqual(next, {
    streamingTurnId: null,
    thinkingTurnId: null,
    turns: [
      { kind: "assistant", id: "a1", text: "hi", streaming: false },
      { kind: "thinking", id: "th1", text: "work", streaming: false, startedAt: 100, durationMs: 150 },
    ],
  });
});

test("reduceChatStreamEvent dedupes a re-emitted whole-message assistant event", () => {
  n = 0;
  // some engines (and claude) re-emit the cumulative assistant message as a
  // SECOND `assistant` event after the first cleared streamingTurnId. Without
  // content-level dedup this renders two identical bubbles (the reported bug).
  const msg = {
    type: "assistant",
    message: { content: [{ type: "text", text: "Hi! What can I help you with today?" }] },
  };
  const first = reduceChatStreamEvent(
    { turns: [], streamingTurnId: null, thinkingTurnId: null },
    msg,
    { now: 100, uid },
  ).state;
  const second = reduceChatStreamEvent(first, msg, { now: 110, uid }).state;

  assert.equal(
    second.turns.filter((t) => t.kind === "assistant").length,
    1,
    "the identical re-emitted reply must not create a second bubble",
  );
});

test("reduceChatStreamEvent dedupes a re-emitted thinking block the same way", () => {
  n = 0;
  // the cumulative re-emit carries the thinking block too — without the same
  // dedup the transcript shows two identical "thought" cards (reported bug).
  const msg = {
    type: "assistant",
    message: { content: [{ type: "thinking", thinking: "The user wants an overview." }] },
  };
  const first = reduceChatStreamEvent(
    { turns: [], streamingTurnId: null, thinkingTurnId: null },
    msg,
    { now: 100, uid },
  ).state;
  const second = reduceChatStreamEvent(first, msg, { now: 110, uid }).state;

  assert.equal(
    second.turns.filter((t) => t.kind === "thinking").length,
    1,
    "the identical re-emitted thinking must not create a second thought card",
  );
});

test("replayHistoryToTurns rebuilds a full transcript from stored event lines", () => {
  n = 0;
  const lines = [
    `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}`,
    `{"type":"system","subtype":"init","session_id":"x"}`,
    `{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"hmm"}]}}`,
    `{"type":"assistant","message":{"content":[{"type":"text","text":"hello!"}]}}`,
    `{"type":"assistant","message":{"content":[{"type":"tool_use","id":"tool_1","name":"Read","input":{"file_path":"a.ts"}}]}}`,
    `{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tool_1","content":"file body"}]}}`,
    `{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.1,"duration_ms":900,"result":"hello!"}`,
    `not json — must be skipped`,
  ];
  const shapes = replayHistoryToTurns(lines, uid).map((t) =>
    t.kind === "user"
      ? { kind: t.kind, text: t.text }
      : t.kind === "thinking"
        ? { kind: t.kind, text: t.text }
        : t.kind === "assistant"
          ? { kind: t.kind, text: t.text }
          : t.kind === "tool"
            ? { kind: t.kind, name: t.name, result: t.result }
            : t.kind === "result"
              ? { kind: t.kind, ok: t.ok, cost: t.cost }
              : { kind: t.kind },
  );
  // a text-less SUCCESS result is dropped on replay (its answer is already the
  // assistant bubble; the duration/cost footer is live-only polish). Errors,
  // which carry a message + retry, are kept (covered separately).
  assert.deepEqual(shapes, [
    { kind: "user", text: "hi" },
    { kind: "thinking", text: "hmm" },
    { kind: "assistant", text: "hello!" },
    { kind: "tool", name: "Read", result: "file body" },
  ]);
});

test("replayHistoryToTurns keeps a FAILED result (message + retry) on replay", () => {
  n = 0;
  const turns = replayHistoryToTurns(
    [
      `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"go"}]}}`,
      `{"type":"result","subtype":"error","is_error":true,"result":"boom"}`,
    ],
    uid,
  );
  assert.deepEqual(
    turns.map((t) => ({ kind: t.kind, ...(t.kind === "result" ? { ok: t.ok, text: t.text } : {}) })),
    [{ kind: "user" }, { kind: "result", ok: false, text: "boom" }],
  );
});

test("replayHistoryToTurns returns [] for an empty log", () => {
  assert.deepEqual(replayHistoryToTurns([], uid), []);
});

test("detectCompaction reads compact_boundary metadata, ignores other events", () => {
  assert.equal(detectCompaction({ type: "assistant" }), null);
  assert.equal(detectCompaction({ type: "system", subtype: "init" }), null);
  assert.deepEqual(
    detectCompaction({
      type: "system",
      subtype: "compact_boundary",
      compact_metadata: {
        trigger: "manual",
        pre_tokens: 27843,
        post_tokens: 1911,
        duration_ms: 17777,
      },
    }),
    { trigger: "manual", preTokens: 27843, postTokens: 1911, durationMs: 17777 },
  );
});

test("replayHistoryToTurns renders a compaction card and folds in its summary", () => {
  n = 0;
  const lines = [
    `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"/compact"}]}}`,
    `{"type":"system","subtype":"status","status":"compacting"}`,
    `{"type":"system","subtype":"compact_boundary","compact_metadata":{"trigger":"manual","pre_tokens":27843,"post_tokens":1911,"duration_ms":17777}}`,
    `{"type":"user","isSynthetic":true,"message":{"role":"user","content":"This session is being continued from a previous conversation that ran out of context.\\n\\nSummary:\\nThe user asked about Tauri.\\n\\nIf you need specific details read the transcript."}}`,
    `{"type":"user","isReplay":true,"message":{"role":"user","content":"<local-command-stdout>Compacted </local-command-stdout>"}}`,
    `{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.025,"result":""}`,
  ];
  const turns = replayHistoryToTurns(lines, uid);
  // a /compact bubble + the compaction card; synthetic plumbing + empty result dropped
  assert.deepEqual(
    turns.map((t) => t.kind),
    ["user", "compaction"],
  );
  const card = turns.find((t) => t.kind === "compaction");
  assert.equal(card.preTokens, 27843);
  assert.equal(card.postTokens, 1911);
  assert.equal(card.trigger, "manual");
  assert.match(card.summary, /asked about Tauri/);
  assert.doesNotMatch(card.summary, /being continued/); // preamble stripped
  assert.doesNotMatch(card.summary, /read the transcript/); // trailing stripped
});
