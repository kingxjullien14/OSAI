// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  dateGroup,
  groupByDate,
  monthsAgoCutoff,
  selectForCleanup,
  expiredTrash,
} from "./historyManage.ts";

// Fixed "now": 2026-06-17T12:00:00Z (a Wednesday). Use local-midnight semantics.
const NOW = new Date("2026-06-17T12:00:00Z").getTime();
const secs = (iso: string) => Math.floor(new Date(iso).getTime() / 1000);

test("dateGroup buckets by recency", () => {
  assert.equal(dateGroup(secs("2026-06-17T09:00:00Z"), NOW), "today");
  assert.equal(dateGroup(secs("2026-06-16T09:00:00Z"), NOW), "yesterday");
  assert.equal(dateGroup(secs("2026-06-13T09:00:00Z"), NOW), "this week");
  assert.equal(dateGroup(secs("2026-06-01T09:00:00Z"), NOW), "this month");
  assert.equal(dateGroup(secs("2026-01-01T09:00:00Z"), NOW), "older");
});

test("groupByDate orders groups + preserves within-group order, drops empties", () => {
  const entries = [
    { id: "a", mtime: secs("2026-06-17T10:00:00Z") }, // today
    { id: "b", mtime: secs("2026-01-01T10:00:00Z") }, // older
    { id: "c", mtime: secs("2026-06-17T08:00:00Z") }, // today
  ];
  const groups = groupByDate(entries, NOW);
  assert.deepEqual(
    groups.map((g) => g.group),
    ["today", "older"],
  );
  assert.deepEqual(
    groups[0].entries.map((e) => e.id),
    ["a", "c"],
  );
});

test("selectForCleanup picks old entries and spares starred when keepStarred", () => {
  const cutoff = monthsAgoCutoff(NOW, 3); // older than 3 months
  const entries = [
    { id: "old1", mtime: secs("2026-01-01T00:00:00Z"), starred: false },
    { id: "old2", mtime: secs("2026-01-01T00:00:00Z"), starred: true },
    { id: "recent", mtime: secs("2026-06-10T00:00:00Z"), starred: false },
  ];
  assert.deepEqual(selectForCleanup(entries, cutoff, true), ["old1"]);
  assert.deepEqual(selectForCleanup(entries, cutoff, false), ["old1", "old2"]);
});

test("expiredTrash returns records past the retention window", () => {
  const records = [
    { id: "x", deletedAt: secs("2026-06-01T00:00:00Z") }, // 16 days ago
    { id: "y", deletedAt: secs("2026-06-16T00:00:00Z") }, // 1 day ago
  ];
  assert.deepEqual(expiredTrash(records, NOW, 7), ["x"]);
  assert.deepEqual(expiredTrash(records, NOW, 30), []);
});
