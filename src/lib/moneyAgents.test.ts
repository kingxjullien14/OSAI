// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  MONEY_AGENTS,
  buildMoneyAgentChatSeed,
  buildMoneyAgentRunCommand,
  createMoneyAgent,
  loadCustomMoneyAgents,
  loadMoneyAgentChatSession,
  saveMoneyAgentChatSession,
  summarizeMoneyAgentState,
} from "./moneyAgents.ts";

function withLocalStorage(fn) {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
  try {
    fn(store);
  } finally {
    delete globalThis.localStorage;
  }
}

test("the shell ships with no built-in agents and no stranger identity", () => {
  assert.deepEqual(MONEY_AGENTS, []);
  withLocalStorage(() => {
    const agent = createMoneyAgent({ label: "research scout", mission: "find leads" });
    const seed = buildMoneyAgentChatSeed(agent);
    assert.match(seed, /you are the aios research scout agent/);
    assert.match(seed, /mission: find leads/);
    assert.match(seed, /first task:/);
    assert.match(seed, /do not ask the user/);
    assert.doesNotMatch(seed, /firaz/i);
    assert.doesNotMatch(seed, /gpt-5\.3-codex-spark/);
  });
});

test("created agents derive paths from the runtime home, never a baked-in one", () => {
  withLocalStorage((store) => {
    const agent = createMoneyAgent({ label: "ops", mission: "keep things green" });
    assert.doesNotMatch(agent.statePath, /firazfhansurie/);
    assert.doesNotMatch(agent.stdoutPath, /Library\/Logs/);
    // storage holds only the user's inputs — derived paths re-resolve at load.
    const stored = JSON.parse(store.get("aios.chatAgents.custom"));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].statePath, undefined);
    assert.equal(stored[0].stdoutPath, undefined);
    const loaded = loadCustomMoneyAgents();
    assert.equal(loaded.length, 1);
    assert.match(loaded[0].statePath, /\.aios[\\/]state[\\/]chat-agents[\\/]ops[\\/]status\.json$/);
  });
});

test("stored agents pointing at the original developer's machine self-heal", () => {
  withLocalStorage((store) => {
    store.set(
      "aios.chatAgents.custom",
      JSON.stringify([
        {
          id: "legacy",
          label: "legacy",
          mission: "old agent",
          statePath: "/Users/firazfhansurie/.aios/state/chat-agents/legacy/status.json",
          cwd: "/Users/firazfhansurie/Repo/firaz",
        },
      ]),
    );
    const [agent] = loadCustomMoneyAgents();
    assert.doesNotMatch(agent.statePath, /firazfhansurie/);
    assert.doesNotMatch(agent.cwd, /firazfhansurie/);
  });
});

test("money agent chat sessions persist by agent id", () => {
  withLocalStorage(() => {
    saveMoneyAgentChatSession("growth", {
      sessionId: "claude-agent-session",
      title: "growth agents",
      updatedAt: 123,
    });

    assert.deepEqual(loadMoneyAgentChatSession("growth"), {
      sessionId: "claude-agent-session",
      title: "growth agents",
      updatedAt: 123,
    });
    assert.equal(loadMoneyAgentChatSession("outreach"), null);
  });
});

test("summarizeMoneyAgentState reports neutral goal-oriented status for any agent", () => {
  withLocalStorage(() => {
    const config = {
      id: "growth",
      label: "growth agents",
      shortLabel: "growth",
      launchdLabel: "aios.chatpane.growth",
      statePath: "x",
      queuePath: "y",
      stdoutPath: "o",
      stderrPath: "e",
      cwd: "~",
      mission: "grow",
      schedule: "daily",
    };
    const summary = summarizeMoneyAgentState(config, {
      status: { ok: true, drafted: 3, queued: 8 },
      queue: [{ status: "drafted" }],
      launchd: { running: true, lastExit: 0 },
    });
    assert.equal(summary.health, "running");
    assert.equal(summary.primaryMetric, "8 queued");

    // no forced-green special case for any id — health derives from state only.
    const noState = summarizeMoneyAgentState({ ...config, id: "firaz", label: "firaz" }, {});
    assert.equal(noState.health, "unknown");
    assert.doesNotMatch(noState.currentJob, /personal goals/);
  });
});

test("run commands speak the agent's own mission, not a stranger's business", () => {
  const cmd = buildMoneyAgentRunCommand({ label: "scout", mission: "qualify leads" }, "scheduled");
  assert.match(cmd, /run a scheduled pulse for scout/);
  assert.match(cmd, /goal: qualify leads/);
  assert.doesNotMatch(cmd, /firaz/i);
  assert.doesNotMatch(cmd, /sales for aios/);
});
