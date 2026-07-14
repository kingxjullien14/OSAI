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
  /** true when spawned with `run_in_background` — it keeps working after the main
   *  turn's reply lands, so it's shown in the composer dock, not the transcript. */
  background: boolean;
  /** the live `task_id` (system/task_* channel) when this agent is linked to one. */
  taskId?: string;
}

/** A live background task from the `system/task_*` channel (ChatPane `bgTasks`).
 *  `toolUseId` is the spawning Agent turn's id (the CLI provides it on task_*),
 *  which links the live task to its transcript turn for step counts + folding
 *  back into the transcript when it finishes. */
export interface BgTask {
  id: string;
  toolUseId?: string;
  description: string;
  subagentType?: string;
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

/** True when this Agent was spawned to run in the background (`run_in_background`
 *  in the Task tool input) — verified present on real CLI streams. Such agents
 *  keep working after the main turn's reply lands, so they're routed to the
 *  composer dock instead of appending steps below a finished turn. */
export function isBackgroundAgent(t: ToolTurn): boolean {
  return (
    isAgentTurn(t) &&
    (t.input as Record<string, unknown> | undefined)?.run_in_background === true
  );
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

/**
 * GLOBAL parent→children map over an ENTIRE turn's tool set (not one activity
 * group). A child is any tool turn whose `parentId` points at an Agent turn
 * present in `tools`. This is the key to clustering: a sub-agent's children
 * nest under their Agent row no matter which activity group they streamed into
 * or how late they arrived — so a background fan-out whose steps land after the
 * result footer never renders as a detached flat block. `childIds` lets the
 * block builder pull children OUT of the linear stream (the Agent owns them).
 * A dangling parentId (parent Agent not in the list) is NOT a child → it stays
 * a normal top-level tool, never lost.
 */
export function buildAgentChildMap(tools: ToolTurn[]): {
  childrenByAgent: Map<string, ToolTurn[]>;
  childIds: Set<string>;
} {
  const agentIds = new Set(tools.filter(isAgentTurn).map((t) => t.id));
  const childrenByAgent = new Map<string, ToolTurn[]>();
  const childIds = new Set<string>();
  for (const t of tools) {
    if (t.parentId && agentIds.has(t.parentId)) {
      childIds.add(t.id);
      const arr = childrenByAgent.get(t.parentId);
      if (arr) arr.push(t);
      else childrenByAgent.set(t.parentId, [t]);
    }
  }
  return { childrenByAgent, childIds };
}

/** Per-sub-agent summaries for the fleet strip, in spawn order. Pass the GLOBAL
 *  `childrenByAgent` (from `buildAgentChildMap`) so step counts + last-line reflect
 *  ALL of an agent's children, not just those in one group; omit it and it falls
 *  back to a self-contained per-list split (kept for the pure unit tests). */
export function deriveFleet(
  tools: ToolTurn[],
  childrenByAgent?: Map<string, ToolTurn[]>,
): SubagentSummary[] {
  const kidsOf = childrenByAgent ?? partitionTools(tools).childrenById;
  const out: SubagentSummary[] = [];
  for (const t of tools) {
    if (!isAgentTurn(t)) continue;
    const kids = kidsOf.get(t.id) ?? [];
    const last = kids.length > 0 ? kids[kids.length - 1] : undefined;
    out.push({
      id: t.id,
      label: agentLabel(t),
      subagentType: str(t.input, "subagent_type"),
      status: statusOf(t),
      steps: kids.length,
      lastLine: last ? previewTool(last) : undefined,
      background: isBackgroundAgent(t),
    });
  }
  return out;
}

/**
 * Reconcile the transcript's Agent turns with the live `system/task_*` channel
 * (`bgTasks`) into ONE source of truth for background agents:
 *  · `dock` — one summary per CURRENTLY-running background agent, for the composer
 *    dock. Linked to its Agent turn by `toolUseId` (exact) so it carries the
 *    agent's live step count + newest action; an unlinked task degrades to a
 *    standalone card. Only top-level agents (spawned by the main agent) become
 *    cards — nested ones live inside their root's subtree.
 *  · `memberIds` — every tool id in a running background agent's subtree (the
 *    root Agent + all its descendants). The block builder excludes these from the
 *    linear transcript so nothing streams in below the finished turn's footer;
 *    when the task completes (drops from `bgTasks`) the subtree re-enters the
 *    transcript as a collapsed, finished AgentStep.
 */
export function reconcileBackground(
  tools: ToolTurn[],
  childrenByAgent: Map<string, ToolTurn[]>,
  bgTasks: BgTask[],
): { dock: SubagentSummary[]; memberIds: Set<string> } {
  const byId = new Map(tools.map((t) => [t.id, t]));
  const memberIds = new Set<string>();
  const walk = (id: string) => {
    if (memberIds.has(id)) return;
    memberIds.add(id);
    for (const c of childrenByAgent.get(id) ?? []) walk(c.id);
  };
  const dock: SubagentSummary[] = [];
  const seen = new Set<string>();
  for (const task of bgTasks) {
    const agent = task.toolUseId ? byId.get(task.toolUseId) : undefined;
    if (agent && isAgentTurn(agent)) {
      // task_* events fire for FOREGROUND agents too (the main turn blocks on
      // them) — those must stay nested inline in the transcript, NOT move to the
      // dock. Only route agents actually spawned `run_in_background`.
      if (!isBackgroundAgent(agent)) continue;
      walk(agent.id); // exclude the whole subtree from the transcript while live
      if (agent.parentId == null && !seen.has(agent.id)) {
        seen.add(agent.id);
        const kids = childrenByAgent.get(agent.id) ?? [];
        const lastKid = kids.length ? kids[kids.length - 1] : undefined;
        dock.push({
          id: agent.id,
          label: agentLabel(agent),
          subagentType: str(agent.input, "subagent_type") ?? task.subagentType,
          status: "running",
          steps: kids.length,
          lastLine: task.lastLine ?? (lastKid ? previewTool(lastKid) : undefined),
          background: true,
          taskId: task.id,
        });
      }
    } else {
      // no matching Agent turn yet (id namespaces can lag / older CLI) — surface a
      // standalone card from the task's own fields so the dock is never empty-wrong.
      dock.push({
        id: task.id,
        label: task.description,
        subagentType: task.subagentType,
        status: "running",
        steps: 0,
        lastLine: task.lastLine,
        background: true,
        taskId: task.id,
      });
    }
  }
  return { dock, memberIds };
}

/** Any sub-agent still running? (drives whether to show the live fleet strip.) */
export function hasRunningAgent(tools: ToolTurn[]): boolean {
  return tools.some((t) => isAgentTurn(t) && statusOf(t) === "running");
}
