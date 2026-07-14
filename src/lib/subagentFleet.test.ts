// @ts-nocheck -- executed directly by node's test runner, outside the browser app.
import assert from "node:assert/strict";
import test from "node:test";

import {
  partitionTools,
  deriveFleet,
  isAgentTurn,
  isBackgroundAgent,
  buildAgentChildMap,
  reconcileBackground,
  previewTool,
  hasRunningAgent,
} from "./subagentFleet.ts";

const tool = (id, name, input = {}, extra = {}) => ({
  kind: "tool",
  id,
  name,
  input,
  ...extra,
});

test("partitionTools nests children under their parent Task", () => {
  const tools = [
    tool("task1", "Task", { description: "Review auth" }),
    tool("r1", "Read", { file_path: "a.ts" }, { parentId: "task1" }),
    tool("g1", "Glob", { pattern: "**/*.ts" }, { parentId: "task1" }),
    tool("top", "Bash", { command: "ls" }),
  ];
  const { topLevel, childrenById } = partitionTools(tools);
  assert.deepEqual(
    topLevel.map((t) => t.id),
    ["task1", "top"],
  );
  assert.deepEqual(
    (childrenById.get("task1") ?? []).map((t) => t.id),
    ["r1", "g1"],
  );
});

test("partitionTools keeps INTERLEAVED children with the right parent", () => {
  // two agents running in parallel → their tool calls interleave in the stream.
  const tools = [
    tool("A", "Task", { description: "auth" }),
    tool("B", "Task", { description: "collections" }),
    tool("a1", "Glob", {}, { parentId: "A" }),
    tool("b1", "Read", {}, { parentId: "B" }),
    tool("a2", "Read", {}, { parentId: "A" }),
  ];
  const { childrenById } = partitionTools(tools);
  assert.deepEqual(
    (childrenById.get("A") ?? []).map((t) => t.id),
    ["a1", "a2"],
  );
  assert.deepEqual(
    (childrenById.get("B") ?? []).map((t) => t.id),
    ["b1"],
  );
});

test("a dangling parentId degrades to top-level (never dropped)", () => {
  const tools = [tool("orphan", "Read", {}, { parentId: "gone" })];
  const { topLevel, childrenById } = partitionTools(tools);
  assert.deepEqual(
    topLevel.map((t) => t.id),
    ["orphan"],
  );
  assert.equal(childrenById.size, 0);
});

test("deriveFleet summarizes status, steps and last line", () => {
  const tools = [
    tool(
      "A",
      "Task",
      { description: "Review auth", subagent_type: "general-purpose" },
      { result: "done summary" },
    ),
    tool("a1", "Glob", { pattern: "x" }, { parentId: "A" }),
    tool("a2", "Read", { file_path: "lib/foo.dart" }, { parentId: "A" }),
    tool("B", "Task", { description: "Review collections" }), // running, no result
    tool("b1", "Read", { file_path: "bar.dart" }, { parentId: "B" }),
  ];
  const fleet = deriveFleet(tools);
  assert.equal(fleet.length, 2);
  assert.deepEqual(fleet[0], {
    id: "A",
    label: "Review auth",
    subagentType: "general-purpose",
    status: "done",
    steps: 2,
    lastLine: "Read foo.dart",
    background: false,
  });
  assert.equal(fleet[1].status, "running");
  assert.equal(fleet[1].steps, 1);
  assert.equal(fleet[1].lastLine, "Read bar.dart");
});

test("status, isAgentTurn, hasRunningAgent edges", () => {
  const failed = tool("A", "Task", {}, { isError: true, result: "boom" });
  assert.equal(deriveFleet([failed])[0].status, "failed");
  assert.equal(isAgentTurn(failed), true);
  assert.equal(isAgentTurn(tool("r", "Read")), false);
  assert.equal(hasRunningAgent([tool("B", "Task", {})]), true);
  assert.equal(hasRunningAgent([failed]), false);
  assert.equal(previewTool(tool("g", "Glob", { pattern: "**/*.dart" })), "Globbed **/*.dart");
});

test("the sub-agent tool is detected under ALL its names (Agent is the live one)", () => {
  // REGRESSION: current Claude Code names the tool "Agent", not "Task". Missing it
  // makes every sub-agent render flat with no fleet. Lock all spellings in.
  for (const name of ["Agent", "agent", "Task", "task", "subagent", "sub-agent"]) {
    assert.equal(isAgentTurn(tool("x", name)), true, `${name} must be an agent`);
  }
  for (const name of ["Read", "Bash", "WebSearch", "Skill", "ToolSearch", "TodoWrite"]) {
    assert.equal(isAgentTurn(tool("x", name)), false, `${name} must NOT be an agent`);
  }
  // end-to-end: an "Agent" turn + its parent_tool_use_id children → one fleet
  // entry with the children nested (the real shape from the live stream).
  const tools = [
    tool("Ag1", "Agent", { description: "Research Mythos", subagent_type: "general-purpose" }),
    tool("w1", "WebSearch", { query: "claude mythos" }, { parentId: "Ag1" }),
    tool("b1", "Bash", { command: "echo hi" }, { parentId: "Ag1" }),
  ];
  const { topLevel, childrenById } = partitionTools(tools);
  assert.deepEqual(topLevel.map((t) => t.id), ["Ag1"]);
  assert.deepEqual((childrenById.get("Ag1") ?? []).map((t) => t.id), ["w1", "b1"]);
  const fleet = deriveFleet(tools);
  assert.equal(fleet.length, 1);
  assert.equal(fleet[0].label, "Research Mythos");
  assert.equal(fleet[0].subagentType, "general-purpose");
  assert.equal(fleet[0].steps, 2);
});

test("isBackgroundAgent keys off run_in_background (true/false/absent)", () => {
  assert.equal(isBackgroundAgent(tool("A", "Agent", { run_in_background: true })), true);
  assert.equal(isBackgroundAgent(tool("A", "Agent", { run_in_background: false })), false);
  assert.equal(isBackgroundAgent(tool("A", "Agent", {})), false);
  // a non-agent with the flag is never a background agent.
  assert.equal(isBackgroundAgent(tool("A", "Bash", { run_in_background: true })), false);
});

test("buildAgentChildMap clusters children GLOBALLY, even across group order", () => {
  // the Agent is spawned early; a child streams in much later (after other turns)
  // — the global map still nests it under the agent (the fix for the detached
  // flat block below the footer).
  const tools = [
    tool("Ag", "Agent", { description: "build" }),
    tool("m1", "Read", {}, {}), // a main-agent tool between spawn and late child
    tool("c1", "Edit", {}, { parentId: "Ag" }),
    tool("c2", "Bash", {}, { parentId: "Ag" }),
    tool("orphan", "Read", {}, { parentId: "gone" }), // dangling → NOT a child
  ];
  const { childrenByAgent, childIds } = buildAgentChildMap(tools);
  assert.deepEqual((childrenByAgent.get("Ag") ?? []).map((t) => t.id), ["c1", "c2"]);
  assert.equal(childIds.has("c1"), true);
  assert.equal(childIds.has("c2"), true);
  assert.equal(childIds.has("m1"), false); // main-agent tool stays in the stream
  assert.equal(childIds.has("orphan"), false); // dangling parent → not clustered
});

test("reconcileBackground docks ONLY run_in_background agents + excludes their subtree", () => {
  const tools = [
    tool("bg", "Agent", { description: "prototype", subagent_type: "builder", run_in_background: true }),
    tool("bg1", "Edit", { file_path: "x.html" }, { parentId: "bg" }),
    tool("fg", "Agent", { description: "explore", subagent_type: "Explore" }), // foreground
    tool("fg1", "Glob", {}, { parentId: "fg" }),
  ];
  const { childrenByAgent } = buildAgentChildMap(tools);
  const bgTasks = [
    { id: "t-bg", toolUseId: "bg", description: "prototype", subagentType: "builder", lastLine: "Editing x.html" },
    { id: "t-fg", toolUseId: "fg", description: "explore", subagentType: "Explore", lastLine: "Globbing" },
  ];
  const { dock, memberIds } = reconcileBackground(tools, childrenByAgent, bgTasks);
  // only the background agent is docked; the foreground one stays in transcript.
  assert.deepEqual(dock.map((d) => d.id), ["bg"]);
  assert.equal(dock[0].steps, 1);
  assert.equal(dock[0].lastLine, "Editing x.html"); // live task line preferred
  assert.equal(dock[0].background, true);
  // the background subtree (agent + child) is excluded from the transcript.
  assert.equal(memberIds.has("bg"), true);
  assert.equal(memberIds.has("bg1"), true);
  // the foreground agent + its child are NOT excluded.
  assert.equal(memberIds.has("fg"), false);
  assert.equal(memberIds.has("fg1"), false);
});

test("reconcileBackground surfaces an UNLINKED task as a standalone card", () => {
  const tools = [tool("main", "Bash", { command: "ls" })];
  const { childrenByAgent } = buildAgentChildMap(tools);
  const bgTasks = [{ id: "t1", description: "orphaned run", lastLine: "working" }];
  const { dock, memberIds } = reconcileBackground(tools, childrenByAgent, bgTasks);
  assert.deepEqual(dock.map((d) => d.id), ["t1"]);
  assert.equal(dock[0].label, "orphaned run");
  assert.equal(memberIds.size, 0);
});
