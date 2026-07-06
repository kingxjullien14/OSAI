import { Loader2, Check, X, Waypoints } from "lucide-react";
import type { SubagentSummary } from "../../lib/subagentFleet";

/**
 * Live "fleet" strip — one compact card per sub-agent the main agent has spawned,
 * shown at the top of the activity group while a fan-out is in flight. It's the
 * at-a-glance dashboard ("3 agents running, here's what each is on"); the inline
 * nested AgentStep rows below it are the detailed, permanent record. Borrowed in
 * spirit from Firaz's FleetView, rebuilt on our `parent_tool_use_id` nesting.
 *
 * W4 polish: a swarm header (n running / done counts), progress hairline per
 * card while running, accent glow on live cards, staggered arrival.
 */
export function FleetView({ agents }: { agents: SubagentSummary[] }) {
  if (agents.length === 0) return null;
  const running = agents.filter((a) => a.status === "running").length;
  const failed = agents.filter((a) => a.status === "failed").length;
  const done = agents.length - running - failed;
  return (
    <div className="mb-2 flex flex-col gap-1.5">
      {/* swarm header — the fleet at a glance */}
      <div className="flex items-center gap-2 font-mono text-[10px] tracking-[0.14em] text-[var(--color-faint)] uppercase">
        <Waypoints size={11} className="text-[var(--color-accent)]" />
        agent swarm
        <span className="tracking-normal normal-case">
          {running > 0 && <span className="text-[var(--color-accent)]">{running} running</span>}
          {running > 0 && (done > 0 || failed > 0) && " · "}
          {done > 0 && <span className="text-[var(--color-success)]">{done} done</span>}
          {failed > 0 && (
            <>
              {(running > 0 || done > 0) && " · "}
              <span className="text-[var(--color-danger)]">{failed} failed</span>
            </>
          )}
        </span>
      </div>
      <div className="stagger flex flex-wrap gap-1.5">
        {agents.map((a) => (
          <FleetCard key={a.id} agent={a} />
        ))}
      </div>
    </div>
  );
}

function FleetCard({ agent }: { agent: SubagentSummary }) {
  const running = agent.status === "running";
  return (
    <div
      className={`relative flex min-w-[150px] max-w-[260px] flex-col gap-0.5 overflow-hidden rounded-lg border bg-[var(--color-panel-2)]/55 px-2.5 py-1.5 backdrop-blur-md transition-all duration-200 ${
        agent.status === "failed"
          ? "border-[var(--color-danger)]/45"
          : running
            ? "border-[var(--color-accent)]/40 shadow-[var(--aios-glow-soft)]"
            : "border-[var(--color-border)] opacity-90"
      }`}
    >
      {/* live progress hairline — an indeterminate accent sweep along the top */}
      {running && (
        <span
          aria-hidden
          className="aios-fleet-sweep pointer-events-none absolute inset-x-0 top-0 h-px"
        />
      )}
      <div className="flex items-center gap-1.5">
        {running ? (
          <Loader2 size={12} className="shrink-0 animate-spin text-[var(--color-accent)]" />
        ) : agent.status === "failed" ? (
          <X size={12} className="shrink-0 text-[var(--color-danger)]" />
        ) : (
          <Check size={12} className="shrink-0 text-[var(--color-success)]" />
        )}
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
