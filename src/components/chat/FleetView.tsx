import { Loader2, Check, X, Waypoints } from "lucide-react";
import type { SubagentSummary } from "../../lib/subagentFleet";

/**
 * Live "fleet" strip — one compact card per sub-agent the main agent has spawned,
 * shown at the top of the activity group while a fan-out is in flight. It's the
 * at-a-glance dashboard ("3 agents running, here's what each is on"); the inline
 * nested AgentStep rows below it are the detailed, permanent record. Borrowed in
 * spirit from Firaz's FleetView, rebuilt on our `parent_tool_use_id` nesting.
 */
export function FleetView({ agents }: { agents: SubagentSummary[] }) {
  if (agents.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5">
      {agents.map((a) => (
        <FleetCard key={a.id} agent={a} />
      ))}
    </div>
  );
}

function FleetCard({ agent }: { agent: SubagentSummary }) {
  const running = agent.status === "running";
  return (
    <div
      className={`flex min-w-[150px] max-w-[260px] flex-col gap-0.5 rounded-lg border bg-[var(--color-panel-2)]/55 px-2.5 py-1.5 backdrop-blur-md transition-colors ${
        agent.status === "failed"
          ? "border-[var(--color-danger)]/45"
          : running
            ? "border-[var(--color-accent)]/40"
            : "border-[var(--color-border)]"
      }`}
    >
      <div className="flex items-center gap-1.5">
        {running ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-[var(--color-accent)]" />
        ) : agent.status === "failed" ? (
          <X size={12} className="shrink-0 text-[var(--color-danger)]" />
        ) : (
          <Check size={12} className="shrink-0 text-[var(--color-success)]" />
        )}
        <Waypoints size={11} className="shrink-0 text-[var(--color-faint)]" />
        <span className="truncate font-sans text-[11.5px] font-medium text-[var(--color-text-2)]">
          {agent.label}
        </span>
      </div>
      <div className="flex items-center gap-1.5 pl-[18px] font-mono text-[10px] text-[var(--color-faint)]">
        {agent.subagentType && (
          <span className="truncate rounded bg-[var(--color-panel)] px-1 py-px text-[var(--color-muted)]">
            {agent.subagentType}
          </span>
        )}
        <span className="shrink-0">
          {agent.steps} step{agent.steps === 1 ? "" : "s"}
        </span>
      </div>
      {agent.lastLine && (
        <div className="truncate pl-[18px] font-mono text-[10px] text-[var(--color-muted)]">
          {agent.lastLine}
        </div>
      )}
    </div>
  );
}
