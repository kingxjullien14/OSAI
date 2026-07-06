import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clock,
  CornerDownLeft,
  Download,
  Folder,
  History,
  RotateCcw,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";

import { PaneEmpty } from "./ui";
import { cleanSessionLabel } from "../lib/chat";
import { PaneMenu, type PaneMenuEntry } from "./PaneMenu";
import {
  deleteChats,
  exportChat,
  listChatHistory,
  listTrash,
  purgeTrash,
  restoreChats,
  searchChatHistory,
  setStarred,
  type HistoryEntry,
  type SearchHit,
  type TrashEntry,
} from "../lib/chatHistory";
import { groupByDate, monthsAgoCutoff, selectForCleanup } from "../lib/historyManage";

interface Props {
  /** Reopen a past conversation (resume) — App wires this to `resumeChat`. */
  /** Open (resume) a chat. `findText` (the active search query) deep-links the
   *  resumed pane to the first matching message via its find bar. */
  onOpenChat: (entry: HistoryEntry, findText?: string) => void;
}

/** A browse/search result row — a history entry, optionally with a content-match
 *  snippet (present only for cross-history search hits). */
type ResultEntry = HistoryEntry & { snippet?: string; matches?: number };

const CLEANUP_OPTIONS: Array<{ label: string; months: number }> = [
  { label: "1 month", months: 1 },
  { label: "3 months", months: 3 },
  { label: "6 months", months: 6 },
  { label: "12 months", months: 12 },
];

/** Compact "time since" from unix SECONDS. */
function since(sec: number): string {
  if (!sec) return "";
  const d = Math.max(0, Math.floor(Date.now() / 1000) - sec);
  if (d < 60) return "just now";
  const m = Math.floor(d / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  const w = Math.floor(days / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function base(path: string): string {
  if (!path) return "";
  const clean = path.replace(/[\\/]+$/, "");
  return clean.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

export function HistoryPane({ onOpenChat }: Props) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [trash, setTrash] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<"history" | "trash">("history");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cleanupMenu, setCleanupMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<{ ids: string[]; label: string } | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    Promise.all([listChatHistory(), listTrash()])
      .then(([e, t]) => {
        setEntries(e);
        setTrash(t);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  // Refresh when a chat is recorded elsewhere (a new pane that gets sent + closed)
  // or when the window regains focus — so the list never goes stale while open.
  useEffect(() => {
    let t: number | undefined;
    const ping = () => {
      window.clearTimeout(t);
      t = window.setTimeout(refresh, 300);
    };
    window.addEventListener("aios:history-changed", ping);
    window.addEventListener("focus", ping);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("aios:history-changed", ping);
      window.removeEventListener("focus", ping);
    };
  }, [refresh]);

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote((n) => (n === msg ? null : n)), 2200);
  };

  // cross-history full-text search (debounced): finds matches in message CONTENT
  // across ALL logs; the result list also folds in title/cwd matches from the
  // loaded rows. < 2 chars clears it.
  const [contentHits, setContentHits] = useState<SearchHit[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setContentHits([]);
      return;
    }
    const t = window.setTimeout(() => {
      searchChatHistory(q)
        .then(setContentHits)
        .catch(() => setContentHits([]));
    }, 280);
    return () => window.clearTimeout(t);
  }, [query]);

  const searching = query.trim().length >= 2;
  const searchResults = useMemo<ResultEntry[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const byId = new Map<string, ResultEntry>();
    for (const h of contentHits) byId.set(h.id, h); // content matches (with snippet)
    for (const e of entries) {
      if (byId.has(e.id)) continue;
      if (`${e.title} ${e.last_user} ${e.cwd}`.toLowerCase().includes(q)) byId.set(e.id, e);
    }
    return [...byId.values()].sort((a, b) => b.mtime - a.mtime);
  }, [query, contentHits, entries]);

  const starred = useMemo(() => entries.filter((e) => e.starred), [entries]);
  const groups = useMemo(
    () => groupByDate(entries.filter((e) => !e.starred), Date.now()),
    [entries],
  );

  const toggleStar = (e: HistoryEntry) => {
    const next = !e.starred;
    setEntries((prev) => prev.map((x) => (x.id === e.id ? { ...x, starred: next } : x)));
    // failure reverts the optimistic flip — SAY so, or the star looks haunted.
    setStarred(e.id, next).catch(() => {
      flash("couldn't update star");
      refresh();
    });
  };
  const toggleSelect = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const clearSel = () => setSelected(new Set());

  // every list action surfaces its failure — a silent .catch left the confirm
  // bar hanging open and the button looking like it did nothing.
  const doDelete = (ids: string[]) => {
    if (!ids.length) return;
    deleteChats(ids)
      .then(() => {
        flash(`moved ${ids.length} to trash`);
        clearSel();
        setConfirm(null);
        refresh();
      })
      .catch(() => {
        flash("delete failed — try again");
        setConfirm(null);
      });
  };
  const doRestore = (ids: string[]) =>
    restoreChats(ids)
      .then(() => {
        flash(`restored ${ids.length}`);
        refresh();
      })
      .catch(() => flash("restore failed — try again"));
  const doPurge = (ids?: string[]) =>
    purgeTrash(ids)
      .then(() => {
        flash(ids ? "deleted forever" : "trash emptied");
        refresh();
      })
      .catch(() => flash("couldn't empty trash — try again"));
  const doExport = async (ids: string[]) => {
    try {
      const parts = await Promise.all(ids.map((id) => exportChat(id, "md")));
      const md = parts.filter(Boolean).join("\n\n---\n\n");
      await navigator.clipboard.writeText(md);
      flash("copied markdown to clipboard");
    } catch {
      flash("export failed");
    }
  };
  const startCleanup = (months: number, label: string) => {
    const ids = selectForCleanup(entries, monthsAgoCutoff(Date.now(), months), true);
    if (!ids.length) {
      flash(`nothing older than ${label}`);
      return;
    }
    setConfirm({
      ids,
      label: `${ids.length} chat${ids.length === 1 ? "" : "s"} older than ${label} (starred kept)`,
    });
  };

  /** Bulk-star every selected conversation (floating action bar). */
  const doStar = (ids: string[]) => {
    const set = new Set(ids);
    setEntries((prev) => prev.map((x) => (set.has(x.id) ? { ...x, starred: true } : x)));
    Promise.all(ids.map((id) => setStarred(id, true))).catch(() => refresh());
    clearSel();
  };

  const anySelected = selected.size > 0;
  const engineColor = (engine: string): string => {
    const e = (engine || "claude").toLowerCase();
    if (e.includes("codex") || e.includes("gpt")) return "var(--color-success)";
    if (e.includes("opencode") || e.includes("nemotron")) return "var(--color-info)";
    return "var(--color-accent)";
  };

  // per-row context menu (W3): resume / star / export / delete at the pointer.
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: ResultEntry } | null>(null);
  const rowMenuItems = (e: ResultEntry): PaneMenuEntry[] => [
    {
      key: "open",
      label: "Open conversation",
      onSelect: () => onOpenChat(e, searching ? query.trim() : undefined),
    },
    { key: "star", label: e.starred ? "Unstar" : "Star", onSelect: () => toggleStar(e) },
    { key: "export", label: "Export markdown", onSelect: () => void doExport([e.id]) },
    { key: "sep", separator: true },
    {
      key: "delete",
      label: "Move to trash",
      danger: true,
      onSelect: () => doDelete([e.id]),
    },
  ];
  const row = (e: ResultEntry) => {
    const isSel = selected.has(e.id);
    return (
      <div
        key={e.id}
        onContextMenu={(ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          setCtxMenu({ x: ev.clientX, y: ev.clientY, entry: e });
        }}
        className={`group/hist flex items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-all ${
          isSel
            ? "border-[color-mix(in_srgb,var(--color-accent)_32%,transparent)] bg-[var(--color-accent-soft)] shadow-[var(--aios-glow-soft)]"
            : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-panel-2)]"
        }`}
      >
        {/* select — hidden until hover, shown while a selection is active */}
        <input
          type="checkbox"
          checked={isSel}
          onChange={() => toggleSelect(e.id)}
          title="select"
          className={`h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--color-accent)] transition-opacity ${
            isSel || anySelected ? "opacity-100" : "opacity-0 group-hover/hist:opacity-100"
          }`}
        />
        {/* star — gold + always shown when starred, else a faint hover affordance */}
        <button
          type="button"
          onClick={() => toggleStar(e)}
          title={e.starred ? "unstar" : "star"}
          className={`shrink-0 rounded p-0.5 transition-opacity ${
            e.starred ? "opacity-100" : "opacity-0 group-hover/hist:opacity-100"
          }`}
        >
          <Star
            size={13}
            className={
              e.starred
                ? "fill-[var(--color-accent)] text-[var(--color-accent)]"
                : "text-[var(--color-faint)] hover:text-[var(--color-muted)]"
            }
          />
        </button>
        <button
          type="button"
          onClick={() => onOpenChat(e, searching ? query.trim() : undefined)}
          title={searching ? "open at the matching message" : "open conversation"}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
        >
          <RotateCcw
            size={13}
            className="mt-0.5 shrink-0"
            style={{ color: engineColor(e.engine) }}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate font-sans text-[12.5px] leading-tight text-[var(--color-text)]">
                {cleanSessionLabel(e.title) || "(untitled chat)"}
              </span>
              <span
                style={{
                  color: engineColor(e.engine),
                  borderColor: `color-mix(in srgb, ${engineColor(e.engine)} 40%, transparent)`,
                }}
                className="shrink-0 rounded border px-1 py-0.5 font-mono text-[9px]"
              >
                {e.engine || "claude"}
              </span>
            </span>
            {(e.snippet || e.last_user) && (
              <span className="mt-0.5 line-clamp-2 font-sans text-[11px] leading-snug text-[var(--color-muted)]">
                {e.snippet || e.last_user}
                {e.matches && e.matches > 1 ? (
                  <span className="text-[var(--color-faint)]">{` · ${e.matches} matches`}</span>
                ) : null}
              </span>
            )}
            <span className="mt-1 flex items-center gap-1.5 truncate font-sans text-[10.5px] text-[var(--color-faint)]">
              {e.cwd && (
                <span className="inline-flex items-center gap-1">
                  <Folder size={10} /> {base(e.cwd)}
                </span>
              )}
              {e.cwd && <span className="text-[var(--color-border-strong)]">·</span>}
              <span className="inline-flex items-center gap-1">
                <Clock size={10} /> {since(e.mtime)}
              </span>
              {e.model && <span className="text-[var(--color-border-strong)]">·</span>}
              {e.model && <span className="truncate">{e.model}</span>}
            </span>
          </span>
          <span className="hidden shrink-0 items-center self-center opacity-0 transition-opacity group-hover/hist:flex group-hover/hist:opacity-100">
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-panel)] px-1.5 py-0.5 font-sans text-[10px] text-[var(--color-text-2)]">
              {searching ? "jump" : "resume"} <CornerDownLeft size={10} />
            </span>
          </span>
        </button>
      </div>
    );
  };

  const headerBtn =
    "flex items-center gap-1 rounded-md px-2 py-1 font-sans text-[11.5px] transition-colors";

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[var(--color-pane)]">
      <div className="pane-header justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <History size={14} className="shrink-0 text-[var(--color-accent)]" />
          <span className="font-sans text-[12.5px] font-medium text-[var(--color-text)]">
            History
          </span>
          <span className="font-mono text-[10.5px] text-[var(--color-faint)]">
            {entries.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setView((v) => (v === "trash" ? "history" : "trash"))}
            className={`${headerBtn} ${view === "trash" ? "bg-[var(--color-panel-2)] text-[var(--color-text)]" : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"}`}
            title="trash (recoverable)"
          >
            <Trash2 size={12} /> Trash{trash.length ? ` · ${trash.length}` : ""}
          </button>
          {view === "history" && (
            <button
              type="button"
              onClick={(e) => {
                const r = e.currentTarget.getBoundingClientRect();
                setCleanupMenu({ x: r.right, y: r.bottom + 4 });
              }}
              className={`${headerBtn} text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]`}
              title="bulk-delete older conversations (keeps starred)"
            >
              Clean up ▾
            </button>
          )}
        </div>
      </div>

      {/* search (history view only) — the house inset field */}
      {view === "history" && (
        <div className="border-b border-[var(--color-border)] px-2 py-1.5">
          <div className="relative">
            <Search
              size={12}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-faint)]"
            />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="search titles + message content"
              spellCheck={false}
              className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]/70 py-1 pl-7 pr-6 font-sans text-[12px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]/60 placeholder:text-[var(--color-faint)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                title="clear"
                className="absolute right-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded text-[var(--color-faint)] hover:text-[var(--color-text)]"
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* multi-select action bar — a floating glass pill, bottom-center (mockup) */}
      {view === "history" && selected.size > 0 && (
        <div className="scale-in absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_32%,transparent)] bg-[var(--aios-glass-bg-strong)] py-1.5 pl-4 pr-2 shadow-[0_16px_44px_-16px_var(--aios-glow-accent)] backdrop-blur-xl">
          <span className="font-sans text-[12px] text-[var(--color-text)]">
            <b className="font-mono text-[var(--color-accent)]">{selected.size}</b> selected
          </span>
          <button
            type="button"
            onClick={() => doStar([...selected])}
            className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
          >
            <Star size={12} /> star
          </button>
          <button
            type="button"
            onClick={() => doExport([...selected])}
            className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2.5 py-1 text-[11.5px] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
          >
            <Download size={12} /> export
          </button>
          <button
            type="button"
            onClick={() => doDelete([...selected])}
            className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-danger)_35%,transparent)] px-2.5 py-1 text-[11.5px] text-[var(--color-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-danger)_12%,transparent)]"
          >
            <Trash2 size={12} /> delete
          </button>
          <button
            type="button"
            onClick={clearSel}
            title="clear selection"
            className="grid h-6 w-6 place-items-center rounded-full text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {/* cleanup confirm */}
      {confirm && (
        <div className="flex items-center gap-2 border-b border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 font-sans text-[11.5px] text-[var(--color-text-2)]">
          <span className="flex-1">Move {confirm.label} to trash?</span>
          <button
            type="button"
            onClick={() => doDelete(confirm.ids)}
            className="rounded-md bg-[var(--color-danger)] px-2.5 py-1 font-medium text-[var(--color-bg)]"
          >
            move to trash
          </button>
          <button
            type="button"
            onClick={() => setConfirm(null)}
            className="rounded-md px-2 py-1 text-[var(--color-muted)] hover:text-[var(--color-text)]"
          >
            cancel
          </button>
        </div>
      )}

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {view === "trash" ? (
          trash.length === 0 ? (
            <PaneEmpty icon={Trash2} title="trash is empty" hint="deleted conversations land here, recoverable until purged." />
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between px-1.5 pb-1">
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                  {trash.length} in trash
                </span>
                <button
                  type="button"
                  onClick={() => doPurge(undefined)}
                  className="font-sans text-[10.5px] text-[var(--color-danger)] hover:underline"
                >
                  empty trash
                </button>
              </div>
              {trash.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-lg border border-transparent px-1.5 py-1.5 transition-all hover:border-[var(--color-border)] hover:bg-[var(--color-panel-2)]"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-sans text-[12.5px] text-[var(--color-text-2)]">
                      {cleanSessionLabel(t.title) || "(untitled chat)"}
                    </span>
                    <span className="font-mono text-[10px] text-[var(--color-faint)]">
                      deleted {since(t.deleted_at)}
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => doRestore([t.id])}
                    className={`${headerBtn} text-[var(--color-muted)] hover:text-[var(--color-text)]`}
                  >
                    <RotateCcw size={12} /> restore
                  </button>
                  <button
                    type="button"
                    onClick={() => doPurge([t.id])}
                    className={`${headerBtn} text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10`}
                    title="delete forever"
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )
        ) : loading && entries.length === 0 ? (
          <PaneEmpty icon={History} title="loading history…" />
        ) : entries.length === 0 ? (
          <PaneEmpty
            icon={History}
            title="no conversations yet"
            hint="your chats are saved here automatically — start one to see it."
          />
        ) : searching ? (
          searchResults.length === 0 ? (
            <PaneEmpty
              icon={Search}
              title="no matches"
              hint={`nothing in titles or messages matches "${query.trim()}".`}
            />
          ) : (
            <div className="flex flex-col gap-0.5">
              <div className="px-1.5 pb-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                {searchResults.length} result{searchResults.length === 1 ? "" : "s"}
              </div>
              {searchResults.map(row)}
            </div>
          )
        ) : (
          <div className="flex flex-col gap-2">
            {starred.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-1.5 pb-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                  <Star size={10} className="fill-[var(--color-accent)] text-[var(--color-accent)]" /> starred
                </div>
                {starred.map(row)}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.group}>
                <div className="px-1.5 pb-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
                  {g.group}
                </div>
                {g.entries.map(row)}
              </div>
            ))}
          </div>
        )}
      </div>

      {ctxMenu && (
        <PaneMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={rowMenuItems(ctxMenu.entry)}
          onClose={() => setCtxMenu(null)}
        />
      )}

      {/* cleanup menu — a solid PaneMenu like every other menu (the old
          surface-pop dropdown was the same stacking trap as files/browser) */}
      {cleanupMenu && (
        <PaneMenu
          x={cleanupMenu.x}
          y={cleanupMenu.y}
          items={[
            ...CLEANUP_OPTIONS.map((o) => ({
              key: `cl-${o.months}`,
              label: `Older than ${o.label}`,
              onSelect: () => startCleanup(o.months, o.label),
            })),
            { key: "sep", separator: true },
            { key: "note", label: "Starred conversations are kept", disabled: true, onSelect: () => {} },
          ]}
          onClose={() => setCleanupMenu(null)}
        />
      )}

      {/* transient note */}
      {note && (
        <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--color-panel-2)] px-3 py-1 font-sans text-[11px] text-[var(--color-text-2)] shadow-[var(--aios-shadow-pop)]">
          {note}
        </div>
      )}
    </div>
  );
}
