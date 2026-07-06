// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  SCHEDULED_AGENTS,
  SCHEDULED_AGENT_TEMPLATES,
  buildScheduledAgentChatSeed,
  buildScheduledAgentRunCommand,
  createScheduledAgent,
  isScheduledAgentDue,
  loadCustomScheduledAgents,
  loadScheduledAgentChatSession,
  saveScheduledAgentChatSession,
  scheduleIntervalMs,
  summarizeScheduledAgentState,
} from "./scheduledAgents.ts";

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
  assert.deepEqual(SCHEDULED_AGENTS, []);
  withLocalStorage(() => {
    const agent = createScheduledAgent({ label: "research scout", mission: "find leads" });
    const seed = buildScheduledAgentChatSeed(agent);
    assert.match(seed, /you are the osai research scout agent/);
    assert.match(seed, /mission: find leads/);
    assert.match(seed, /first task:/);
    assert.match(seed, /do not ask the user/);
    assert.doesNotMatch(seed, /gpt-5\.3-codex-spark/);
  });
});

test("created agents persist only the user's inputs (no baked-in derived fields)", () => {
  withLocalStorage((store) => {
    createScheduledAgent({ label: "ops", mission: "keep things green", schedule: "daily" });
    const stored = JSON.parse(store.get("aios.chatAgents.custom"));
    assert.equal(stored.length, 1);
    assert.equal(stored[0].id, "ops");
    assert.equal(stored[0].mission, "keep things green");
    assert.equal(stored[0].schedule, "daily");
    // cwd is only persisted when explicitly provided (else re-resolved at load).
    assert.equal(stored[0].cwd, undefined);
    const loaded = loadCustomScheduledAgents();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0].id, "ops");
    assert.equal(loaded[0].schedule, "daily");
  });
});

test("stored agents pointing at another machine's home self-heal", () => {
  withLocalStorage((store) => {
    store.set(
      "aios.chatAgents.custom",
      JSON.stringify([
        { id: "legacy", label: "legacy", mission: "old agent", cwd: "/Users/olduser/Repo/project" },
      ]),
    );
    const [agent] = loadCustomScheduledAgents();
    // the stale foreign cwd is dropped; it falls back to the runtime home.
    assert.doesNotMatch(agent.cwd, /olduser/);
  });
});

test("scheduled agent chat sessions persist by agent id", () => {
  withLocalStorage(() => {
    saveScheduledAgentChatSession("growth", {
      sessionId: "claude-agent-session",
      title: "growth agents",
      updatedAt: 123,
    });

    assert.deepEqual(loadScheduledAgentChatSession("growth"), {
      sessionId: "claude-agent-session",
      title: "growth agents",
      updatedAt: 123,
    });
    assert.equal(loadScheduledAgentChatSession("outreach"), null);
  });
});

test("summarizeScheduledAgentState derives schedule-based health from cadence + last run", () => {
  withLocalStorage(() => {
    const daily = {
      id: "growth",
      label: "growth agents",
      shortLabel: "growth",
      cwd: "~",
      mission: "grow",
      schedule: "daily",
    };
    // has a cadence + never stamped → due now; currentJob is the mission.
    const s1 = summarizeScheduledAgentState(daily);
    assert.equal(s1.health, "due");
    assert.equal(s1.currentJob, "grow");
    assert.equal(s1.schedule, "daily");
    assert.notEqual(s1.nextDueAt, null);

    // manual cadence → "manual" health, never auto-fires (no next-due).
    const manual = summarizeScheduledAgentState({ ...daily, id: "m", schedule: "manual" });
    assert.equal(manual.health, "manual");
    assert.equal(manual.nextDueAt, null);
  });
});

test("starter templates are well-formed: label, prompt, and a parseable cadence", () => {
  assert.ok(SCHEDULED_AGENT_TEMPLATES.length > 0);
  for (const t of SCHEDULED_AGENT_TEMPLATES) {
    assert.ok(t.label.trim().length > 0, "template needs a label");
    assert.ok(t.mission.trim().length > 0, `template "${t.label}" needs a prompt`);
    if (t.schedule !== "manual") {
      assert.notEqual(
        scheduleIntervalMs(t.schedule),
        null,
        `template "${t.label}" cadence "${t.schedule}" must parse`,
      );
    }
  }
});

test("run commands speak the agent's own mission, not a stranger's business", () => {
  const cmd = buildScheduledAgentRunCommand({ label: "scout", mission: "qualify leads" }, "scheduled");
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
  assert.equal(isScheduledAgentDue(agent, now, null), true);
  // stamped 10 minutes ago → not due
  assert.equal(isScheduledAgentDue(agent, now, now - 10 * 60_000), false);
  // stamped over an hour ago → due again
  assert.equal(isScheduledAgentDue(agent, now, now - HOUR - 1), true);
  // manual never fires, stamped or not
  assert.equal(isScheduledAgentDue({ id: "m", schedule: "manual" }, now, null), false);
});
