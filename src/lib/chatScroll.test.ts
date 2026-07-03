// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  distanceFromBottom,
  nextAutoscrollPaused,
  shouldAutoscroll,
} from "./chatScroll.ts";

test("distanceFromBottom measures how far the viewport is from the live bottom", () => {
  assert.equal(
    distanceFromBottom({ scrollHeight: 1200, scrollTop: 900, clientHeight: 280 }),
    20,
  );
});

test("shouldAutoscroll only pins when already at the bottom and not paused", () => {
  assert.equal(
    shouldAutoscroll(
      { scrollHeight: 1200, scrollTop: 900, clientHeight: 300 },
      false,
    ),
    true,
  );
  assert.equal(
    shouldAutoscroll(
      { scrollHeight: 1200, scrollTop: 860, clientHeight: 300 },
      false,
    ),
    false,
  );
  assert.equal(
    shouldAutoscroll(
      { scrollHeight: 1200, scrollTop: 900, clientHeight: 300 },
      true,
    ),
    false,
  );
});

test("shouldAutoscroll keeps streaming pinned when content grows from the bottom", () => {
  assert.equal(
    shouldAutoscroll(
      {
        previousScrollHeight: 1200,
        scrollHeight: 1340,
        scrollTop: 900,
        clientHeight: 300,
      },
      false,
    ),
    true,
  );
});

test("nextAutoscrollPaused pauses on manual scroll up and resumes only at bottom", () => {
  assert.equal(
    nextAutoscrollPaused(
      false,
      { scrollHeight: 1400, scrollTop: 960, clientHeight: 300 },
      "up",
    ),
    true,
  );
  assert.equal(
    nextAutoscrollPaused(
      true,
      { scrollHeight: 1400, scrollTop: 960, clientHeight: 300 },
      "down",
    ),
    true,
  );
  assert.equal(
    nextAutoscrollPaused(
      true,
      { scrollHeight: 1400, scrollTop: 1100, clientHeight: 300 },
      "down",
    ),
    false,
  );
});

test("riding down into the bottom zone re-latches from the WIDE window", () => {
  // distance 50px: inside the 96px stick window. An explicit DOWN intent
  // re-arms following (mid-stream the bottom is a moving target — the crisp
  // 8px made "scroll back down to resume" nearly impossible to hit)…
  assert.equal(
    nextAutoscrollPaused(
      true,
      { scrollHeight: 1400, scrollTop: 1050, clientHeight: 300 },
      "down",
    ),
    false,
  );
  // …but a passive/unknown intent at the same spot does NOT unpause (only the
  // crisp threshold applies — content growth must never silently re-latch).
  assert.equal(
    nextAutoscrollPaused(
      true,
      { scrollHeight: 1400, scrollTop: 1050, clientHeight: 300 },
      "unknown",
    ),
    true,
  );
});
