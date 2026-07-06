// @ts-nocheck -- node:test runs these directly (strip-types); repo convention.
import assert from "node:assert/strict";
import test from "node:test";

import {
  agentDoneLine,
  agentErrorLine,
  createVoiceState,
  needLine,
  tryVoice,
  usageLine,
  VOICE_TUNING,
} from "./voice.ts";

const MIN = 60_000;
const T0 = 1_800_000_000_000; // fixed epoch — decisions are pure in `now`

test("voice: first line allowed, then the global gap silences every kind", () => {
  const s0 = createVoiceState();
  const s1 = tryVoice(s0, "error", { now: T0 });
  assert.ok(s1, "a fresh state must allow the first line");
  // a DIFFERENT kind inside the global gap is still silenced
  assert.equal(tryVoice(s1, "done", { now: T0 + MIN }), null);
  // …and allowed once the gap has passed
  assert.ok(tryVoice(s1, "done", { now: T0 + VOICE_TUNING.minGapMin * MIN }));
});

test("voice: per-kind cooldown outlasts the global gap", () => {
  const s1 = tryVoice(createVoiceState(), "error", { now: T0 });
  assert.ok(s1);
  // past the global gap (3m) but inside error's own cooldown (8m) → silent
  assert.equal(tryVoice(s1, "error", { now: T0 + 4 * MIN }), null);
  // at the kind cooldown boundary → allowed again
  assert.ok(tryVoice(s1, "error", { now: T0 + VOICE_TUNING.cooldownMin.error * MIN }));
});

test("voice: quiet / asleep / carried are hard silences that burn no anchors", () => {
  const s = createVoiceState();
  assert.equal(tryVoice(s, "bus", { now: T0, quiet: true }), null);
  assert.equal(tryVoice(s, "bus", { now: T0, asleep: true }), null);
  assert.equal(tryVoice(s, "bus", { now: T0, carried: true }), null);
  // the suppressed attempts left the state untouched → the next free moment speaks
  assert.ok(tryVoice(s, "bus", { now: T0 + 1 }));
});

test("voice: need lines nag only when care can actually help", () => {
  assert.ok(needLine("hungry"));
  assert.ok(needLine("sick"));
  assert.ok(needLine("grumpy"));
  // sleepy pets just go to sleep; good moods stay quiet
  for (const mood of ["sleepy", "content", "happy", "ecstatic"]) {
    assert.equal(needLine(mood), null, `${mood} must not nag`);
  }
});

test("voice: usage + agent lines carry the honest facts", () => {
  assert.match(usageLine("claude", "5h", 88.4, "danger"), /claude 5h at 88% — slow down/);
  assert.match(usageLine("claude", "7d", 71.2, "warning"), /claude 7d running hot \(71%\)/);
  assert.match(agentDoneLine("refactor the parser"), /refactor the parser.*finished/);
  assert.match(agentErrorLine(), /something failed/);
  // long titles trim so the bubble stays a chip
  assert.ok(agentDoneLine("x".repeat(80)).length < 55);
});
