// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  MONEY_AGENTS,
  buildMoneyAgentChatSeed,
  buildMoneyAgentRunCommand,
  createMoneyAgent,
  isMoneyAgentDue,
  loadCustomMoneyAgents,
  loadMoneyAgentChatSession,
  saveMoneyAgentChatSession,
  scheduleIntervalMs,
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
    assert.doesNotMatch(seed, /gpt-5\.3-codex-spark/);
  });
});

test("created agents derive paths from the runtime home, never a baked-in one", () => {
  withLocalStorage((store) => {
    const agent = createMoneyAgent({ label: "ops", mission: "keep things green" });
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

test("stored agents pointing at another machine's home self-heal", () => {
  withLocalStorage((store) => {
    store.set(
      "aios.chatAgents.custom",
      JSON.stringify([
        {
          id: "legacy",
          label: "legacy",
          mission: "old agent",
          statePath: "/Users/olduser/.aios/state/chat-agents/legacy/status.json",
          cwd: "/Users/olduser/Repo/project",
        },
      ]),
    );
    const [agent] = loadCustomMoneyAgents();
    assert.doesNotMatch(agent.statePath, /olduser/);
    assert.doesNotMatch(agent.cwd, /olduser/);
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
    const noState = summarizeMoneyAgentState({ ...config, id: "scout", label: "scout" }, {});
    assert.equal(noState.health, "unknown");
    assert.doesNotMatch(noState.currentJob, /personal goals/);
  });
});

test("run commands speak the agent's own mission, not a stranger's business", () => {
  const cmd = buildMoneyAgentRunCommand({ label: "scout", mission: "qualify leads" }, "scheduled");
  assert.match(cmd, /run a scheduled pulse for scout/);
  assert.match(cmd, /goal: qualify leads/);
  assert.doesNotMatch(cmd, /sales for aios/);
});

test("schedule cadences parse: canonical, every-N (5min floor), legacy phrasings, manual=never", () => {
  const HOUR = 60 * 60_000;
  const DAY = 24 * HOUR;
  assert.equal(scheduleIntervalMs("hourly"), HOUR);
  assert.equal(scheduleIntervalMs("daily"), DAY);
  assert.equal(scheduleIntervalMs("weekly"), 7 * DAY);
  assert.equal(scheduleIntervalMs("every 30 min"), 30 * 60_000);
  assert.equal(scheduleIntervalMs("every 2 hours"), 2 * HOUR);
  assert.equal(scheduleIntervalMs("every 3 days"), 3 * DAY);
  // the quota-incident floor: "every 1 min" clamps to 5 minutes
  assert.equal(scheduleIntervalMs("every 1 min"), 5 * 60_000);
  // legacy phrasings the old inline scheduler accepted must keep firing
  assert.equal(scheduleIntervalMs("always"), 6 * HOUR);
  assert.equal(scheduleIntervalMs("daily work block"), DAY);
  assert.equal(scheduleIntervalMs("every hour-ish"), HOUR);
  // never-fire cases
  assert.equal(scheduleIntervalMs("manual"), null);
  assert.equal(scheduleIntervalMs(""), null);
  assert.equal(scheduleIntervalMs(undefined), null);
  assert.equal(scheduleIntervalMs("when the mood strikes"), null);
});

test("due-math: never-stamped fires, fresh stamp holds, elapsed cadence re-fires", () => {
  const HOUR = 60 * 60_000;
  const now = 1_750_000_000_000;
  const agent = { id: "scout", schedule: "hourly" };
  // never stamped → due immediately (the user asked for autonomy)
  assert.equal(isMoneyAgentDue(agent, now, null), true);
  // stamped 10 minutes ago → not due
  assert.equal(isMoneyAgentDue(agent, now, now - 10 * 60_000), false);
  // stamped over an hour ago → due again
  assert.equal(isMoneyAgentDue(agent, now, now - HOUR - 1), true);
  // manual never fires, stamped or not
  assert.equal(isMoneyAgentDue({ id: "m", schedule: "manual" }, now, null), false);
});
