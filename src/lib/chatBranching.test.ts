// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";
import {
  computeResponseVariants,
  activeVariantIndex,
  hiddenVariantTurnIds,
  ROOT_USER,
} from "./chatBranching.ts";

// shorthand turn builders
const u = (id: string) => ({ kind: "user", id });
const a = (id: string) => ({ kind: "assistant", id });
const r = (id: string) => ({ kind: "result", id });
const tool = (id: string) => ({ kind: "tool", id });

test("a linear conversation gives every prompt exactly one variant", () => {
  const turns = [u("u1"), a("a1"), r("r1"), u("u2"), a("a2"), r("r2")];
  const info = computeResponseVariants(turns);
  assert.equal(info.countByUser.get("u1"), 1);
  assert.equal(info.countByUser.get("u2"), 1);
  assert.deepEqual(info.byTurnId.get("a1"), { userId: "u1", variant: 0 });
  assert.deepEqual(info.byTurnId.get("a2"), { userId: "u2", variant: 0 });
});

test("regenerating the last turn makes a 2nd variant of the SAME prompt", () => {
  // u2 answered, then regenerated (no new user turn between the two responses)
  const turns = [u("u1"), a("a1"), r("r1"), u("u2"), a("a2"), r("r2"), a("a2b"), r("r2b")];
  const info = computeResponseVariants(turns);
  assert.equal(info.countByUser.get("u1"), 1, "u1 untouched");
  assert.equal(info.countByUser.get("u2"), 2, "u2 has two responses");
  assert.deepEqual(info.byTurnId.get("a2"), { userId: "u2", variant: 0 });
  assert.deepEqual(info.byTurnId.get("a2b"), { userId: "u2", variant: 1 });
});

test("multiple regenerates accumulate variants in order", () => {
  const turns = [u("u1"), a("v0"), r("r0"), a("v1"), r("r1"), a("v2"), r("r2")];
  const info = computeResponseVariants(turns);
  assert.equal(info.countByUser.get("u1"), 3);
  assert.equal(info.byTurnId.get("v0")!.variant, 0);
  assert.equal(info.byTurnId.get("v1")!.variant, 1);
  assert.equal(info.byTurnId.get("v2")!.variant, 2);
});

test("a multi-block response (thinking/tools/prose) stays one variant until a result", () => {
  const turns = [u("u1"), a("think"), tool("t1"), a("prose"), r("done")];
  const info = computeResponseVariants(turns);
  assert.equal(info.countByUser.get("u1"), 1);
  for (const id of ["think", "t1", "prose", "done"]) {
    assert.equal(info.byTurnId.get(id)!.variant, 0);
  }
});

test("a still-streaming regenerate (no result yet) already counts as the 2nd variant", () => {
  const turns = [u("u1"), a("a0"), r("r0"), a("a1streaming")];
  const info = computeResponseVariants(turns);
  assert.equal(info.countByUser.get("u1"), 2);
  assert.equal(info.byTurnId.get("a1streaming")!.variant, 1);
});

test("turns before the first user bucket under ROOT_USER", () => {
  const info = computeResponseVariants([a("boot"), u("u1"), a("a1"), r("r1")]);
  assert.equal(info.byTurnId.get("boot")!.userId, ROOT_USER);
});

test("activeVariantIndex defaults to the latest and clamps an out-of-range pick", () => {
  assert.equal(activeVariantIndex({}, "u2", 3), 2, "unset → latest");
  assert.equal(activeVariantIndex({ u2: 0 }, "u2", 3), 0, "explicit honored");
  assert.equal(activeVariantIndex({ u2: 9 }, "u2", 3), 2, "clamped high");
  assert.equal(activeVariantIndex({ u2: -4 }, "u2", 3), 0, "clamped low");
});

test("hiddenVariantTurnIds hides every non-active variant, never a single-variant prompt", () => {
  const turns = [u("u1"), a("a1"), r("r1"), u("u2"), a("a2"), r("r2"), a("a2b"), r("r2b")];
  const info = computeResponseVariants(turns);
  // default (latest active = variant 1 for u2): variant 0 of u2 is hidden
  const hiddenDefault = hiddenVariantTurnIds(info, {});
  assert.ok(hiddenDefault.has("a2") && hiddenDefault.has("r2"), "old response hidden");
  assert.ok(!hiddenDefault.has("a2b") && !hiddenDefault.has("r2b"), "fresh response shown");
  assert.ok(!hiddenDefault.has("a1"), "single-variant prompt never hidden");
  // pin u2 to variant 0: now the fresh response is hidden instead
  const hiddenPinned = hiddenVariantTurnIds(info, { u2: 0 });
  assert.ok(hiddenPinned.has("a2b") && hiddenPinned.has("r2b"));
  assert.ok(!hiddenPinned.has("a2"));
});

test("ROOT_USER runs never become variants (truncated-replay guard)", () => {
  // a replay whose leading user turns were evicted (buffer cap) starts with
  // bare assistant runs — they are sequential context, not regenerate
  // alternates. Variant-ifying them hid the conversation behind a phantom
  // ‹N/M› switcher (the reattach "2/2" bug).
  const turns = [a("a1"), r("r1"), a("a2"), r("r2"), a("a3"), r("r3")];
  const info = computeResponseVariants(turns);
  assert.equal(info.countByUser.get(ROOT_USER), 1, "one 'variant' only");
  for (const id of ["a1", "a2", "a3"]) {
    assert.equal(info.byTurnId.get(id)!.variant, 0);
  }
  // and nothing root-bucketed is ever hidden by the switcher
  assert.equal(hiddenVariantTurnIds(info, {}).size, 0);
});

test("real prompts still variant normally after a truncated root prefix", () => {
  const turns = [a("boot"), r("r0"), u("u1"), a("v0"), r("r1"), a("v1"), r("r2")];
  const info = computeResponseVariants(turns);
  assert.equal(info.countByUser.get(ROOT_USER), 1);
  assert.equal(info.countByUser.get("u1"), 2, "regenerate still works");
});
