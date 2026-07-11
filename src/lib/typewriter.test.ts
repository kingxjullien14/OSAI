// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import { revealCps, revealStep, TYPEWRITER } from "./typewriter.ts";

test("revealCps scales with backlog and clamps to [min, max]", () => {
  // a tiny backlog floors at the gentle minimum
  assert.equal(revealCps(1, true), TYPEWRITER.minCps);
  // a huge backlog caps at the fast maximum (never a runaway)
  assert.equal(revealCps(1_000_000, true), TYPEWRITER.maxCps);
  // between the bounds it grows with the backlog
  assert.ok(revealCps(200, true) > revealCps(50, true));
  // a finished stream drains FASTER than a live one at the same backlog
  assert.ok(revealCps(500, false) > revealCps(500, true));
});

test("revealStep always progresses while there is a backlog and never overshoots", () => {
  assert.equal(revealStep(0, 0.016, true), 0); // nothing pending → reveal nothing
  assert.ok(revealStep(5, 0.000_001, true, 0.5) >= 1); // even a micro-frame reveals ≥1
  assert.equal(revealStep(3, 10, true, 0.5), 3); // a long frame is capped at the backlog
});

test("revealStep jitter widens/narrows the step around the neutral rate", () => {
  const dt = 0.1;
  const lo = revealStep(2000, dt, true, 0); // factor 0.8
  const mid = revealStep(2000, dt, true, 0.5); // factor 1.0
  const hi = revealStep(2000, dt, true, 1); // factor 1.2
  assert.ok(lo <= mid && mid <= hi);
  assert.ok(hi > lo);
});
