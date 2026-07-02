// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  makeWorkSession,
  upsertWorkSession,
  removeFromList,
  sortByRecency,
  touchInList,
  patchInList,
  bindChatInList,
} from "./workSessions.ts";

test("makeWorkSession trims the title, defaults fields, dedups chat ids, stamps active", () => {
  const s = makeWorkSession(
    { title: "  Ship WRMS login fix  ", goal: "  ", chatSessionIds: ["c1", "c1", "c2", ""] },
    "ws_1",
    1000,
  );
  assert.equal(s.title, "Ship WRMS login fix");
  assert.equal(s.goal, undefined, "blank goal → undefined");
  assert.deepEqual(s.chatSessionIds, ["c1", "c2"]);
  assert.deepEqual(s.panes, []);
  assert.equal(s.tracks, null);
  assert.equal(s.createdAt, 1000);
  assert.equal(s.lastActiveAt, 1000);
  assert.equal(s.status, "active");
});

test("makeWorkSession falls back to 'untitled session' on an empty title", () => {
  assert.equal(makeWorkSession({ title: "   " }, "ws_x", 0).title, "untitled session");
});

test("upsertWorkSession adds new sessions at the front", () => {
  const a = makeWorkSession({ title: "a" }, "a", 1);
  const b = makeWorkSession({ title: "b" }, "b", 2);
  const list = upsertWorkSession(upsertWorkSession([], a), b);
  assert.deepEqual(list.map((s) => s.id), ["b", "a"]);
});

test("upsertWorkSession replaces by id and preserves the original createdAt", () => {
  const a = makeWorkSession({ title: "a" }, "a", 100);
  const updated = { ...a, title: "a2", createdAt: 999, lastActiveAt: 200 };
  const [only] = upsertWorkSession([a], updated);
  assert.equal(only.title, "a2");
  assert.equal(only.createdAt, 100, "createdAt is sticky on replace");
  assert.equal(only.lastActiveAt, 200);
});

test("removeFromList drops the matching session", () => {
  const a = makeWorkSession({ title: "a" }, "a", 1);
  const b = makeWorkSession({ title: "b" }, "b", 2);
  assert.deepEqual(removeFromList([a, b], "a").map((s) => s.id), ["b"]);
});

test("sortByRecency orders most-recently-active first (non-mutating)", () => {
  const a = { ...makeWorkSession({ title: "a" }, "a", 1), lastActiveAt: 10 };
  const b = { ...makeWorkSession({ title: "b" }, "b", 2), lastActiveAt: 30 };
  const c = { ...makeWorkSession({ title: "c" }, "c", 3), lastActiveAt: 20 };
  const input = [a, b, c];
  assert.deepEqual(sortByRecency(input).map((s) => s.id), ["b", "c", "a"]);
  assert.deepEqual(input.map((s) => s.id), ["a", "b", "c"], "input untouched");
});

test("touchInList bumps lastActiveAt and revives a done session", () => {
  const done = { ...makeWorkSession({ title: "a" }, "a", 1), status: "done", lastActiveAt: 1 };
  const [t] = touchInList([done], "a", 500);
  assert.equal(t.lastActiveAt, 500);
  assert.equal(t.status, "active", "done → active on touch");
  // a paused session keeps its status
  const paused = { ...makeWorkSession({ title: "b" }, "b", 1), status: "paused" };
  assert.equal(touchInList([paused], "b", 9)[0].status, "paused");
});

test("patchInList shallow-merges and bumps lastActiveAt", () => {
  const a = makeWorkSession({ title: "a" }, "a", 1);
  const [p] = patchInList([a], "a", { goal: "new goal", status: "paused" }, 42);
  assert.equal(p.goal, "new goal");
  assert.equal(p.status, "paused");
  assert.equal(p.lastActiveAt, 42);
  assert.equal(p.createdAt, 1, "createdAt untouched");
});

test("bindChatInList appends a chat id, dedups, and is a no-op when already bound", () => {
  const a = makeWorkSession({ title: "a", chatSessionIds: ["c1"] }, "a", 1);
  const once = bindChatInList([a], "a", "c2", 5);
  assert.deepEqual(once[0].chatSessionIds, ["c1", "c2"]);
  const twice = bindChatInList(once, "a", "c2", 6);
  assert.deepEqual(twice[0].chatSessionIds, ["c1", "c2"], "no duplicate");
  assert.equal(twice[0].lastActiveAt, 6);
});
