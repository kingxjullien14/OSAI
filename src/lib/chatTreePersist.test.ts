// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import { serializeTree, deserializeTree } from "./chatTreePersist.ts";

const node = (id, parentId) => ({ id, parentId, value: id });
const turn = (id, text) => ({ kind: "user", id, text, streaming: false });

test("serialize → deserialize round-trips structure, selection, and turns", () => {
  const nodes = [node("u1", null), node("a1", "u1"), node("a2", "u1")];
  const sel = { u1: "a1" };
  const byId = new Map([
    ["u1", turn("u1", "hi")],
    ["a1", turn("a1", "ans A")],
    ["a2", turn("a2", "ans B")],
  ]);
  const saved = serializeTree(nodes, sel, byId);
  assert.equal(saved.v, 1);
  assert.deepEqual(saved.selection, { u1: "a1" });
  assert.equal(saved.nodes.length, 3);

  const back = deserializeTree(JSON.stringify(saved));
  assert.deepEqual(back.nodes, nodes);
  assert.deepEqual(back.selection, { u1: "a1" });
  assert.deepEqual(
    back.turns.map((t) => t.text),
    ["hi", "ans A", "ans B"],
  );
});

test("serialize skips nodes whose turn is missing", () => {
  const nodes = [node("u1", null), node("ghost", "u1")];
  const saved = serializeTree(nodes, {}, new Map([["u1", turn("u1", "hi")]]));
  assert.deepEqual(saved.nodes.map((n) => n.id), ["u1"]);
});

test("deserialize rejects empty / invalid / wrong-version", () => {
  assert.equal(deserializeTree(""), null);
  assert.equal(deserializeTree("not json"), null);
  assert.equal(deserializeTree(JSON.stringify({ v: 2, nodes: [], selection: {} })), null);
  assert.equal(deserializeTree(JSON.stringify({ v: 1, nodes: [], selection: {} })), null);
});
