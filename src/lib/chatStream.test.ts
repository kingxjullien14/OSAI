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

test("a sub-agent Task tool_use keeps run_in_background + parentId on its turn", () => {
  // classification (isBackgroundAgent) + nesting (parentId) both read straight off
  // the tool turn's copied input/envelope — lock that the reducer preserves them.
  const bg = reduceChatStreamEvent(
    { turns: [], streamingTurnId: null, thinkingTurnId: null },
    {
      type: "assistant",
      message: {
        content: [
          {
            type: "tool_use",
            id: "ag-1",
            name: "Agent",
            input: { description: "build", subagent_type: "builder", run_in_background: true },
          },
        ],
      },
    },
    { now: 0, uid },
  ).state;
  assert.equal(bg.turns[0].input.run_in_background, true);

  // a child event tagged with the parent Task's id → parentId on the child turn.
  const child = reduceChatStreamEvent(
    bg,
    {
      type: "assistant",
      parent_tool_use_id: "ag-1",
      message: { content: [{ type: "tool_use", id: "c-1", name: "Edit", input: { file_path: "x.html" } }] },
    },
    { now: 1, uid },
  ).state;
  assert.equal(child.turns[1].parentId, "ag-1");
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

test("a new content block settles the open thinking turn mid-stream", () => {
  n = 0;
  let s = reduceChatStreamEvent(
    { turns: [], streamingTurnId: null, thinkingTurnId: null },
    {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "pondering" } },
    },
    { now: 100, uid },
  ).state;
  assert.equal(s.turns[0].kind, "thinking");
  assert.equal(s.turns[0].streaming, true);
  // a web_search (or any next block) begins → the thought settles immediately,
  // not at turn end (the server-tool "all thinking" bug)
  s = reduceChatStreamEvent(
    s,
    { type: "stream_event", event: { type: "content_block_start", content_block: { type: "server_tool_use" } } },
    { now: 1600, uid },
  ).state;
  assert.equal(s.turns[0].streaming, false);
  assert.equal(s.turns[0].durationMs, 1500);
  assert.equal(s.thinkingTurnId, null);
});

test("a replayed text user event becomes a user bubble (reattach fidelity)", () => {
  n = 0;
  // the reattach buffer carries the user's own recorded lines (chat.rs
  // buffer_line) — without a bubble the transcript replays answers-only and
  // the branching UI hides everything behind a phantom ‹N/M› switcher.
  const s = reduceChatStreamEvent(
    { turns: [], streamingTurnId: null, thinkingTurnId: null },
    {
      type: "user",
      message: { role: "user", content: [{ type: "text", text: "hello there" }] },
    },
    { now: 5, uid },
  );
  assert.equal(s.handled, true);
  assert.equal(s.state.turns.length, 1);
  assert.deepEqual(
    { kind: s.state.turns[0].kind, text: s.state.turns[0].text },
    { kind: "user", text: "hello there" },
  );
});

test("a replayed user event with osai_image_ref blocks restores thumbnails", () => {
  n = 0;
  const s = reduceChatStreamEvent(
    { turns: [], streamingTurnId: null, thinkingTurnId: null },
    {
      type: "user",
      message: {
        role: "user",
        content: [
          { type: "osai_image_ref", path: "C:/tmp/shot.png" },
          { type: "text", text: "what is this?" },
        ],
      },
    },
    { now: 5, uid },
  );
  assert.equal(s.state.turns.length, 1);
  const turn = s.state.turns[0];
  assert.equal(turn.kind, "user");
  assert.deepEqual(turn.images, ["C:/tmp/shot.png"]);
  assert.equal(turn.text, "what is this?");
});

test("a tool_result user event still fills its tool card, not a bubble", () => {
  n = 0;
  const withTool = {
    turns: [{ kind: "tool", id: "tu1", name: "Bash", input: {} }],
    streamingTurnId: null,
    thinkingTurnId: null,
  };
  const s = reduceChatStreamEvent(
    withTool,
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tu1", content: "ok" }],
      },
    },
    { now: 5, uid },
  );
  assert.equal(s.state.turns.length, 1, "no extra bubble");
  assert.equal(s.state.turns[0].result, "ok");
});

test("replayHistoryToTurns restores image refs on user turns", () => {
  n = 0;
  const lines = [
    `{"type":"user","message":{"role":"user","content":[{"type":"osai_image_ref","path":"/tmp/a.png"},{"type":"text","text":"look"}]},"_ts":1000}`,
  ];
  const turns = replayHistoryToTurns(lines, uid);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].kind, "user");
  assert.deepEqual(turns[0].images, ["/tmp/a.png"]);
});

test("sub-agent (parent_tool_use_id) text/thinking/user events stay OUT of the main transcript", () => {
  n = 0;
  // assistant text + thinking from a Task child → no top-level bubbles
  let s = reduceChatStreamEvent(
    { turns: [], streamingTurnId: null, thinkingTurnId: null },
    {
      type: "assistant",
      parent_tool_use_id: "task-1",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "child prose" },
          { type: "thinking", thinking: "child thought" },
          { type: "tool_use", id: "child-tu", name: "WebSearch", input: {} },
        ],
      },
    },
    { now: 1, uid },
  );
  assert.equal(s.state.turns.length, 1, "only the nested tool turn survives");
  assert.equal(s.state.turns[0].kind, "tool");
  assert.equal(s.state.turns[0].parentId, "task-1");

  // the Task prompt echoed as the child's user message → no YOU bubble
  s = reduceChatStreamEvent(
    s.state,
    {
      type: "user",
      parent_tool_use_id: "task-1",
      message: { role: "user", content: [{ type: "text", text: "research brief…" }] },
    },
    { now: 2, uid },
  );
  assert.equal(s.state.turns.length, 1, "no phantom user bubble");

  // replay path: same guard
  const turns = replayHistoryToTurns(
    [
      `{"type":"user","parent_tool_use_id":"task-1","message":{"role":"user","content":[{"type":"text","text":"brief"}]},"_ts":10}`,
      `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"real user"}]},"_ts":11}`,
    ],
    uid,
  );
  assert.equal(turns.length, 1);
  assert.equal(turns[0].kind, "user");
  assert.equal(turns[0].text, "real user");
});

test("fast local streams: desynced delta ref self-heals; full-text settle coalesces fragments", () => {
  n = 0;
  // delta 1 opens the streaming turn
  let s = reduceChatStreamEvent(
    { turns: [], streamingTurnId: null, thinkingTurnId: null },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "Hello! How can I" } } },
    { now: 1, uid },
  );
  // delta 2 arrives with a DESYNCED ref (null) — must append, not split
  s = reduceChatStreamEvent(
    { ...s.state, streamingTurnId: null },
    { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: " help you today?" } } },
    { now: 2, uid },
  );
  assert.equal(s.state.turns.length, 1, "no mid-sentence split");
  assert.equal(s.state.turns[0].text, "Hello! How can I help you today?");

  // simulate a REAL split (two fragments) + the authoritative full-text event:
  // the fragments must coalesce into ONE settled turn, no duplicate.
  const split = {
    turns: [
      { kind: "assistant", id: "a1", text: "Hello! How can I", streaming: true },
      { kind: "assistant", id: "a2", text: " help you today?", streaming: true },
    ],
    streamingTurnId: null,
    thinkingTurnId: null,
  };
  const settled = reduceChatStreamEvent(
    split,
    {
      type: "assistant",
      message: { role: "assistant", content: [{ type: "text", text: "Hello! How can I help you today?" }] },
    },
    { now: 3, uid },
  );
  assert.equal(settled.state.turns.length, 1, "fragments coalesced");
  assert.equal(settled.state.turns[0].text, "Hello! How can I help you today?");
  assert.equal(settled.state.turns[0].streaming, false);
});
