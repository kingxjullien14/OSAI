// @ts-nocheck -- node:test suite; runs under --experimental-strip-types.
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHandoffPrompt,
  contextWindowFor,
  engineGroupLabel,
} from "./handoff.ts";

test("contextWindowFor: opus is 1M, codex/opencode/others fall to their windows", () => {
  assert.equal(contextWindowFor({ id: "claude-opus-4-8", label: "opus", engine: "claude" }), 1_000_000);
  assert.equal(contextWindowFor({ id: "gpt-5.5", label: "gpt", engine: "codex" }), 400_000);
  assert.equal(contextWindowFor({ id: "some-codex-thing", label: "x", engine: "codex" }), 272_000);
  assert.equal(contextWindowFor({ id: "nemotron", label: "n", engine: "opencode" }), 256_000);
  assert.equal(contextWindowFor({ id: "claude-sonnet-4-6", label: "sonnet", engine: "claude" }), 200_000);
});

test("engineGroupLabel: known engines get friendly names, unknown de-slugged", () => {
  assert.equal(engineGroupLabel("claude"), "Claude (CLI)");
  assert.equal(engineGroupLabel("codex"), "Codex (ChatGPT)");
  assert.equal(engineGroupLabel("openrouter"), "OpenRouter");
  assert.equal(engineGroupLabel("some_new_provider"), "some new provider");
  assert.equal(engineGroupLabel(undefined), "Claude (CLI)");
});

test("buildHandoffPrompt: names the target + engine + id, lists the sections", () => {
  const p = buildHandoffPrompt({ id: "claude-opus-4-8", label: "opus 4.8", engine: "claude" });
  assert.match(p, /opus 4\.8 \(claude \/ claude-opus-4-8\)/);
  assert.match(p, /current objective/);
  assert.match(p, /next best actions/);
  // large-window target → thorough guidance, not the "keep it tight" line
  assert.match(p, /room to be thorough/);
});

test("buildHandoffPrompt: small-window target gets tight guidance + engine flavor", () => {
  const p = buildHandoffPrompt({ id: "gpt-5.4-mini", label: "gpt mini", engine: "codex" });
  assert.match(p, /GPT\/Codex-family/);
});

test("buildHandoffPrompt: file delivery writes HANDOFF.md at the cwd", () => {
  const p = buildHandoffPrompt(
    { id: "claude-sonnet-4-6", label: "sonnet", engine: "claude" },
    { delivery: "file", cwd: "C:/work/app" },
  );
  assert.match(p, /HANDOFF\.md/);
  assert.match(p, /C:\/work\/app/);
});

test("buildHandoffPrompt: chat delivery asks for a self-contained message, no file", () => {
  const p = buildHandoffPrompt({ id: "claude-sonnet-4-6", label: "sonnet", engine: "claude" }, { delivery: "chat" });
  assert.match(p, /self-contained Markdown message/);
  assert.doesNotMatch(p, /HANDOFF\.md/);
});
