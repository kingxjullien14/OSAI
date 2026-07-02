/**
 * Sub-agent fleet logic — pure, no React, so it's unit-testable and shared by the
 * transcript nesting (AgentStep) and the live FleetView strip.
 *
 * When the main agent fans out via the Task tool, the SDK stream tags every event
 * the sub-agent emits with a top-level `parent_tool_use_id` = the spawning Task's
 * tool_use id. `chatStream.ts` copies that onto each tool turn as `parentId`. This
 * module turns a flat tool-turn list into (a) a parent→children grouping for
 * inline nesting and (b) per-agent summaries for the fleet glance.
 */
import type { ChatTurn } from "./chatStream";

export type ToolTurn = Extract<ChatTurn, { kind: "tool" }>;

export type SubagentStatus = "running" | "done" | "failed";

/** A compact, render-ready summary of one running/finished sub-agent. */
export interface SubagentSummary {
  /** the parent Task's tool_use id. */
  id: string;
  /** human label — the Task `description` (falls back to type, then "sub-agent"). */
  label: string;
  /** the requested agent type (`subagent_type`), e.g. "general-purpose" / "Explore". */
  subagentType?: string;
  status: SubagentStatus;
  /** number of tool calls this sub-agent has made so far. */
  steps: number;
  /** one-line preview of its most recent tool call, e.g. "Read foo.dart". */
  lastLine?: string;
}

const str = (inp: Record<string, unknown> | undefined, k: string): string | undefined =>
  inp && typeof inp[k] === "string" ? (inp[k] as string) : undefined;

const baseName = (p: string): string => {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] || p;
};

/** True when a tool turn is a sub-agent spawn. Current Claude Code names this
 *  tool `Agent` (it was `Task` historically; other engines/SDKs may say
 *  `subagent`/`sub-agent`). No other real tool name contains these, so matching
 *  the set is safe. This is the gate for BOTH nesting and the fleet — getting the
 *  name wrong makes every sub-agent fall back to a flat row, so keep it broad. */
export function isAgentTurn(t: ToolTurn): boolean {
  const n = t.name.toLowerCase();
  return n === "agent" || n === "task" || n === "subagent" || n === "sub-agent";
}

/** Display label for a sub-agent row: its description, else type, else generic. */
export function agentLabel(t: ToolTurn): string {
  return (
    str(t.input, "description") ?? str(t.input, "subagent_type") ?? "sub-agent"
  );
}

/** A short, friendly verb for a child tool call (lite version of ChatPane's
 *  `toolVerb`, duplicated here to keep this module React-free + standalone). */
function verbLite(name: string): string {
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
    case "exec_command":
      return "Ran";
    case "grep":
    case "search":
      return "Searched";
    case "glob":
      return "Globbed";
    case "webfetch":
    case "webfetch_tool":
      return "Fetched";
    case "websearch":
      return "Searched web";
    case "task":
      return "Agent";
    case "todowrite":
      return "Planned";
    default:
      return name;
  }
}

/** One-line preview of a tool call for the fleet's "last line" — verb + target.
 *  File paths are shortened to their basename; patterns/queries/commands are kept
 *  whole, since basename-ing a glob pattern would wrongly drop its leading dirs. */
export function previewTool(t: ToolTurn): string {
  const inp = t.input;
  const file = str(inp, "file_path") ?? str(inp, "path") ?? str(inp, "notebook_path");
  if (file) return `${verbLite(t.name)} ${baseName(file)}`.trim();
  const other =
    str(inp, "pattern") ??
    str(inp, "query") ??
    str(inp, "command") ??
    str(inp, "url") ??
    str(inp, "description") ??
    "";
  const firstLine = other.split("\n")[0] ?? other;
  const clipped = firstLine.length > 48 ? `${firstLine.slice(0, 48)}…` : firstLine;
  return `${verbLite(t.name)}${clipped ? ` ${clipped}` : ""}`.trim();
}

function statusOf(t: ToolTurn): SubagentStatus {
  if (t.isError) return "failed";
  return t.result != null ? "done" : "running";
}

/**
 * Split a flat tool-turn list into top-level turns (made by the main agent) and
 * children keyed by their parent Task id. A turn is a child only when its
 * `parentId` points at another turn PRESENT in this same list — a dangling
 * parentId (parent scrolled out of the group) degrades to top-level, never lost.
 */
export function partitionTools(tools: ToolTurn[]): {
  topLevel: ToolTurn[];
  childrenById: Map<string, ToolTurn[]>;
} {
  const ids = new Set(tools.map((t) => t.id));
  const childrenById = new Map<string, ToolTurn[]>();
  const topLevel: ToolTurn[] = [];
  for (const t of tools) {
    if (t.parentId && ids.has(t.parentId)) {
      const arr = childrenById.get(t.parentId);
      if (arr) arr.push(t);
      else childrenById.set(t.parentId, [t]);
    } else {
      topLevel.push(t);
    }
  }
  return { topLevel, childrenById };
}

/** Per-sub-agent summaries for the fleet strip, in spawn order. */
export function deriveFleet(tools: ToolTurn[]): SubagentSummary[] {
  const { childrenById } = partitionTools(tools);
  const out: SubagentSummary[] = [];
  for (const t of tools) {
    if (!isAgentTurn(t)) continue;
    const kids = childrenById.get(t.id) ?? [];
    const last = kids.length > 0 ? kids[kids.length - 1] : undefined;
    out.push({
      id: t.id,
      label: agentLabel(t),
      subagentType: str(t.input, "subagent_type"),
      status: statusOf(t),
      steps: kids.length,
      lastLine: last ? previewTool(last) : undefined,
    });
  }
  return out;
}

/** Any sub-agent still running? (drives whether to show the live fleet strip.) */
export function hasRunningAgent(tools: ToolTurn[]): boolean {
  return tools.some((t) => isAgentTurn(t) && statusOf(t) === "running");
}
