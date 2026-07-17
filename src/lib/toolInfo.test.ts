// @ts-nocheck -- node:test suite; runs under --experimental-strip-types.
import assert from "node:assert/strict";
import test from "node:test";

import { mcpToolParts, prettifyToolName, toolIconKey, toolVerb } from "./toolInfo.ts";

test("mcpToolParts: splits server/tool, null for non-MCP", () => {
  assert.deepEqual(mcpToolParts("mcp__atlassian__getJiraIssue"), {
    server: "atlassian",
    tool: "getJiraIssue",
  });
  assert.deepEqual(mcpToolParts("mcp__server"), { server: "server", tool: "" });
  assert.equal(mcpToolParts("Read"), null);
});

test("prettifyToolName: de-slugs identifiers into sentences", () => {
  assert.equal(prettifyToolName("EnterWorktree"), "Enter worktree");
  assert.equal(prettifyToolName("some_new_tool"), "Some new tool");
});

test("toolVerb: covers the core tool set", () => {
  assert.equal(toolVerb("Read"), "Read");
  assert.equal(toolVerb("Write"), "Wrote");
  assert.equal(toolVerb("Edit"), "Edited");
  assert.equal(toolVerb("Bash"), "Ran");
  assert.equal(toolVerb("Grep"), "Searched");
  assert.equal(toolVerb("WebSearch"), "Web search");
  assert.equal(toolVerb("TodoWrite"), "Planned");
});

test("toolVerb: the Task tool reads as Agent under all its aliases", () => {
  for (const n of ["Task", "Agent", "subagent", "sub-agent"]) {
    assert.equal(toolVerb(n), "Agent", n);
  }
});

test("toolVerb: newer tools no longer fall back to a bare identifier", () => {
  // these used to hit the generic prettify path; now they have real verbs
  assert.equal(toolVerb("AskUserQuestion"), "Asked");
  assert.equal(toolVerb("Artifact"), "Published");
  assert.equal(toolVerb("ReportFindings"), "Reported findings");
  assert.equal(toolVerb("KillShell"), "Stopped shell");
  assert.equal(toolVerb("ExitPlanMode"), "Proposed plan");
  assert.equal(toolVerb("mcp__atlassian__getJiraIssue"), "MCP");
});

test("toolVerb: unknown tool degrades to a de-slugged sentence, not a crash", () => {
  assert.equal(toolVerb("SomeFutureTool"), "Some future tool");
});

test("toolIconKey: every core + newer tool maps to a real group (not the fallback)", () => {
  const known = [
    "Read", "Write", "Edit", "MultiEdit", "NotebookEdit",
    "Bash", "BashOutput", "KillShell", "Glob", "Grep",
    "WebFetch", "WebSearch", "TodoWrite", "Task", "Agent",
    "Skill", "Workflow", "Monitor", "ScheduleWakeup", "CronCreate",
    "PushNotification", "AskUserQuestion", "ExitPlanMode", "EnterWorktree",
    "Artifact", "ReportFindings", "SendMessage", "mcp__x__y",
  ];
  for (const n of known) {
    assert.notEqual(toolIconKey(n), "tool", `${n} should map to a real icon group`);
  }
  // and an unknown one DOES hit the fallback
  assert.equal(toolIconKey("TotallyMadeUp"), "tool");
});
