// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import { parseConductor, planIsEmpty } from "./conductor.ts";

test("the plan's headline sentence parses into an ordered plan", () => {
  const steps = parseConductor(
    "split right with a browser on github.com, run npm run dev, and ask claude to wire it up",
  );
  assert.deepEqual(steps, [
    { kind: "spawn", pane: "browser", url: "https://github.com" },
    { kind: "run", cmd: "npm run dev" },
    { kind: "ask", text: "wire it up" },
  ]);
});

test("ask tails keep their 'and' clauses (repair pass)", () => {
  const steps = parseConductor("ask claude to wire it up and test it");
  assert.deepEqual(steps, [{ kind: "ask", text: "wire it up and test it" }]);
});

test("run commands stay verbatim and chain their folded tails", () => {
  assert.deepEqual(parseConductor("run cargo check"), [{ kind: "run", cmd: "cargo check" }]);
  // an unparseable continuation folds into the command as && (still literal)
  assert.deepEqual(parseConductor("run npm install and start the day"), [
    { kind: "run", cmd: "npm install && start the day" },
  ]);
});

test("pane nouns spawn; browser picks up urls; full urls survive", () => {
  assert.deepEqual(parseConductor("open a terminal and a files pane"), [
    { kind: "spawn", pane: "terminal" },
    { kind: "spawn", pane: "files" },
  ]);
  assert.deepEqual(parseConductor("add a browser at https://docs.rs/windows"), [
    { kind: "spawn", pane: "browser", url: "https://docs.rs/windows" },
  ]);
  assert.deepEqual(parseConductor("open the pet"), [{ kind: "spawn", pane: "pet" }]);
});

test("workspaces apply only when the name actually exists", () => {
  const ctx = { workspaces: ["ship", "research"] };
  assert.deepEqual(parseConductor("switch to ship mode", ctx), [
    { kind: "workspace", name: "ship" },
  ]);
  assert.deepEqual(parseConductor("workspace research", ctx), [
    { kind: "workspace", name: "research" },
  ]);
  // no such workspace → unknown, NOT a false apply
  const miss = parseConductor("switch to warp mode", ctx);
  assert.equal(miss[0].kind, "unknown");
});

test("theme, home, and empty plans", () => {
  assert.deepEqual(parseConductor("theme dark"), [{ kind: "theme", theme: "dark" }]);
  assert.deepEqual(parseConductor("switch to light mode"), [
    { kind: "theme", theme: "light" },
  ]);
  assert.deepEqual(parseConductor("go home"), [{ kind: "home" }]);
  assert.deepEqual(parseConductor("close everything"), [{ kind: "home" }]);
  assert.equal(planIsEmpty(parseConductor("hmm let me think")), true);
  assert.equal(planIsEmpty(parseConductor("open a terminal")), false);
  assert.deepEqual(parseConductor(""), []);
});
