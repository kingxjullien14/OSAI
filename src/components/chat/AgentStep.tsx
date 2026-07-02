import { useState, type ReactNode } from "react";
import { Loader2, Check, X, ChevronRight, Waypoints } from "lucide-react";
import { agentLabel, type ToolTurn } from "../../lib/subagentFleet";

/**
 * One sub-agent row inside the activity group: an "Agent · <description>" header
 * with the sub-agent's own tool calls nested underneath. The children are rendered
 * by the parent via `renderChild` (dependency injection) so this component stays
 * decoupled from ChatPane's ActivityStep — and `renderChild` can recurse, so a
 * sub-agent that itself spawns sub-agents nests correctly to any depth.
 *
 * Auto-expands while the agent is running (watch it work), collapses to a
 * step-count rollup when it finishes — the same lifecycle as the activity group.
 */
export function AgentStep({
  turn,
  childTools,
  live,
  renderChild,
}: {
  turn: ToolTurn;
  childTools: ToolTurn[];
  live: boolean;
  renderChild: (t: ToolTurn) => ReactNode;
}) {
  const failed = turn.isError === true;
  const running = turn.result == null && !failed;
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  // running agents open themselves while live; a failed one always opens so you
  // can see what it did; otherwise user-controlled.
  const open = userToggled ?? ((live && running) || failed);

  const label = agentLabel(turn);
  const subType =
    typeof turn.input.subagent_type === "string" ? turn.input.subagent_type : null;
  const n = childTools.length;
  const result = turn.result?.trim();
  const expandable = n > 0 || Boolean(result);

  return (
    <div className="group/agent flex flex-col">
      <div className="flex w-full items-center gap-2 rounded-md py-0.5 pr-1">
        <button
          type="button"
          onClick={() => expandable && setUserToggled(!open)}
          className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
            expandable ? "cursor-pointer" : "cursor-default"
          }`}
        >
          <Waypoints size={13} className="shrink-0 text-[var(--color-accent)]" />
          <span className="shrink-0 font-sans text-[12px] font-medium text-[var(--color-text-2)]">
            Agent
          </span>
          <span className="truncate font-sans text-[11.5px] text-[var(--color-muted)]">
            {label}
          </span>
          {subType && (
            <span className="shrink-0 rounded bg-[var(--color-panel)] px-1 py-px font-mono text-[10px] text-[var(--color-faint)]">
              {subType}
            </span>
          )}
          <span className="flex-1" />
        </button>
        {n > 0 && (
          <span className="shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
            {n} step{n === 1 ? "" : "s"}
          </span>
        )}
        {running ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-[var(--color-accent)]" />
        ) : failed ? (
          <X size={12} className="shrink-0 text-[var(--color-danger)]" />
        ) : (
          <Check size={12} className="shrink-0 text-[var(--color-success)]" />
        )}
        {expandable && (
          <button
            type="button"
            onClick={() => setUserToggled(!open)}
            className="shrink-0"
            aria-label={open ? "collapse agent" : "expand agent"}
          >
            <ChevronRight
              size={12}
              className={`text-[var(--color-faint)] transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        )}
      </div>
      {open && expandable && (
        <div className="mb-1 ml-[7px] flex flex-col gap-0.5 border-l border-[var(--color-border)] pl-3 pt-0.5">
          {childTools.map((c) => (
            <div key={c.id}>{renderChild(c)}</div>
          ))}
          {result && (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-panel)]/60 px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-muted)]">
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
