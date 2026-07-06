// @ts-nocheck -- node:test suite; runs under --experimental-strip-types.
import assert from "node:assert/strict";
import test from "node:test";

import {
  diff3Merge,
  hasConflictMarkers,
  MARK_OURS,
  MARK_SEP,
  MARK_THEIRS,
} from "./sncMerge.ts";

const BASE = ["# groceries", "", "- milk", "- eggs", "- bread", "", "done by friday"].join("\n");

test("no divergence: identical sides short-circuit clean", () => {
  assert.deepEqual(diff3Merge(BASE, BASE, BASE), { clean: true, text: BASE });
  const edited = BASE + "\n- butter";
  // ours == theirs (same edit landed twice)
  assert.deepEqual(diff3Merge(BASE, edited, edited), { clean: true, text: edited });
});

test("one-sided edits take that side wholesale", () => {
  const ours = BASE.replace("- milk", "- oat milk");
  assert.deepEqual(diff3Merge(BASE, ours, BASE), { clean: true, text: ours });
  const theirs = BASE.replace("- bread", "- sourdough");
  assert.deepEqual(diff3Merge(BASE, BASE, theirs), { clean: true, text: theirs });
});

test("non-overlapping edits from both sides merge clean (the D6 promise)", () => {
  const ours = BASE.replace("- milk", "- oat milk"); // top edit here
  const theirs = BASE.replace("done by friday", "done by saturday"); // bottom edit on the phone
  const merged = diff3Merge(BASE, ours, theirs);
  assert.equal(merged.clean, true);
  assert.ok(merged.text.includes("- oat milk"));
  assert.ok(merged.text.includes("done by saturday"));
  assert.ok(!merged.text.includes("- milk\n"));
});

test("insertions on both sides in different places merge clean", () => {
  const ours = BASE.replace("- eggs", "- eggs\n- cheese");
  const theirs = "prep list\n" + BASE;
  const merged = diff3Merge(BASE, ours, theirs);
  assert.equal(merged.clean, true);
  assert.ok(merged.text.startsWith("prep list\n"));
  assert.ok(merged.text.includes("- cheese"));
});

test("identical change on both sides is not a conflict", () => {
  const both = BASE.replace("- eggs", "- free-range eggs");
  const merged = diff3Merge(BASE, both, both.replace("friday", "friday")); // same text
  assert.equal(merged.clean, true);
  assert.ok(merged.text.includes("free-range eggs"));
});

test("overlapping edits conflict with git-style markers", () => {
  const ours = BASE.replace("- eggs", "- duck eggs");
  const theirs = BASE.replace("- eggs", "- quail eggs");
  const merged = diff3Merge(BASE, ours, theirs);
  assert.equal(merged.clean, false);
  assert.equal(merged.conflicts, 1);
  assert.ok(merged.text.includes(MARK_OURS));
  assert.ok(merged.text.includes(MARK_SEP));
  assert.ok(merged.text.includes(MARK_THEIRS));
  assert.ok(merged.text.includes("- duck eggs"));
  assert.ok(merged.text.includes("- quail eggs"));
  // untouched regions survive outside the conflict block
  assert.ok(merged.text.includes("# groceries"));
  assert.ok(merged.text.includes("done by friday"));
});

test("delete vs edit of the same region conflicts (never silently drops)", () => {
  const ours = BASE.replace("- bread\n", ""); // we deleted the line
  const theirs = BASE.replace("- bread", "- rye bread"); // they edited it
  const merged = diff3Merge(BASE, ours, theirs);
  assert.equal(merged.clean, false);
  assert.ok(merged.text.includes("- rye bread"));
});

test("both appending different tails conflicts (same anchor point)", () => {
  const ours = BASE + "\n- coffee";
  const theirs = BASE + "\n- tea";
  const merged = diff3Merge(BASE, ours, theirs);
  assert.equal(merged.clean, false);
  assert.ok(merged.text.includes("- coffee"));
  assert.ok(merged.text.includes("- tea"));
});

test("empty base: two fresh drafts of the same note conflict, one-sided is clean", () => {
  const a = diff3Merge("", "hello", "");
  assert.deepEqual(a, { clean: true, text: "hello" });
  const b = diff3Merge("", "hello", "world");
  assert.equal(b.clean, false);
});

test("multiple separate conflicts are each fenced and counted", () => {
  const ours = BASE.replace("- milk", "- oat milk").replace("done by friday", "done by monday");
  const theirs = BASE.replace("- milk", "- soy milk").replace("done by friday", "done by sunday");
  const merged = diff3Merge(BASE, ours, theirs);
  assert.equal(merged.clean, false);
  assert.equal(merged.conflicts, 2);
  assert.equal(merged.text.split(MARK_SEP).length, 3); // two ======= separators
  // the stable middle stayed outside both blocks
  assert.ok(merged.text.includes("- bread"));
});

test("hasConflictMarkers detects real blocks only", () => {
  const conflicted = diff3Merge(BASE, BASE.replace("- eggs", "a"), BASE.replace("- eggs", "b"));
  assert.equal(conflicted.clean, false);
  assert.equal(hasConflictMarkers(conflicted.text), true);
  assert.equal(hasConflictMarkers(BASE), false);
  assert.equal(hasConflictMarkers("<<<<<<< this device"), false); // no closing fence
});
