// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  ROOT,
  childrenOf,
  activeChildId,
  activePath,
  siblingPosition,
  addNode,
  selectBranch,
  stepBranch,
  activeMessages,
} from "./chatTree.ts";

// helper: a node carrying a string label as its value.
const n = (id, parentId, value = id) => ({ id, parentId, value });
const ids = (path) => path.map((x) => x.id);

test("childrenOf + activeChildId: default is the NEWEST child", () => {
  const nodes = [n("u1", null), n("a1", "u1"), n("a2", "u1")];
  assert.deepEqual(childrenOf(nodes, "u1").map((x) => x.id), ["a1", "a2"]);
  assert.deepEqual(childrenOf(nodes, null).map((x) => x.id), ["u1"]);
  // no selection → latest (a2); explicit + valid → that; stale → latest.
  assert.equal(activeChildId(nodes, {}, "u1"), "a2");
  assert.equal(activeChildId(nodes, { u1: "a1" }, "u1"), "a1");
  assert.equal(activeChildId(nodes, { u1: "gone" }, "u1"), "a2");
  assert.equal(activeChildId(nodes, {}, "a2"), null); // leaf
});

test("activePath walks the active chain to the leaf", () => {
  const nodes = [n("u1", null), n("a1", "u1"), n("u2", "a1"), n("a3", "u2")];
  assert.deepEqual(ids(activePath(nodes, {})), ["u1", "a1", "u2", "a3"]);
});

test("regenerate fork: default follows the newest answer; selection pins an older one", () => {
  // u1 → a1 ; u1 → a2 (regenerated). Both are leaves.
  const nodes = [n("u1", null), n("a1", "u1"), n("a2", "u1")];
  assert.deepEqual(ids(activePath(nodes, {})), ["u1", "a2"], "newest answer by default");
  assert.deepEqual(ids(activePath(nodes, { u1: "a1" })), ["u1", "a1"], "pin the first answer");
  assert.deepEqual(siblingPosition(nodes, "a1"), { index: 0, count: 2 });
  assert.deepEqual(siblingPosition(nodes, "a2"), { index: 1, count: 2 });
  assert.deepEqual(siblingPosition(nodes, "u1"), { index: 0, count: 1 }, "not a branch point");
});

test("HEADLINE: branches keep INDEPENDENT continuations (swap, then continue ≠ other branch)", () => {
  // u1 ─┬─ a1 ─ u2 ─ a3      (branch A, continued)
  //     └─ a2 ─ u4 ─ a5      (branch B, continued)  ← a2 is the newer fork
  const nodes = [
    n("u1", null),
    n("a1", "u1"),
    n("u2", "a1"),
    n("a3", "u2"),
    n("a2", "u1"),
    n("u4", "a2"),
    n("a5", "u4"),
  ];
  // default = newest fork (a2) + ITS continuation, never branch A's turns.
  assert.deepEqual(ids(activePath(nodes, {})), ["u1", "a2", "u4", "a5"]);
  // swap to branch A → ITS continuation only (u2/a3), never B's (u4/a5).
  const sel = selectBranch(nodes, {}, "a1");
  assert.deepEqual(ids(activePath(nodes, sel)), ["u1", "a1", "u2", "a3"]);
});

test("selectBranch + stepBranch move the active sibling (clamped)", () => {
  const nodes = [n("u1", null), n("a1", "u1"), n("a2", "u1"), n("a3", "u1")];
  // start at default (a3, index 2). prev → a2, prev → a1, prev clamps at a1.
  let sel = stepBranch(nodes, {}, "a3", -1);
  assert.equal(activeChildId(nodes, sel, "u1"), "a2");
  sel = stepBranch(nodes, sel, "a2", -1);
  assert.equal(activeChildId(nodes, sel, "u1"), "a1");
  sel = stepBranch(nodes, sel, "a1", -1);
  assert.equal(activeChildId(nodes, sel, "u1"), "a1", "clamped at the first");
  // next from a1 → a2.
  sel = stepBranch(nodes, sel, "a1", 1);
  assert.equal(activeChildId(nodes, sel, "u1"), "a2");
  // selectBranch by id is direct.
  assert.equal(activeChildId(nodes, selectBranch(nodes, {}, "a1"), "u1"), "a1");
  // unknown node → selection unchanged.
  assert.deepEqual(stepBranch(nodes, { u1: "a1" }, "nope", 1), { u1: "a1" });
});

test("addNode appends immutably; ROOT-level forks are switchable", () => {
  const base = [n("u1", null)];
  const nodes = addNode(base, n("u1b", null)); // an edited FIRST message → root fork
  assert.equal(base.length, 1, "input not mutated");
  assert.deepEqual(ids(activePath(nodes, {})), ["u1b"], "newest root by default");
  assert.deepEqual(ids(activePath(nodes, { [ROOT]: "u1" })), ["u1"], "pin the original root");
});

test("activeMessages projects the active path + drops nulls", () => {
  const nodes = [n("u1", null, "hi"), n("a1", "u1", "yo"), n("sys", "a1", null)];
  const msgs = activeMessages(nodes, {}, (v) => (v == null ? null : { text: v }));
  assert.deepEqual(msgs, [{ text: "hi" }, { text: "yo" }]);
});

test("empty forest → empty path + messages", () => {
  assert.deepEqual(activePath([], {}), []);
  assert.deepEqual(activeMessages([], {}, (v) => v), []);
  assert.deepEqual(siblingPosition([], "x"), { index: 0, count: 0 });
});
