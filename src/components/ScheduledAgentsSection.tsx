import { useEffect, useState } from "react";
import { ChevronRight, MessageSquare, Play, Plus, RefreshCw, X } from "lucide-react";

import {
  SCHEDULED_AGENT_TEMPLATES,
  buildScheduledAgentRunCommand,
  createScheduledAgent,
  loadScheduledAgentSummaries,
  removeScheduledAgent,
  type ScheduledAgentSummary,
  type ScheduledAgentTemplate,
} from "../lib/scheduledAgents";
import { formatRelativeRunAge } from "../lib/controlCenter";

/** Cadence presets for the create form; "custom" reveals an interval input. */
const CADENCE_PRESETS = ["manual", "hourly", "daily", "weekly", "custom"] as const;
type CadenceMode = (typeof CADENCE_PRESETS)[number];

interface Props {
  iconsOnly?: boolean;
  embedded?: boolean;
  onOpenOverview: () => void;
  onOpenAgentChat: (id: string, label: string, command?: string) => void;
  agentChatStates?: Partial<Record<ScheduledAgentSummary["id"], ScheduledAgentChatState>>;
}

const COLLAPSE_KEY = "osai.scheduledAgentsCollapsed";

export type ScheduledAgentChatState = "open" | "running" | "saved" | "none";

function healthColor(health: ScheduledAgentSummary["health"]): string {
  if (health === "due") return "var(--color-accent)";
  if (health === "scheduled") return "var(--color-info)";
  return "var(--color-faint)"; // manual
}

function chatStateLabel(state: ScheduledAgentChatState): string {
  if (state === "open") return "attached";
  if (state === "running") return "running";
  if (state === "saved") return "resume";
  return "start";
}

function chatStateColor(state: ScheduledAgentChatState): string {
  if (state === "open") return "var(--color-success)";
  if (state === "running") return "var(--color-warning)";
  if (state === "saved") return "var(--color-info)";
  return "var(--color-muted)";
}

export function ScheduledAgentsSection({
  iconsOnly = false,
  embedded = false,
  onOpenOverview,
  onOpenAgentChat,
  agentChatStates = {},
}: Props) {
  const [summaries, setSummaries] = useState<ScheduledAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftPrompt, setDraftPrompt] = useState("");
  const [cadenceMode, setCadenceMode] = useState<CadenceMode>("manual");
  const [draftCustomCadence, setDraftCustomCadence] = useState("");
  const [draftCwd, setDraftCwd] = useState("");
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  const refresh = () => {
    setLoading(true);
    loadScheduledAgentSummaries()
      .then(setSummaries)
      .catch(() => setSummaries([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 20_000);
    return () => clearInterval(interval);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((value) => {
      const next = !value;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  };

  const open = (id: string, label: string) => onOpenAgentChat(id, label);
  const remove = (id: string) => {
    removeScheduledAgent(id);
    setSummaries((prev) => prev.filter((agent) => agent.id !== id));
  };
  // Fire a one-off run into a background chat (independent of the cadence).
  const runNow = (row: ScheduledAgentSummary) =>
    onOpenAgentChat(
      row.id,
      row.label,
      buildScheduledAgentRunCommand({ label: row.label, mission: row.currentJob }, "manual"),
    );
  // Pre-fill the create form from a starter template (the user then tweaks +
  // creates — e.g. point "url watch" at a real URL, set a cwd).
  const applyTemplate = (t: ScheduledAgentTemplate) => {
    setCreating(true);
    setDraftName(t.label);
    setDraftPrompt(t.mission);
    const isPreset = (CADENCE_PRESETS as readonly string[]).includes(t.schedule);
    setCadenceMode(isPreset ? (t.schedule as CadenceMode) : "custom");
    setDraftCustomCadence(isPreset ? "" : t.schedule);
  };
  const create = () => {
    const schedule = cadenceMode === "custom" ? draftCustomCadence.trim() || "manual" : cadenceMode;
    const agent = createScheduledAgent({
      label: draftName,
      mission: draftPrompt,
      schedule,
      cwd: draftCwd.trim() || undefined,
    });
    if (!agent) return;
    setDraftName("");
    setDraftPrompt("");
    setCadenceMode("manual");
    setDraftCustomCadence("");
    setDraftCwd("");
    setCreating(false);
    refresh();
    onOpenAgentChat(agent.id, agent.label);
  };
  // No defaults — the sidebar is empty until the user creates an agent.
  const rows = summaries;

  // One-click starters — pre-fill the create form so the feature's purpose is
  // obvious. Shown at the top of the form and in the empty state.
  const templateChips = (
    <div className="flex flex-wrap gap-1">
      {SCHEDULED_AGENT_TEMPLATES.map((t) => (
        <button
          key={t.label}
          type="button"
          onClick={() => applyTemplate(t)}
          title={`${t.blurb} · runs ${t.schedule}`}
          className="rounded-full border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel-2)_55%,transparent)] px-2 py-0.5 text-[10px] text-[var(--color-text-2)] backdrop-blur-md transition-all hover:border-[var(--color-accent)] hover:text-[var(--color-accent)] hover:shadow-[var(--osai-glow-soft)]"
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  if (iconsOnly) {
    return (
      <div className="flex flex-col items-center gap-1 pt-1">
        {/* soft hairline — matches the icon-rail space dividers (W1.6) */}
        <div className="mb-1 h-px w-8 bg-[var(--color-border)]" />
        <button
          type="button"
          onClick={onOpenOverview}
          className="grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
          title="open agents"
        >
          <MessageSquare size={18} />
        </button>
        {!collapsed &&
          rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => open(row.id, row.label)}
              className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--color-panel-2)]"
              title={`${row.label} · ${row.currentJob}`}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: healthColor(row.health) }} />
            </button>
          ))}
      </div>
    );
  }

  const body = (
    <div className="flex flex-col gap-0.5">
      {creating && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            create();
          }}
          className="mb-1 flex flex-col gap-1.5 rounded-xl border border-[var(--color-accent)]/35 bg-[color-mix(in_srgb,var(--color-panel-2)_60%,transparent)] p-2.5 backdrop-blur-md"
        >
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)]">start from a template</div>
          {templateChips}
          <div className="my-0.5 h-px bg-[var(--color-border)]" />
          <input
            autoFocus
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            placeholder="agent name"
            className="rounded-lg border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_70%,transparent)] px-2 py-1.5 text-[11.5px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]/60"
          />
          <textarea
            value={draftPrompt}
            onChange={(event) => setDraftPrompt(event.target.value)}
            placeholder="what should it do each run? (the prompt) — e.g. summarize today's git activity"
            rows={3}
            className="resize-y rounded-lg border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_70%,transparent)] px-2 py-1.5 text-[11.5px] leading-relaxed text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]/60"
          />
          <label className="flex items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
            <span className="shrink-0">runs</span>
            <select
              value={cadenceMode}
              onChange={(event) => setCadenceMode(event.target.value as CadenceMode)}
              title="a cadence makes the agent pulse on its own in a background chat (with a clickable notification); 'manual' = run on demand"
              className="min-w-0 flex-1 rounded-lg border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_70%,transparent)] px-1.5 py-1 text-[11px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]/60"
            >
              <option value="manual">manual (run on demand)</option>
              <option value="hourly">hourly</option>
              <option value="daily">daily</option>
              <option value="weekly">weekly</option>
              <option value="custom">custom interval…</option>
            </select>
          </label>
          {cadenceMode === "custom" && (
            <input
              value={draftCustomCadence}
              onChange={(event) => setDraftCustomCadence(event.target.value)}
              placeholder="every 30 min · every 2 hours · every 3 days"
              className="rounded-lg border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_70%,transparent)] px-2 py-1.5 text-[11px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]/60"
            />
          )}
          <input
            value={draftCwd}
            onChange={(event) => setDraftCwd(event.target.value)}
            placeholder="working directory (optional — defaults to home)"
            spellCheck={false}
            className="rounded-lg border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_70%,transparent)] px-2 py-1.5 font-mono text-[10.5px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]/60"
          />
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={() => setCreating(false)}
              className="rounded-md px-2 py-1 text-[10px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
            >
              cancel
            </button>
            <button
              type="submit"
              className="press rounded-lg bg-[var(--color-accent)] px-2.5 py-1 text-[10px] font-semibold text-[var(--color-bg)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
              disabled={!draftName.trim()}
            >
              create
            </button>
          </div>
        </form>
      )}
      {rows.length === 0 && !creating ? (
        <div className="flex flex-col gap-1.5 rounded-lg bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] px-2 py-2">
          <div className="text-[10.5px] text-[var(--color-faint)]">
            recurring AI tasks — start from a template:
          </div>
          {templateChips}
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="self-start text-[10px] text-[var(--color-muted)] underline-offset-2 transition-colors hover:text-[var(--color-accent)] hover:underline"
          >
            or create a blank agent
          </button>
        </div>
      ) : (
        rows.map((row) => (
          <AgentRow
            key={row.id}
            row={row}
            chatState={agentChatStates[row.id] ?? "none"}
            onOpen={() => open(row.id, row.label)}
            onRun={() => runNow(row)}
            onRemove={() => remove(row.id)}
          />
        ))
      )}
    </div>
  );

  if (embedded) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-end gap-0.5">
          <button
            type="button"
            onClick={() => setCreating((value) => !value)}
            className="rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-accent)]"
            title="new chatpane agent"
          >
            <Plus size={12} />
          </button>
          <button
            type="button"
            onClick={refresh}
            className="rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            title="refresh agents"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        {body}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 border-t border-[var(--color-border)] pt-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
          title={collapsed ? "show agents" : "hide agents"}
        >
          <ChevronRight size={11} className={`transition-transform ${collapsed ? "" : "rotate-90"}`} />
          agents
        </button>
        {!collapsed && (
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => setCreating((value) => !value)}
              className="rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-accent)]"
              title="new chatpane agent"
            >
              <Plus size={12} />
            </button>
            <button
              type="button"
              onClick={refresh}
              className="rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              title="refresh agents"
            >
              <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        )}
      </div>
      {!collapsed && body}
    </div>
  );
}

function AgentRow({
  row,
  chatState,
  onOpen,
  onRun,
  onRemove,
}: {
  row: ScheduledAgentSummary;
  chatState: ScheduledAgentChatState;
  onOpen: () => void;
  onRun: () => void;
  onRemove: () => void;
}) {
  const controlLabel = chatStateLabel(chatState);
  const controlColor = chatStateColor(chatState);
  // cadence + last-run, e.g. "daily · last 2h ago" / "manual · never".
  const cadenceLine = `${row.primaryMetric} · last ${formatRelativeRunAge(row.lastRunAt)}`;
  // two-click delete: first click arms (danger state, auto-disarms), second fires.
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    if (!confirmRemove) return;
    const t = setTimeout(() => setConfirmRemove(false), 3000);
    return () => clearTimeout(t);
  }, [confirmRemove]);
  return (
    <div className="group relative flex min-w-0 items-center rounded-lg border border-transparent transition-all duration-150 hover:translate-x-0.5 hover:bg-[color-mix(in_srgb,var(--color-panel-2)_80%,transparent)]">
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-2 py-1 pl-1.5 pr-1 text-left"
        title={`${controlLabel} ${row.label} chatpane · ${cadenceLine}`}
      >
        {/* icon chip — same family as tool/oracle rows (W1.6); the health dot
            sits inside the chip, cadence moved into the subtitle. */}
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--color-panel-2)_70%,transparent)] transition-colors group-hover:bg-[var(--color-accent-soft)]">
          <span className="h-2 w-2 rounded-full" style={{ background: healthColor(row.health) }} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] text-[var(--color-text-2)] transition-colors group-hover:text-[var(--color-text)]">
            {row.label}
          </span>
          <span className="block truncate font-mono text-[10px] text-[var(--color-faint)]">
            {row.primaryMetric} · {row.currentJob}
          </span>
        </span>
        <span
          className="inline-flex h-[22px] shrink-0 items-center gap-1 rounded-full border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel-2)_55%,transparent)] px-2 font-mono text-[9.5px]"
          style={{ color: controlColor }}
        >
          <MessageSquare size={10} />
          {controlLabel}
        </span>
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onRun();
        }}
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--color-faint)] opacity-0 transition-all hover:text-[var(--color-accent)] group-hover:opacity-100 group-focus-within:opacity-100"
        title={`run ${row.label} now (one-off pulse in a background chat)`}
      >
        <Play size={11} />
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (confirmRemove) onRemove();
          else setConfirmRemove(true);
        }}
        className={`mr-1 grid h-6 shrink-0 place-items-center rounded transition-all ${
          confirmRemove
            ? "w-auto bg-[var(--color-danger)]/15 px-1.5 font-mono text-[9.5px] text-[var(--color-danger)] opacity-100"
            : "w-6 text-[var(--color-faint)] opacity-0 hover:text-[var(--color-danger)] group-hover:opacity-100 group-focus-within:opacity-100"
        }`}
        title={
          confirmRemove
            ? `click again to remove — clears ${row.label}'s saved chat + schedule state`
            : `remove ${row.label}`
        }
      >
        {confirmRemove ? "sure?" : <X size={12} />}
      </button>
    </div>
  );
}
