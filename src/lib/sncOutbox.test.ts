// @ts-nocheck -- node:test suite; runs under --experimental-strip-types.
import assert from "node:assert/strict";
import test from "node:test";

import {
  isLocalId,
  newLocalId,
  queueTrash,
  replayOutbox,
  upsertCreate,
} from "./sncOutbox.ts";

const mkCreate = (tempId, content, extra = {}) => ({
  kind: "create",
  tempId,
  content,
  tags: ["from-osai"],
  folderId: null,
  ts: 1,
  ...extra,
});

test("local ids are recognizable and unique", () => {
  const a = newLocalId();
  const b = newLocalId();
  assert.ok(isLocalId(a));
  assert.notEqual(a, b);
  assert.equal(isLocalId("6f9619ff-8b86-d011-b42d-00c04fc964ff"), false);
});

test("upsertCreate coalesces edits into ONE op per local note", () => {
  let ops = upsertCreate([], mkCreate("local-1", "first"));
  ops = upsertCreate(ops, mkCreate("local-1", "first + more typing"));
  ops = upsertCreate(ops, mkCreate("local-2", "another note"));
  assert.equal(ops.length, 2);
  assert.equal(ops[0].content, "first + more typing");
  assert.equal(ops[1].tempId, "local-2");
});

test("trashing a local doc cancels its queued create entirely", () => {
  let ops = upsertCreate([], mkCreate("local-1", "draft"));
  ops = queueTrash(ops, "local-1");
  assert.deepEqual(ops, []);
});

test("trashing a real doc queues once (idempotent)", () => {
  let ops = queueTrash([], "real-id");
  ops = queueTrash(ops, "real-id");
  assert.equal(ops.length, 1);
  assert.equal(ops[0].kind, "trash");
});

test("replay: successes drain in order and report created docs by tempId", async () => {
  const calls = [];
  const ops = [
    mkCreate("local-1", "note one"),
    { kind: "trash", id: "old-id", ts: 2 },
    mkCreate("local-2", "note two"),
  ];
  const res = await replayOutbox(ops, {
    create: async (seed) => {
      calls.push(["create", seed.content]);
      return { id: `real-${calls.length}`, content: seed.content };
    },
    trash: async (id) => calls.push(["trash", id]),
    isTransportError: () => false,
  });
  assert.deepEqual(res.remaining, []);
  assert.equal(res.created.get("local-1").id, "real-1");
  assert.equal(res.created.get("local-2").content, "note two");
  assert.deepEqual(calls, [
    ["create", "note one"],
    ["trash", "old-id"],
    ["create", "note two"],
  ]);
});

test("replay: a transport failure HALTS and keeps the rest in order", async () => {
  const ops = [
    mkCreate("local-1", "lands"),
    mkCreate("local-2", "network dies here"),
    { kind: "trash", id: "later", ts: 3 },
  ];
  let n = 0;
  const res = await replayOutbox(ops, {
    create: async (seed) => {
      n++;
      if (n === 2) throw new Error("offline");
      return { id: "real-1" };
    },
    trash: async () => {
      throw new Error("must not run after the halt");
    },
    isTransportError: () => true,
  });
  assert.equal(res.created.size, 1);
  assert.equal(res.remaining.length, 2);
  assert.equal(res.remaining[0].tempId, "local-2");
  assert.equal(res.remaining[1].kind, "trash");
});

test("replay: server-side rejections drop the op instead of wedging the queue", async () => {
  const ops = [{ kind: "trash", id: "already-gone", ts: 1 }, mkCreate("local-1", "ok")];
  const res = await replayOutbox(ops, {
    create: async () => ({ id: "real-1" }),
    trash: async () => {
      throw new Error("Not found"); // 404 — it's already gone, mission accomplished
    },
    isTransportError: () => false,
  });
  assert.deepEqual(res.remaining, []);
  assert.equal(res.created.size, 1);
});
