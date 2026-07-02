// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import { sessionUsage, formatTokens, formatAge } from "./sessionUsage.ts";

const U = (id, createdAt) => ({ kind: "user", id, text: "hi", createdAt });
const A = (id, createdAt) => ({ kind: "assistant", id, text: "yo", streaming: false, createdAt });
const R = (id, tokens, text = "done") => ({ kind: "result", id, text, tokens });

test("counts messages + responses, sums tokens, tracks last + earliest start", () => {
  const turns = [U("u1", 1000), A("a1", 1100), R("r1", 500), U("u2", 5000), R("r2", 800), R("r3", 0, "")];
  const u = sessionUsage(turns);
  assert.equal(u.messages, 2);
  assert.equal(u.responses, 2); // r1, r2 have text; r3 is an empty footer → skipped
  assert.equal(u.tokens, 1300);
  assert.equal(u.lastTokens, 800); // r3 carried 0 tokens → lastTokens not overwritten
  assert.equal(u.startedAt, 1000); // earliest createdAt across user+assistant
});

test("empty + timestamp-less sessions stay zero/null, never NaN", () => {
  assert.deepEqual(sessionUsage([]), {
    messages: 0,
    responses: 0,
    tokens: 0,
    lastTokens: 0,
    startedAt: null,
  });
  const u = sessionUsage([{ kind: "user", id: "x", text: "hi" }]); // no createdAt
  assert.equal(u.messages, 1);
  assert.equal(u.startedAt, null);
});

test("formatTokens is compact across magnitudes", () => {
  assert.equal(formatTokens(0), "0");
  assert.equal(formatTokens(-5), "0");
  assert.equal(formatTokens(980), "980");
  assert.equal(formatTokens(1_200), "1.2K");
  assert.equal(formatTokens(12_300), "12.3K");
  assert.equal(formatTokens(125_000), "125K");
  assert.equal(formatTokens(4_500_000), "4.5M");
});

test("formatAge buckets seconds → minutes → hours → days", () => {
  const t0 = 1_000_000;
  assert.equal(formatAge(t0, t0 + 10_000), "just now");
  assert.equal(formatAge(t0, t0 + 5 * 60_000), "5m");
  assert.equal(formatAge(t0, t0 + 80 * 60_000), "1h 20m");
  assert.equal(formatAge(t0, t0 + 3 * 60 * 60_000), "3h");
  assert.equal(formatAge(t0, t0 + 50 * 60 * 60_000), "2d 2h");
  assert.equal(formatAge(null, t0), "");
  assert.equal(formatAge(t0, t0 - 5), "");
});
