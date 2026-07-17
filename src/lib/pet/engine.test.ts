// @ts-nocheck -- node:test suite; runs under --experimental-strip-types.
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyCare,
  createSoul,
  flavorOf,
  moodOf,
  parseSoul,
  recordOutcome,
  stageOf,
  suggestActivity,
  tick,
  TUNING,
} from "./engine.ts";

const T0 = 1_750_000_000_000; // fixed epoch — the engine never reads the clock
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

test("createSoul: balanced start, born now, tick-anchored", () => {
  const s = createSoul(T0);
  assert.equal(s.bornAt, T0);
  assert.equal(s.lastTick, T0);
  assert.ok(s.needs.energy > 50 && s.needs.fullness > 50 && s.needs.spirits > 50);
  assert.equal(s.bond, 0);
});

test("tick: idempotent for non-advancing time", () => {
  const s = createSoul(T0);
  assert.equal(tick(s, { now: T0 }), s);
  assert.equal(tick(s, { now: T0 - HOUR }), s);
});

test("tick: rest recovers energy, metabolism burns fullness", () => {
  const s = createSoul(T0);
  const later = tick({ ...s, needs: { ...s.needs, energy: 40 } }, { now: T0 + 4 * HOUR });
  assert.ok(later.needs.energy > 40, "resting recovers energy");
  assert.ok(later.needs.fullness < s.needs.fullness, "metabolism burns food");
});

test("tick: working together burns energy, night rest recovers faster", () => {
  const s = createSoul(T0);
  const worked = tick(s, { now: T0 + 2 * HOUR, activeMinutes: 120 });
  assert.ok(worked.needs.energy < s.needs.energy, "active hours cost energy");

  const dayRest = tick({ ...s, needs: { ...s.needs, energy: 30 } }, { now: T0 + 3 * HOUR });
  const nightRest = tick(
    { ...s, needs: { ...s.needs, energy: 30 } },
    { now: T0 + 3 * HOUR, isNight: true },
  );
  assert.ok(nightRest.needs.energy > dayRest.needs.energy, "night sleep restores more");
});

test("tick: neglect saddens but never kills (floors + bounded absence)", () => {
  const s = createSoul(T0);
  const abandoned = tick(s, { now: T0 + 30 * DAY });
  assert.ok(abandoned.needs.fullness >= TUNING.fullnessFloor, "self-foraging floor");
  assert.ok(abandoned.needs.energy >= TUNING.energyFloor, "energy floor");
  // and the mood reads as neglect, not death
  const mood = moodOf(abandoned);
  assert.ok(["hungry", "sleepy", "grumpy", "content", "sick"].includes(mood));
});

test("tick: agent outcomes move spirits (wins up, failures down, both capped)", () => {
  const s = createSoul(T0);
  const wins = tick(s, { now: T0 + HOUR, agentFinished: 3 });
  const losses = tick(s, { now: T0 + HOUR, agentFailed: 3 });
  assert.ok(wins.needs.spirits > losses.needs.spirits);
  const spam = tick(s, { now: T0 + HOUR, agentFinished: 500 });
  const capped = tick(s, { now: T0 + HOUR, agentFinished: 5 });
  assert.equal(spam.needs.spirits, capped.needs.spirits, "win spam is capped per tick");
});

test("recordOutcome: tallies totals (no time gate) + nudges spirits", () => {
  const s = createSoul(T0);
  // no-op guard
  assert.equal(recordOutcome(s, {}), s);
  // a finished run counts once and lifts spirits
  const won = recordOutcome(s, { finished: 1 });
  assert.equal(won.totals.celebrations, s.totals.celebrations + 1);
  assert.ok(won.needs.spirits > s.needs.spirits);
  // a failure counts + dents spirits
  const lost = recordOutcome(s, { failed: 1 });
  assert.equal(lost.totals.startles, s.totals.startles + 1);
  assert.ok(lost.needs.spirits < s.needs.spirits);
  // CRITICAL: unlike tick, recordOutcome never drops rapid same-instant events —
  // ten runs in one tick window each count (the old counter lost these).
  let acc = s;
  for (let i = 0; i < 10; i++) acc = recordOutcome(acc, { finished: 1 });
  assert.equal(acc.totals.celebrations, s.totals.celebrations + 10);
  // spirits response is capped per call (a big batch can't swing morale wildly)
  const spam = recordOutcome(s, { finished: 500 });
  const capped = recordOutcome(s, { finished: 5 });
  assert.equal(spam.needs.spirits, capped.needs.spirits);
});

test("tick: surface minutes accumulate affinity; unknown surfaces ignored", () => {
  const s = createSoul(T0);
  const next = tick(s, {
    now: T0 + HOUR,
    surfaceMinutes: { terminal: 40, chat: 10, bogus: 99 },
  });
  assert.equal(next.affinity.terminal, 40);
  assert.equal(next.affinity.chat, 10);
  assert.ok(!("bogus" in next.affinity));
});

test("applyCare: feeding fills, cooldown spam yields a fraction", () => {
  const s = { ...createSoul(T0), needs: { energy: 70, fullness: 40, spirits: 60 } };
  const fed = applyCare(s, { kind: "feed", now: T0 });
  assert.equal(fed.needs.fullness, 40 + TUNING.feedAmount);
  const spammed = applyCare(fed, { kind: "feed", now: T0 + 60_000 }); // 1min later
  assert.equal(
    spammed.needs.fullness,
    fed.needs.fullness + TUNING.feedAmount * TUNING.cooldownYield,
  );
  const patient = applyCare(fed, { kind: "feed", now: T0 + (TUNING.feedCooldownMin + 1) * 60_000 });
  assert.equal(patient.needs.fullness, Math.min(100, fed.needs.fullness + TUNING.feedAmount));
});

test("applyCare: play trades energy for spirits; petting is a gentle lift", () => {
  const s = { ...createSoul(T0), needs: { energy: 70, fullness: 60, spirits: 50 } };
  const played = applyCare(s, { kind: "play", now: T0 });
  assert.ok(played.needs.spirits > s.needs.spirits);
  assert.ok(played.needs.energy < s.needs.energy);
  const petted = applyCare(s, { kind: "pet", now: T0 });
  assert.equal(petted.needs.spirits, s.needs.spirits + TUNING.petSpirits);
});

test("bond: monotonic — grows with care + shared hours, never decays", () => {
  let s = createSoul(T0);
  s = applyCare(s, { kind: "pet", now: T0 });
  const afterCare = s.bond;
  assert.ok(afterCare > 0);
  s = tick(s, { now: T0 + 10 * DAY }); // long absence
  assert.ok(s.bond >= afterCare, "absence never erodes bond");
  const shared = tick(s, { now: T0 + 10 * DAY + 2 * HOUR, activeMinutes: 120 });
  assert.ok(shared.bond > s.bond, "shared active time grows bond");
});

test("moodOf: the ladder reads sensibly", () => {
  const base = createSoul(T0);
  assert.equal(moodOf({ ...base, needs: { energy: 80, fullness: 70, spirits: 90 } }), "ecstatic");
  assert.equal(moodOf({ ...base, needs: { energy: 80, fullness: 70, spirits: 70 } }), "happy");
  assert.equal(moodOf({ ...base, needs: { energy: 80, fullness: 20, spirits: 60 } }), "hungry");
  assert.equal(moodOf({ ...base, needs: { energy: 15, fullness: 70, spirits: 60 } }), "sleepy");
  assert.equal(
    moodOf({ ...base, needs: { energy: 80, fullness: 70, spirits: 60 } }, { isNight: false }),
    "content",
  );
  assert.equal(
    moodOf({ ...base, needs: { energy: 50, fullness: 70, spirits: 60 } }, { isNight: true }),
    "sleepy",
  );
  assert.equal(moodOf({ ...base, needs: { energy: 16, fullness: 13, spirits: 40 } }), "sick");
});

test("stageOf: age AND bond gate together", () => {
  const s = createSoul(T0);
  assert.equal(stageOf(s, T0), "hatchling");
  // old but unloved → still capped
  assert.equal(stageOf({ ...s, bond: 0 }, T0 + 30 * DAY), "hatchling");
  // loved but young → capped by age
  assert.equal(stageOf({ ...s, bond: 100 }, T0 + 1 * DAY), "hatchling");
  assert.equal(stageOf({ ...s, bond: 100 }, T0 + 3 * DAY), "sprout");
  assert.equal(stageOf({ ...s, bond: 30 }, T0 + 8 * DAY), "adept");
  assert.equal(stageOf({ ...s, bond: 60 }, T0 + 22 * DAY), "elder");
});

test("flavorOf: dominant surface at adept+, share-gated", () => {
  const s = { ...createSoul(T0), bond: 30 };
  const young = { ...s, affinity: { ...s.affinity, terminal: 500 } };
  assert.equal(flavorOf(young, T0 + 1 * DAY), null, "no flavor before adept");
  const adeptAt = T0 + 8 * DAY;
  const dominant = { ...s, affinity: { terminal: 500, chat: 100, browser: 0, files: 0, notes: 0 } };
  assert.equal(flavorOf(dominant, adeptAt), "terminal");
  const spread = { ...s, affinity: { terminal: 100, chat: 100, browser: 100, files: 100, notes: 100 } };
  assert.equal(flavorOf(spread, adeptAt), null, "an even spread has no flavor");
});

test("suggestActivity: sleeps when it must, wanders when it can", () => {
  const s = createSoul(T0);
  assert.equal(suggestActivity({ ...s, needs: { energy: 10, fullness: 60, spirits: 60 } }), "sleep");
  // joy = energetic wandering — celebrate is a transient reaction pose only
  // (a steady celebration loop reads as a stuck animation; owner report).
  assert.equal(suggestActivity({ ...s, needs: { energy: 80, fullness: 70, spirits: 90 } }), "wander");
  assert.equal(suggestActivity({ ...s, needs: { energy: 80, fullness: 70, spirits: 60 } }), "wander");
  assert.equal(suggestActivity({ ...s, needs: { energy: 40, fullness: 70, spirits: 60 } }), "idle");
  // night is bedtime even on a full battery (night rest keeps energy high,
  // so an energy-only gate would let it party until morning).
  assert.equal(
    suggestActivity({ ...s, needs: { energy: 80, fullness: 70, spirits: 60 } }, { isNight: true }),
    "sleep",
  );
});

test("parseSoul: round-trips a real soul, rejects junk, clamps corruption", () => {
  const s = applyCare(tick(createSoul(T0), { now: T0 + HOUR, activeMinutes: 30 }), {
    kind: "feed",
    now: T0 + HOUR,
  });
  const revived = parseSoul(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(revived, s);

  assert.equal(parseSoul(null), null);
  assert.equal(parseSoul("pet"), null);
  assert.equal(parseSoul({ version: 2, bornAt: T0, needs: {} }), null);

  const corrupted = parseSoul({
    version: 1,
    bornAt: T0,
    needs: { energy: 9999, fullness: -50, spirits: "high" },
    bond: 12345,
    affinity: { terminal: -3, chat: 7 },
  });
  assert.ok(corrupted);
  assert.equal(corrupted.needs.energy, 100);
  assert.equal(corrupted.needs.fullness, 0);
  assert.equal(corrupted.bond, 100);
  assert.equal(corrupted.affinity.terminal, 0);
  assert.equal(corrupted.affinity.chat, 7);
});
