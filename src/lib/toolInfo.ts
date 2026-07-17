/**
 * Tool display registry — ONE pure source of truth for how a tool call reads in
 * the activity timeline: its short verb ("Read", "Ran", "Agent") and its icon
 * GROUP (a stable key the UI binds to a lucide component). Pure + React-free, so
 * both ChatPane's ActivityStep and the sub-agent fleet's child rows share it —
 * previously each kept its own hand-rolled verb map, which drifted (a sub-agent's
 * "Fetched" vs the main row's "Web search") and missed newer tools.
 *
 * Coverage goal: EVERY tool the current Claude Code exposes maps to a real verb +
 * icon group, so nothing ever renders as a bare identifier with a generic wrench.
 * Names are matched case-insensitively; unknown names degrade gracefully
 * (de-slugged verb + a "tool" icon) rather than breaking.
 */

/** Stable icon-group keys. The UI layer (ChatPane) binds each to a lucide icon,
 *  so this module stays free of React/component imports. */
export type ToolIconKey =
  | "file" // read/view a file
  | "edit" // mutate a file
  | "shell" // run / inspect a command
  | "search" // grep / glob / tool-search
  | "web" // fetch / web search
  | "plan" // plan mode in/out
  | "list" // todos / task board
  | "agent" // sub-agent spawn / message
  | "skill" // skill / slash / workflow
  | "clock" // schedules, monitors, crons
  | "notify" // notifications
  | "ask" // ask-the-user
  | "worktree" // git worktree enter/leave
  | "publish" // artifacts / shared guides
  | "report" // findings / reviews
  | "mcp" // any MCP tool
  | "tool"; // unknown fallback

/** `mcp__server__tool` → its parts, or null for non-MCP names. */
export function mcpToolParts(name: string): { server: string; tool: string } | null {
  if (!name.startsWith("mcp__")) return null;
  const rest = name.slice(5);
  const sep = rest.indexOf("__");
  if (sep < 0) return { server: rest, tool: "" };
  return { server: rest.slice(0, sep), tool: rest.slice(sep + 2) };
}

/** Humanize an unknown tool name: "EnterWorktree" → "Enter worktree",
 *  "some_tool" → "Some tool" — so a tool we've never seen still reads as a
 *  sentence in the activity row instead of a raw identifier. */
export function prettifyToolName(name: string): string {
  const spaced = name
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return name;
  return spaced[0].toUpperCase() + spaced.slice(1).toLowerCase();
}

/** A short verb for the tool, Codex-style ("Read", "Ran", "Edited", "Searched"). */
export function toolVerb(name: string): string {
  if (mcpToolParts(name)) return "MCP";
  switch (name.toLowerCase()) {
    case "read":
      return "Read";
    case "write":
      return "Wrote";
    case "edit":
    case "multiedit":
    case "notebookedit":
      return "Edited";
    case "bash":
    case "powershell":
    case "exec_command":
      return "Ran";
    case "bashoutput":
    case "write_stdin":
      return "Output";
    case "killshell":
    case "killbash":
      return "Stopped shell";
    case "grep":
    case "search":
      return "Searched";
    case "glob":
      return "Globbed";
    case "webfetch":
    case "webfetch_tool":
      return "Fetched";
    case "websearch":
    case "web_search":
      return "Web search";
    case "task":
    case "agent":
    case "subagent":
    case "sub-agent":
      return "Agent";
    case "sendmessage":
      return "Messaged agent";
    case "mcp":
    case "mcp_tool_call":
    case "listmcpresourcestool":
    case "readmcpresourcetool":
    case "readmcpresourcedirtool":
      return "MCP";
    case "todowrite":
      return "Planned";
    case "skill":
    case "slashcommand":
      return "Skill";
    case "toolsearch":
      return "Tool search";
    case "workflow":
      return "Workflow";
    case "monitor":
      return "Monitored";
    case "schedulewakeup":
      return "Scheduled wake";
    case "croncreate":
    case "crondelete":
    case "cronlist":
      return "Cron";
    case "pushnotification":
      return "Notified";
    case "askuserquestion":
      return "Asked";
    case "enterplanmode":
      return "Entered plan mode";
    case "exitplanmode":
      return "Proposed plan";
    case "enterworktree":
      return "Entered worktree";
    case "exitworktree":
      return "Left worktree";
    case "artifact":
      return "Published";
    case "shareonboardingguide":
      return "Shared guide";
    case "reportfindings":
      return "Reported findings";
    case "designsync":
      return "Design sync";
    case "remotetrigger":
      return "Triggered remote";
    case "taskcreate":
      return "Task added";
    case "taskupdate":
      return "Task updated";
    case "taskget":
    case "tasklist":
      return "Tasks";
    case "taskoutput":
      return "Task output";
    case "taskstop":
      return "Stopped task";
    default:
      return prettifyToolName(name);
  }
}

/** The icon GROUP for a tool — the UI binds it to a concrete icon component. */
export function toolIconKey(name: string): ToolIconKey {
  if (mcpToolParts(name)) return "mcp";
  switch (name.toLowerCase()) {
    case "read":
    case "write":
    case "notebookedit":
      return "file";
    case "edit":
    case "multiedit":
      return "edit";
    case "bash":
    case "powershell":
    case "bashoutput":
    case "exec_command":
    case "write_stdin":
    case "killshell":
    case "killbash":
      return "shell";
    case "grep":
    case "glob":
    case "search":
    case "toolsearch":
      return "search";
    case "webfetch":
    case "webfetch_tool":
    case "websearch":
    case "web_search":
      return "web";
    case "todowrite":
    case "taskcreate":
    case "taskupdate":
    case "taskget":
    case "tasklist":
    case "taskoutput":
    case "taskstop":
      return "list";
    case "task":
    case "agent":
    case "subagent":
    case "sub-agent":
    case "sendmessage":
    case "remotetrigger":
      return "agent";
    case "skill":
    case "slashcommand":
    case "workflow":
      return "skill";
    case "monitor":
    case "schedulewakeup":
    case "croncreate":
    case "crondelete":
    case "cronlist":
      return "clock";
    case "pushnotification":
      return "notify";
    case "askuserquestion":
      return "ask";
    case "enterplanmode":
    case "exitplanmode":
      return "plan";
    case "enterworktree":
    case "exitworktree":
      return "worktree";
    case "artifact":
    case "shareonboardingguide":
      return "publish";
    case "reportfindings":
    case "designsync":
      return "report";
    case "mcp":
    case "mcp_tool_call":
    case "listmcpresourcestool":
    case "readmcpresourcetool":
    case "readmcpresourcedirtool":
      return "mcp";
    default:
      return "tool";
  }
}
