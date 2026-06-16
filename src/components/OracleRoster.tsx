/**
 * The oracle roster — the fleet of long-lived agent sessions (`aios-<identity>`
 * multiplexer sessions, e.g. a `claude` running in its own tmux/psmux session),
 * plus an all-sessions attach surface. Full CRUD: create / rename / delete
 * (delete is two-click-to-confirm). Self-polls so spawns/kills elsewhere reflect
 * automatically. Works on macOS/Linux (tmux) and Windows (psmux).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import {
  Check,
  ChevronRight,
  Eye,
  EyeOff,
  Pencil,
  Play,
  Plus,
  Radio,
  RefreshCw,
  Terminal,
  Trash2,
  X,
} from "lucide-react";

import {
  createOracle,
  deleteOracle,
  killTmuxSession,
  listOracles,
  listTmuxSessions,
  renameOracle,
  setSessionLabel,
  type OracleInfo,
  type TmuxSession,
} from "../lib/pty";
import { isTauriRuntime } from "../lib/tauri";
import { loadSettings } from "../lib/settings";

interface Props {
  iconsOnly?: boolean;
  onAttachOracle: (identity: string) => void;
  onAttachTmux: (socket: string, session: string, label?: string) => void;
  moneyAgentsSlot?: ReactNode;
  chatpaneAgentsOnly?: boolean;
}

/** The identity for the one-tap "spawn an oracle" shortcut: the user's saved
 *  default (Settings → oracles), else a slug of their name, else "agent". */
const defaultOracleIdentity = (): string => {
  const s = loadSettings();
  const slug = (v: string) =>
    v.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug(s.primaryOracleId || "") || slug(s.userName || "") || "agent";
};

/** The multiplexer socket oracles live on (same configurable namespace as the
 *  persistent terminals — Settings → "terminal socket"). */
const oracleSocket = (): string => loadSettings().terminalSocket || "aios";

const HIDDEN_KEY = "aios.hiddenOracles";
const loadHidden = (): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(HIDDEN_KEY) || "[]"));
  } catch {
    return new Set();
  }
};

const COLLAPSE_KEY = "aios.agentsCollapsed";

export function OracleRoster({
  iconsOnly = false,
  onAttachOracle,
  onAttachTmux,
  moneyAgentsSlot,
  chatpaneAgentsOnly = false,
}: Props) {
  const nativeReady = isTauriRuntime();
  const [oracles, setOracles] = useState<OracleInfo[]>([]);
  const [sessions, setSessions] = useState<TmuxSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [spawning, setSpawning] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(loadHidden);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === "1");

  const toggleCollapsed = useCallback(() => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      return next;
    });
  }, []);

  const toggleHidden = useCallback((identity: string, hide: boolean) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (hide) next.add(identity);
      else next.delete(identity);
      localStorage.setItem(HIDDEN_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    setError(null);
    if (!nativeReady) {
      setOracles([]);
      setSessions([]);
      setLoading(false);
      return;
    }
    try {
      const sock = oracleSocket();
      const [o, s] = await Promise.all([listOracles(sock), listTmuxSessions(sock)]);
      setOracles(o);
      setSessions(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [nativeReady]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  // Non-oracle sessions, split into AIOS's own persistent terminals (`aios-term-*`
  // — the reattach surface) and everything else (misc tmux sessions).
  const otherSessions = sessions.filter((s) => !s.is_oracle);
  const reattachable = otherSessions.filter((s) => s.name.startsWith("aios-term-"));
  const plainSessions = otherSessions.filter((s) => !s.name.startsWith("aios-term-"));
  const visibleOracles = oracles.filter((o) => !hidden.has(o.identity));
  const hiddenOracles = oracles.filter((o) => hidden.has(o.identity));
  // Is the default oracle already running? If not, offer a one-tap spawn that
  // creates `aios-<identity>` running claude, then attaches to it.
  const defaultRunning = oracles.some((o) => o.identity === defaultOracleIdentity());
  const spawnDefault = async () => {
    setSpawning(true);
    setError(null);
    try {
      await createOracle(defaultOracleIdentity(), "claude --dangerously-skip-permissions", oracleSocket());
      await refresh();
      onAttachOracle(defaultOracleIdentity());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSpawning(false);
    }
  };

  if (iconsOnly) {
    return (
      <div className="flex flex-col items-center gap-1 border-t border-[var(--color-border)] pt-2">
        <button
          onClick={toggleCollapsed}
          className="grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
          title={`agents (${oracles.length})`}
        >
          <Radio size={14} />
        </button>
        {!collapsed && nativeReady && !defaultRunning && (
          <button
            onClick={spawnDefault}
            disabled={spawning}
            className="grid h-8 w-8 place-items-center rounded-md border border-dashed border-[var(--color-border)] text-[var(--color-accent)] transition-colors hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-panel-2)] disabled:opacity-60"
            title="spawn an oracle"
          >
            {spawning ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
          </button>
        )}
        {!collapsed &&
          visibleOracles.slice(0, 8).map((o) => (
            <button
              key={o.session}
              onClick={() => onAttachOracle(o.identity)}
              className="grid h-8 w-8 place-items-center rounded-md transition-colors hover:bg-[var(--color-panel-2)]"
              title={`attach ${o.display_name}`}
            >
              <span
                className={`status-dot ${
                  o.attached ? "status-dot--active" : o.running ? "status-dot--idle" : "status-dot--cold"
                }`}
              />
            </button>
          ))}
        {/* detached terminals (reattach) as terminal icons */}
        {!collapsed &&
          reattachable.slice(0, 4).map((s) => (
            <button
              key={`${s.socket}/${s.name}`}
              onClick={() => onAttachTmux(s.socket, s.name, s.label?.trim() || s.name)}
              className="grid h-8 w-8 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              title={`reattach ${s.label?.trim() || s.name}`}
            >
              <Terminal size={13} />
            </button>
          ))}
        {moneyAgentsSlot}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* ---- oracles ---- */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <button
            onClick={toggleCollapsed}
            className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
            title={collapsed ? "show agents" : "hide agents"}
          >
            <ChevronRight size={11} className={`transition-transform ${collapsed ? "" : "rotate-90"}`} />
            agents
            {collapsed && oracles.length > 0 && (
              <span className="text-[var(--color-faint)]">({oracles.length})</span>
            )}
          </button>
          {!collapsed && nativeReady && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => setCreating((v) => !v)}
                className="rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-accent)]"
                title="New oracle"
              >
                <Plus size={12} />
              </button>
              <button
                onClick={refresh}
                className="rounded p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                title="Refresh"
              >
                <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          )}
        </div>

        {!collapsed && creating && (
          <CreateOracleForm
            onCancel={() => setCreating(false)}
            onCreate={async (name, launch) => {
              try {
                await createOracle(name, launch ? "claude --dangerously-skip-permissions" : undefined);
                setCreating(false);
                await refresh();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              }
            }}
          />
        )}

        {!collapsed && error && (
          <p className="text-[11px] leading-snug text-[var(--color-danger)]">{error}</p>
        )}

        {!collapsed && (
        <div className="flex flex-col gap-1">
          {nativeReady && !defaultRunning && (
            <button
              onClick={spawnDefault}
              disabled={spawning}
              className="group flex items-center gap-2 rounded-md border border-dashed border-[var(--color-border)] px-2 py-1.5 text-left transition-colors hover:border-[var(--color-accent)]/60 hover:bg-[var(--color-panel-2)] disabled:opacity-60"
              title={`spawn your oracle (aios-${defaultOracleIdentity()})`}
            >
              {spawning ? (
                <RefreshCw size={13} className="shrink-0 animate-spin text-[var(--color-accent)]" />
              ) : (
                <Play size={13} className="shrink-0 text-[var(--color-accent)]" />
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12px] text-[var(--color-text)]">
                  {spawning ? `spawning ${defaultOracleIdentity()}…` : "spawn an oracle"}
                </div>
                <div className="truncate text-[10px] text-[var(--color-faint)]">
                  {defaultOracleIdentity()} · offline
                </div>
              </div>
            </button>
          )}
          {visibleOracles.map((o) => (
              <OracleRow
                key={o.session}
                oracle={o}
                onAttach={() => onAttachOracle(o.identity)}
                onHide={() => toggleHidden(o.identity, true)}
                onRename={async (to) => {
                  try {
                    await renameOracle(o.identity, to, oracleSocket());
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
                onDelete={async (force) => {
                  try {
                    await deleteOracle(o.identity, force, oracleSocket());
                    await refresh();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  }
                }}
              />
            ))}
          {moneyAgentsSlot}
        </div>
        )}

        {!collapsed && hiddenOracles.length > 0 && (
          <div className="flex flex-col gap-1">
            <button
              onClick={() => setShowHidden((v) => !v)}
              className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)]"
            >
              <ChevronRight size={11} className={`transition-transform ${showHidden ? "rotate-90" : ""}`} />
              hidden ({hiddenOracles.length})
            </button>
            {showHidden &&
              hiddenOracles.map((o) => (
                <div
                  key={o.session}
                  className="group flex items-center gap-2 rounded-md px-2 py-1.5 opacity-60 transition-opacity hover:opacity-100"
                >
                  <span className="status-dot status-dot--cold shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-[var(--color-muted)]">
                    {o.display_name}
                  </span>
                  <button
                    onClick={() => toggleHidden(o.identity, false)}
                    className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                    title="unhide"
                  >
                    <Eye size={12} />
                  </button>
                </div>
              ))}
          </div>
        )}

        {/* ---- live usage (5h / 7d rate windows) ---- */}
        {/* usage moved to the sidebar footer (App.tsx) so it's always visible —
            it used to vanish whenever this AGENTS section was collapsed. */}
      </div>

      {/* ---- detached terminals (reattach surface) ---- */}
      {/* AIOS's own `aios-term-*` sessions that have no open pane right now —
          close a pane (or the whole app) and its session keeps running here, so
          you can pop it back into a new pane. Shown even in chatpaneAgentsOnly
          (the focused sidebar mode) because reattaching what you closed is a
          headline feature; only the misc "other sessions" list stays hidden there. */}
      {!collapsed && reattachable.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted)]">
            reattach ({reattachable.length})
          </div>
          {reattachable.map((s) => (
            <TmuxRow
              key={`${s.socket}/${s.name}`}
              session={s}
              onAttach={() => onAttachTmux(s.socket, s.name, s.label?.trim() || s.name)}
              onRename={async (to) => {
                try {
                  await setSessionLabel(s.socket, s.name, to);
                  await refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
              onKill={async () => {
                try {
                  await killTmuxSession(s.socket, s.name);
                  await refresh();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            />
          ))}
        </div>
      )}

      {/* ---- other (non-AIOS) tmux sessions ---- */}
      {!collapsed && plainSessions.length > 0 && !chatpaneAgentsOnly && (
        <div className="flex flex-col gap-1">
          <button
            onClick={() => setShowAll((v) => !v)}
            className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            <ChevronRight
              size={11}
              className={`transition-transform ${showAll ? "rotate-90" : ""}`}
            />
            other sessions ({plainSessions.length})
          </button>
          {showAll && (
            <div className="flex flex-col gap-1">
              {plainSessions.map((s) => (
                <TmuxRow
                  key={`${s.socket}/${s.name}`}
                  session={s}
                  onAttach={() => onAttachTmux(s.socket, s.name)}
                  onKill={async () => {
                    try {
                      await killTmuxSession(s.socket, s.name);
                      await refresh();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One oracle row — attach on click, rename inline, delete with confirm. */
function OracleRow({
  oracle,
  onAttach,
  onRename,
  onDelete,
  onHide,
}: {
  oracle: OracleInfo;
  onAttach: () => void;
  onRename: (to: string) => void;
  onDelete: (force: boolean) => void;
  onHide: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [draft, setDraft] = useState(oracle.identity);

  // Auto-clear the delete confirm if the user moves on.
  useEffect(() => {
    if (!confirmDel) return;
    const t = setTimeout(() => setConfirmDel(false), 2500);
    return () => clearTimeout(t);
  }, [confirmDel]);

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          if (v && v !== oracle.identity) onRename(v);
          setEditing(false);
        }}
        className="flex items-center gap-1 rounded-lg border border-[var(--color-accent)]/50 bg-[var(--color-panel-2)] px-2 py-1.5"
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--color-text)] outline-none"
        />
        <button
          type="submit"
          // Commit BEFORE the input's onBlur fires — otherwise clicking save
          // blurs the input, cancels edit-mode, and the rename never submits.
          onMouseDown={(e) => e.preventDefault()}
          className="text-[var(--color-success)]"
          title="save"
        >
          <Check size={13} />
        </button>
      </form>
    );
  }

  return (
    <div className="group flex flex-col gap-1 rounded-md px-2 py-1 transition-colors hover:bg-[var(--color-panel-2)]/60">
      <div className="flex items-center gap-2.5">
      <button onClick={onAttach} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span
          className={`status-dot shrink-0 ${
            oracle.attached
              ? "status-dot--active"
              : oracle.running
                ? "status-dot--idle"
                : "status-dot--cold"
          }`}
        />
        <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
          <span className="truncate text-[12px] text-[var(--color-text)]">{oracle.display_name}</span>
          <span className="truncate text-[9px] text-[var(--color-faint)] opacity-0 transition-opacity group-hover:opacity-100">
            {oracle.running ? oracle.session : "not running"}
          </span>
        </div>
      </button>

      {/* row actions */}
      <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={onHide}
          className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
          title="hide"
        >
          <EyeOff size={11} />
        </button>
        <button
          onClick={() => {
            setDraft(oracle.identity);
            setEditing(true);
          }}
          className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]"
          title="rename"
        >
          <Pencil size={11} />
        </button>
        {confirmDel ? (
          <button
            onClick={() => onDelete(false)}
            className="rounded p-1 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
            title="click again to confirm"
          >
            <Check size={12} />
          </button>
        ) : (
          <button
            onClick={() => setConfirmDel(true)}
            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-bg)] hover:text-[var(--color-danger)]"
            title="delete"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

/** One session row — attach (reattach) on click, optional inline rename, and a
 *  two-click-confirm kill. Shows the friendly label (window name) with the raw
 *  session name as the secondary line. */
function TmuxRow({
  session,
  onAttach,
  onKill,
  onRename,
}: {
  session: TmuxSession;
  onAttach: () => void;
  onKill: () => void;
  onRename?: (to: string) => void;
}) {
  const [confirmKill, setConfirmKill] = useState(false);
  const [editing, setEditing] = useState(false);
  const display = session.label?.trim() || session.name;
  const [draft, setDraft] = useState(display);

  // Auto-clear the kill confirm if the user moves on.
  useEffect(() => {
    if (!confirmKill) return;
    const t = setTimeout(() => setConfirmKill(false), 2500);
    return () => clearTimeout(t);
  }, [confirmKill]);

  if (editing && onRename) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = draft.trim();
          if (v && v !== display) onRename(v);
          setEditing(false);
        }}
        className="flex items-center gap-1 rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-panel-2)] px-2 py-1.5"
      >
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setEditing(false)}
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--color-text)] outline-none"
        />
        <button type="submit" onMouseDown={(e) => e.preventDefault()} className="text-[var(--color-success)]" title="save">
          <Check size={13} />
        </button>
      </form>
    );
  }

  return (
    <div className="group flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-panel-2)]/30 px-2 py-1.5 transition-colors hover:border-[var(--color-border-strong)] hover:bg-[var(--color-panel-2)]">
      <button
        onClick={onAttach}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        title={`reattach ${session.socket}:${session.name}`}
      >
        <span
          className={`status-dot shrink-0 ${session.attached ? "status-dot--active" : "status-dot--cold"}`}
          title={session.attached ? "open in a pane" : "detached — click to reattach"}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[12px] text-[var(--color-text-2)]">{display}</span>
          <span className="truncate text-[9px] text-[var(--color-faint)]">
            {session.attached ? "open" : "detached"} · {session.socket}
          </span>
        </div>
      </button>

      <div className="flex shrink-0 items-center gap-0.5">
        {onRename && (
          <button
            onClick={() => {
              setDraft(display);
              setEditing(true);
            }}
            className="rounded p-1 text-[var(--color-muted)] opacity-0 transition-opacity hover:bg-[var(--color-bg)] hover:text-[var(--color-text)] group-hover:opacity-100"
            title="rename"
          >
            <Pencil size={11} />
          </button>
        )}
        {confirmKill ? (
          <button
            onClick={onKill}
            className="rounded p-1 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
            title="click again to confirm kill"
          >
            <Check size={12} />
          </button>
        ) : (
          <button
            onClick={() => setConfirmKill(true)}
            className="rounded p-1 text-[var(--color-muted)] opacity-0 transition-opacity hover:bg-[var(--color-bg)] hover:text-[var(--color-danger)] group-hover:opacity-100"
            title="kill session"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Inline "new oracle" form: name + optional launch-claude. */
function CreateOracleForm({
  onCreate,
  onCancel,
}: {
  onCreate: (name: string, launchClaude: boolean) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [launch, setLaunch] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onCreate(name.trim(), launch);
      }}
      className="flex flex-col gap-2 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-panel-2)]/60 p-2"
    >
      <div className="flex items-center gap-1">
        <span className="font-mono text-[11px] text-[var(--color-faint)]">aios-</span>
        <input
          ref={ref}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="name"
          className="min-w-0 flex-1 bg-transparent font-mono text-[12px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)]"
        />
        <button type="button" onClick={onCancel} className="text-[var(--color-muted)]" title="cancel">
          <X size={13} />
        </button>
      </div>
      <label className="flex cursor-pointer items-center gap-1.5 text-[10px] text-[var(--color-muted)]">
        <input
          type="checkbox"
          checked={launch}
          onChange={(e) => setLaunch(e.target.checked)}
          className="accent-[var(--color-accent)]"
        />
        launch claude on start
        <span className="font-mono text-[9px] text-[var(--color-faint)]" title="runs: claude --dangerously-skip-permissions">
          (skips permission prompts)
        </span>
      </label>
      <button
        type="submit"
        disabled={!name.trim()}
        className="rounded-md bg-[var(--color-accent)] px-2 py-1 text-[11px] font-semibold text-[var(--color-bg)] transition-colors hover:bg-[var(--color-accent-hover)] disabled:opacity-40"
      >
        create
      </button>
    </form>
  );
}
