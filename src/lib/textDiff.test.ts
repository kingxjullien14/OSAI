// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import { lineDiff, diffStat, wordDiff, refineDiff } from "./textDiff.ts";

test("lineDiff interleaves context, del and add lines", () => {
  const d = lineDiff("a\nb\nc", "a\nB\nc\nd");
  assert.deepEqual(d, [
    { kind: "context", text: "a" },
    { kind: "del", text: "b" },
    { kind: "add", text: "B" },
    { kind: "context", text: "c" },
    { kind: "add", text: "d" },
  ]);
  assert.deepEqual(diffStat(d), { adds: 2, dels: 1 });
});

test("lineDiff with no change is all context", () => {
  const d = lineDiff("x\ny", "x\ny");
  assert.deepEqual(d.map((l) => l.kind), ["context", "context"]);
  assert.deepEqual(diffStat(d), { adds: 0, dels: 0 });
});

test("lineDiff handles a pure insertion in the middle", () => {
  const d = lineDiff("one\ntwo", "one\nMID\ntwo");
  assert.deepEqual(d, [
    { kind: "context", text: "one" },
    { kind: "add", text: "MID" },
    { kind: "context", text: "two" },
  ]);
});

test("lineDiff falls back to del-all/add-all on huge inputs (bounded)", () => {
  const big = Array.from({ length: 600 }, (_, i) => `l${i}`).join("\n");
  const big2 = Array.from({ length: 600 }, (_, i) => `m${i}`).join("\n");
  const d = lineDiff(big, big2);
  // 600×600 = 360k > cap → no LCS, just 600 dels then 600 adds
  assert.equal(d.length, 1200);
  assert.equal(d[0].kind, "del");
  assert.equal(d[1199].kind, "add");
});

test("wordDiff marks only the changed tokens on each side", () => {
  const w = wordDiff("const DIFF_CAP = 14;", "const DIFF_CAP = 28;");
  assert.equal(w.old.filter((s) => s.changed).map((s) => s.text).join(""), "14");
  assert.equal(w.new.filter((s) => s.changed).map((s) => s.text).join(""), "28");
  // the segments reconstruct each full line
  assert.equal(w.old.map((s) => s.text).join(""), "const DIFF_CAP = 14;");
  assert.equal(w.new.map((s) => s.text).join(""), "const DIFF_CAP = 28;");
});

test("refineDiff attaches word segments to a replace pair", () => {
  const refined = refineDiff(lineDiff("const X = 14;", "const X = 28;"));
  const del = refined.find((l) => l.kind === "del");
  const add = refined.find((l) => l.kind === "add");
  assert.ok(del?.segments && add?.segments);
  assert.equal(del.segments.filter((s) => s.changed).map((s) => s.text).join(""), "14");
  assert.equal(add.segments.filter((s) => s.changed).map((s) => s.text).join(""), "28");
});

test("refineDiff leaves a full rewrite (no shared tokens) plain", () => {
  const refined = refineDiff(lineDiff("aaa", "zzz"));
  assert.equal(refined.find((l) => l.kind === "del")?.segments, undefined);
  assert.equal(refined.find((l) => l.kind === "add")?.segments, undefined);
});
