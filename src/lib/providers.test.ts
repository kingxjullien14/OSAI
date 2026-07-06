// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  API_PROVIDERS,
  apiProvider,
  apiModelByKey,
  isApiModelKey,
  qualifiedKey,
  availableApiModels,
} from "./providers.ts";

test("registry is well-formed: unique ids, non-empty endpoints + models", () => {
  const ids = new Set();
  for (const p of API_PROVIDERS) {
    assert.ok(!ids.has(p.id), `duplicate provider id ${p.id}`);
    ids.add(p.id);
    assert.ok(p.endpoint.startsWith("http"), `${p.id} endpoint`);
    // "local" is the one fully-dynamic provider: its lineup only exists once
    // the launch sweep hears back from the user's server ({endpoint}/models),
    // so an empty static floor is CORRECT there — everywhere else it's a bug.
    if (p.id !== "local") assert.ok(p.models.length > 0, `${p.id} has models`);
    const modelIds = new Set();
    for (const m of p.models) {
      assert.ok(!modelIds.has(m.id), `${p.id} duplicate model ${m.id}`);
      modelIds.add(m.id);
      assert.ok(m.contextWindow > 0, `${p.id}/${m.id} ctx`);
    }
  }
  // keyless providers: ollama + the user-endpoint local server (BYOK P1).
  assert.deepEqual(
    API_PROVIDERS.filter((p) => p.keyless).map((p) => p.id),
    ["local", "ollama"],
  );
});

test("apiProvider / apiModelByKey / isApiModelKey resolve correctly", () => {
  assert.equal(apiProvider("anthropic")?.label, "Anthropic");
  assert.equal(apiProvider("nope"), undefined);

  const k = qualifiedKey("anthropic", "claude-opus-4-8");
  assert.equal(k, "anthropic:claude-opus-4-8");
  const q = apiModelByKey(k);
  assert.equal(q?.providerId, "anthropic");
  assert.equal(q?.model.label, "Claude Opus 4.8");
  assert.ok(isApiModelKey(k));

  assert.equal(apiModelByKey("anthropic:does-not-exist"), undefined);
  assert.equal(apiModelByKey("no-colon"), undefined);
  assert.equal(isApiModelKey("garbage"), false);
});

test("composite key splits on the FIRST colon (openrouter ids contain '/')", () => {
  const k = qualifiedKey("openrouter", "anthropic/claude-3.7-sonnet");
  assert.equal(k, "openrouter:anthropic/claude-3.7-sonnet");
  const q = apiModelByKey(k);
  assert.equal(q?.providerId, "openrouter");
  assert.equal(q?.model.id, "anthropic/claude-3.7-sonnet");
});

test("availableApiModels gates on configured keys; ollama is always present", () => {
  const none = availableApiModels(new Set());
  assert.ok(none.length > 0, "ollama models show with no keys");
  assert.ok(none.every((q) => q.providerId === "ollama"), "only keyless without keys");

  const withAnthropic = availableApiModels(new Set(["anthropic"]));
  const provIds = new Set(withAnthropic.map((q) => q.providerId));
  assert.ok(provIds.has("anthropic"), "anthropic unlocked by its key");
  assert.ok(provIds.has("ollama"), "ollama still present");
  assert.ok(!provIds.has("openai"), "openai stays locked");

  const all = availableApiModels(new Set(["anthropic", "openai", "openrouter"]));
  assert.deepEqual(
    new Set(all.map((q) => q.providerId)),
    new Set(["openrouter", "anthropic", "openai", "ollama"]),
  );
});
