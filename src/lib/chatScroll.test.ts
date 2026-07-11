// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import { atBottom, distanceFromBottom, STICK_THRESHOLD_PX } from "./chatScroll.ts";

test("distanceFromBottom measures how far the viewport is from the live bottom", () => {
  assert.equal(
    distanceFromBottom({ scrollHeight: 1200, scrollTop: 900, clientHeight: 280 }),
    20,
  );
});

test("atBottom is true within the stick threshold, false beyond it", () => {
  // exactly at the bottom (distance 0)
  assert.equal(atBottom({ scrollHeight: 1200, scrollTop: 900, clientHeight: 300 }), true);
  // distance == threshold → still counts as stuck
  assert.equal(
    atBottom({ scrollHeight: 1200, scrollTop: 900 - STICK_THRESHOLD_PX, clientHeight: 300 }),
    true,
  );
  // one px beyond the threshold → detached
  assert.equal(
    atBottom({ scrollHeight: 1200, scrollTop: 900 - STICK_THRESHOLD_PX - 1, clientHeight: 300 }),
    false,
  );
});

test("atBottom honors a custom threshold", () => {
  // distance 100 > 50 → not at bottom
  assert.equal(atBottom({ scrollHeight: 1000, scrollTop: 600, clientHeight: 300 }, 50), false);
  // distance 50 <= 50 → at bottom
  assert.equal(atBottom({ scrollHeight: 1000, scrollTop: 650, clientHeight: 300 }, 50), true);
});
