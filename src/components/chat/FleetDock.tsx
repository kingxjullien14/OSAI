import { useState } from "react";
import { ChevronDown, Waypoints } from "lucide-react";

import type { SubagentSummary } from "../../lib/subagentFleet";
import { CadencedShimmer } from "./ThinkingBlock";
import { FleetCard } from "./FleetView";

/**
 * The background-agent dock — docked above the composer, it shows agents spawned
 * with `run_in_background` that keep working AFTER the main turn's reply landed.
 * This is where their live progress lives, deliberately OUT of the transcript so
 * a finished turn never keeps growing steps below its footer. When an agent
 * finishes it drops out of here and re-appears in the transcript as a collapsed,
 * done AgentStep (its permanent record).
 *
 * Collapsed: a one-line summary (ping dot · "N agents working" · newest action).
 * Expanded: the persistent live fleet — one FleetCard per agent (same card the
 * transcript's live glance uses), with the animated progress hairline.
 */
export function FleetDock({ agents }: { agents: SubagentSummary[] }) {
  const [open, setOpen] = useState(false);
  if (agents.length === 0) return null;

  const n = agents.length;
  // newest live action across the fleet — the most recent agent's last line.
  const recent = agents.map((a) => a.lastLine).filter(Boolean).pop();

  return (
    <div className="mx-3 mb-1 mt-2 overflow-hidden rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-panel)_55%,transparent)] backdrop-blur-md">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={agents.map((a) => a.label).join("\n")}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-[11px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text-2)]"
      >
        {/* live ping dot */}
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-accent)] opacity-70" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
        </span>
        <Waypoints size={12} className="shrink-0 text-[var(--color-accent)]" />
        <span className="shrink-0 text-[var(--color-text-2)]">
          <CadencedShimmer>{`${n} background agent${n === 1 ? "" : "s"} working`}</CadencedShimmer>
        </span>
        {!open && recent && (
          <span className="min-w-0 truncate text-[var(--color-faint)]">· {recent}</span>
        )}
        <ChevronDown
          size={12}
          className={`ml-auto shrink-0 text-[var(--color-faint)] transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <div className="flex flex-wrap gap-1.5 border-t border-[var(--color-border)] px-3 py-2">
          {agents.map((a) => (
            <FleetCard key={a.id} agent={a} />
          ))}
        </div>
      )}
    </div>
  );
}
