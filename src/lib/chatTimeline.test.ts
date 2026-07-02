// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  markerStyle,
  nearestTick,
  dayBoundaries,
  fmtTickTime,
} from "./chatTimeline.ts";

test("markerStyle keys color + major off kind/error", () => {
  assert.equal(markerStyle("result", true).color, "var(--color-danger)");
  assert.equal(markerStyle("user", false).major, true);
  assert.equal(markerStyle("change", false).color, "var(--color-success)");
  assert.equal(markerStyle("compaction", false).color, "var(--color-info)");
  assert.equal(markerStyle("assistant", false).major, false);
  assert.equal(markerStyle("activity", false).color, "var(--color-border-strong)");
});

test("nearestTick finds the closest tick by frac", () => {
  const ticks = [{ frac: 0 }, { frac: 0.5 }, { frac: 0.9 }];
  assert.equal(nearestTick(ticks, 0.46), ticks[1]);
  assert.equal(nearestTick(ticks, 0.95), ticks[2]);
  assert.equal(nearestTick([], 0.5), null);
});

test("dayBoundaries marks ticks that start a new day, skipping null times", () => {
  // local-time construction (dateGroup/dayBoundaries bucket by LOCAL day) so the
  // test is timezone-independent — a UTC literal could cross local midnight.
  const d1 = new Date(2026, 5, 16, 10, 0).getTime(); // Jun 16 (local)
  const d1b = new Date(2026, 5, 16, 18, 0).getTime(); // Jun 16 (local)
  const d2 = new Date(2026, 5, 17, 9, 0).getTime(); // Jun 17 (local)
  const ticks = [{ at: d1 }, { at: null }, { at: d1b }, { at: d2 }];
  // index 3 (d2) starts a new day vs d1b; nulls don't anchor
  assert.deepEqual(dayBoundaries(ticks), [3]);
});

test("fmtTickTime is empty for null, non-empty for a real time", () => {
  assert.equal(fmtTickTime(null), "");
  const now = new Date("2026-06-17T12:00:00Z").getTime();
  const today = fmtTickTime(new Date("2026-06-17T09:00:00Z").getTime(), now);
  assert.ok(today.length > 0 && /\d/.test(today));
  const older = fmtTickTime(new Date("2026-06-10T09:00:00Z").getTime(), now);
  // a different day carries a date portion (a comma separates date + time)
  assert.ok(older.includes(","));
});
