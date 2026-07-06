import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import {
  ChevronDown,
  CloudOff,
  Columns2,
  ExternalLink,
  Eye,
  FileText,
  Folder,
  KeyRound,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Tag,
  Trash2,
  Undo2,
} from "lucide-react";

import {
  collectTags,
  createDoc,
  createFolder,
  getDoc,
  listDocs,
  listFolders,
  listTrash,
  loadOutbox,
  replayOutboxLive,
  restoreDoc,
  saveOutbox,
  sncConfigure,
  sncDisconnect,
  sncStatus,
  SncConflictError,
  SncHttpError,
  trashDoc,
  updateDoc,
  type SncDoc,
  type SncDocMeta,
  type SncFolder,
  type SncStatus,
  type SncTrashRow,
} from "../lib/snc";
import { deriveTitle } from "../lib/sncCore";
import { diff3Merge, hasConflictMarkers } from "../lib/sncMerge";
import {
  isLocalId,
  newLocalId,
  queueTrash,
  upsertCreate,
  type OutboxCreate,
  type OutboxOp,
} from "../lib/sncOutbox";
import { openUrlInPane, paneMenuExtras } from "../lib/paneBus";
import { isTauriRuntime } from "../lib/tauri";
import { reportDiag } from "../lib/diag";
import { Dropdown, MenuItem } from "./chat/overlays";
import { Markdown } from "./chat/Markdown";

/** NotesPane — a native Stone & Chisel client (Notes × S&C epic, N2).
 *
 *  The pane is a mini app over the owner's own notes service
 *  (stone-n-chisel.vercel.app): S&C's Neon DB is the ONE truth, so anything
 *  written here — by hand or by an agent — shows up on every device through
 *  the S&C web app, and vice versa. Rust holds the access token (keychain);
 *  this component talks through src/lib/snc.ts.
 *
 *  Stage has three modes (⌘1/2/3): write / split / read — the reader reuses
 *  the chat's Markdown renderer, so notes read exactly like chat prose
 *  (fences with copy + run-in-terminal, tables, checklists, link chips).
 *  Autosave carries S&C's baseUpdatedAt guard — a 409 shows a conflict
 *  banner, never a silent clobber. */

/** Relative "edited" stamp — apple-notes-ish (Today / Yesterday / date). */
function relTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day === 1) return "yesterday";
  if (day < 7) return `${day}d ago`;
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/** A queued offline create, dressed as a full doc so the stage can edit it
 *  before it ever reaches the server. */
function localDoc(op: OutboxCreate): SncDoc {
  const iso = new Date(op.ts).toISOString();
  return {
    id: op.tempId,
    title: op.title ?? deriveTitle(op.content),
    content: op.content,
    kind: "md",
    tags: op.tags,
    pinned: false,
    isPublic: false,
    shareSlug: null,
    folderId: op.folderId,
    isTemplate: false,
    wordGoal: null,
    updatedAt: iso,
    createdAt: iso,
  };
}

/** S&C folder colors are free-form short names ("amber", "blue", …). Map the
 *  common ones to CSS color KEYWORDS (the component ratchet forbids hex) and
 *  pass anything else straight through — CSS ignores what it can't parse and
 *  the currentColor fallback still paints. */
function folderTint(color: string | null | undefined): string {
  if (!color) return "var(--color-accent)";
  const map: Record<string, string> = {
    red: "indianred",
    orange: "coral",
    amber: "goldenrod",
    yellow: "gold",
    lime: "yellowgreen",
    green: "mediumseagreen",
    emerald: "mediumseagreen",
    teal: "lightseagreen",
    cyan: "mediumturquoise",
    sky: "skyblue",
    blue: "cornflowerblue",
    indigo: "mediumslateblue",
    violet: "mediumpurple",
    purple: "mediumpurple",
    fuchsia: "orchid",
    pink: "palevioletred",
    rose: "palevioletred",
    slate: "slategray",
    gray: "slategray",
    grey: "slategray",
  };
  return map[color.toLowerCase()] ?? color;
}

const AUTOSAVE_MS = 800;

type StageView = "edit" | "split" | "read";

// ─── connect card ────────────────────────────────────────────────────────────

function ConnectCard({
  status,
  onConnected,
}: {
  status: SncStatus;
  onConnected: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState(status.baseUrl);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await sncConfigure({ baseUrl: baseUrl.trim() || undefined, token: token.trim() || undefined });
      onConnected();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 items-center justify-center overflow-y-auto bg-[var(--color-pane)] p-4">
      <div className="glass relative w-full max-w-sm overflow-hidden rounded-2xl border border-[var(--color-border)] p-5">
        {/* top filament — the deck's signature edge */}
        <div
          aria-hidden
          className="absolute inset-x-6 top-0 h-[2px] rounded-full bg-[linear-gradient(90deg,transparent,var(--color-accent),var(--aios-accent-2),transparent)] opacity-70"
        />
        <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
          <Sparkles size={11} className="text-[var(--color-accent)]" />
          stone &amp; chisel
        </div>
        <h2 className="text-[16px] font-semibold text-[var(--color-text)]">one notebook, everywhere</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-muted)]">
          notes live in your own Stone &amp; Chisel — the agents here and your
          other devices all write to the same place. paste an access token from{" "}
          <span className="text-[var(--color-text-2)]">Account → Connected apps</span>.
        </p>

        <label className="mt-4 block text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          server
        </label>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          spellCheck={false}
          placeholder="https://stone-n-chisel.vercel.app"
          className="mt-1 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]/60"
        />

        <label className="mt-3 block text-[10px] uppercase tracking-wider text-[var(--color-faint)]">
          access token
        </label>
        <div className="relative mt-1">
          <KeyRound
            size={12}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--color-faint)]"
          />
          <input
            value={token}
            onChange={(e) => setToken(e.target.value)}
            type="password"
            spellCheck={false}
            placeholder="snc_…"
            onKeyDown={(e) => {
              if (e.key === "Enter") void connect();
            }}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] py-1.5 pl-8 pr-2.5 font-mono text-[12px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]/60"
          />
        </div>

        {error && (
          <p className="mt-2 text-[11px] leading-snug text-[var(--color-danger)]">{error}</p>
        )}

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => openUrlInPane(baseUrl.trim() || status.baseUrl, "stone & chisel")}
            className="flex items-center gap-1 text-[11px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            <ExternalLink size={11} />
            open the web app
          </button>
          <button
            type="button"
            onClick={() => void connect()}
            disabled={busy || !token.trim()}
            className="rounded-lg bg-[var(--color-accent)] px-3.5 py-1.5 text-[12px] font-medium text-[var(--color-accent-fg)] transition-opacity disabled:opacity-40"
          >
            {busy ? "verifying…" : "connect"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── small chrome ────────────────────────────────────────────────────────────

function IconBtn({
  title,
  active,
  danger,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`grid h-6 w-6 place-items-center rounded-md transition-colors ${
        active
          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
          : `text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] ${
              danger ? "hover:text-[var(--color-danger)]" : "hover:text-[var(--color-text)]"
            }`
      }`}
    >
      {children}
    </button>
  );
}

function MenuHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1 pt-1.5 text-[9.5px] uppercase tracking-[0.16em] text-[var(--color-faint)]">
      {children}
    </div>
  );
}

const STAGE_VIEWS: Array<{ id: StageView; icon: React.ReactNode; label: string; key: string }> = [
  { id: "edit", icon: <Pencil size={11} />, label: "write", key: "⌘1" },
  { id: "split", icon: <Columns2 size={11} />, label: "split", key: "⌘2" },
  { id: "read", icon: <Eye size={11} />, label: "read", key: "⌘3" },
];

// ─── the pane ────────────────────────────────────────────────────────────────

export function NotesPane({
  onSend,
  paneKey,
}: {
  onSend?: (text: string) => void;
  /** window-shell key — lets the pane contribute entries to its ⋯ menu. */
  paneKey?: string;
}) {
  const native = isTauriRuntime();

  // connection
  const [conn, setConn] = useState<"boot" | "disconnected" | "ready">("boot");
  const [status, setStatus] = useState<SncStatus | null>(null);

  // library
  const [docs, setDocs] = useState<SncDocMeta[]>([]);
  const [folders, setFolders] = useState<SncFolder[]>([]);
  const [trashRows, setTrashRows] = useState<SncTrashRow[]>([]);
  const [offline, setOffline] = useState(false);

  // filters + layout
  const [query, setQuery] = useState("");
  const [folderFilter, setFolderFilter] = useState<string | null>(null); // null=all, "none"=unfiled, uuid
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const [view, setView] = useState<StageView>("edit");

  // open note
  const [doc, setDoc] = useState<SncDoc | null>(null);
  const [draft, setDraft] = useState("");
  const [titleDraft, setTitleDraft] = useState("");
  const [autoTitle, setAutoTitle] = useState(true);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "queued">("idle");
  const [conflict, setConflict] = useState<SncDoc | null>(null);
  /** the diff3 output for the open conflict (always has overlaps — clean
   *  merges auto-apply and never reach the banner). */
  const [conflictMerge, setConflictMerge] = useState<{ text: string; conflicts: number } | null>(null);
  /** transient "merged with the other device" toast-strip. */
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // menus
  const [folderMenu, setFolderMenu] = useState(false);
  const [tagMenu, setTagMenu] = useState(false);
  const [moveMenu, setMoveMenu] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  // offline outbox (D6): queued creates/trashes, persisted to disk. `docs`
  // stays server-rows-only; local drafts render from this queue.
  const [outbox, setOutbox] = useState<OutboxOp[]>([]);
  const outboxRef = useRef<OutboxOp[]>([]);
  const replayingRef = useRef(false);
  const persistOutbox = useCallback((ops: OutboxOp[]) => {
    outboxRef.current = ops;
    setOutbox(ops);
    void saveOutbox(ops).catch((e) => reportDiag("snc.outbox", e, { action: "persist" }));
  }, []);

  const dirtyRef = useRef(false);
  const docRef = useRef<SncDoc | null>(null);
  const draftRef = useRef("");
  const titleRef = useRef("");
  const autoTitleRef = useRef(true);
  const conflictRef = useRef<SncDoc | null>(null);
  const savingRef = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const taRef = useRef<HTMLTextAreaElement | null>(null);
  docRef.current = doc;
  draftRef.current = draft;
  titleRef.current = titleDraft;
  autoTitleRef.current = autoTitle;
  conflictRef.current = conflict;

  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmDelete]);
  useEffect(() => {
    if (!mergeNotice) return;
    const t = setTimeout(() => setMergeNotice(null), 5000);
    return () => clearTimeout(t);
  }, [mergeNotice]);

  const tagUniverse = useMemo(() => collectTags(docs), [docs]);
  const folderById = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
  // local drafts (queued creates) render ABOVE the server rows until they post
  const visibleDocs = useMemo(() => {
    const locals = outbox
      .filter((o): o is OutboxCreate => o.kind === "create")
      .map((op) => {
        const { content: _content, ...meta } = localDoc(op);
        return meta as SncDocMeta;
      });
    return locals.length > 0 ? [...locals, ...docs] : docs;
  }, [outbox, docs]);

  // ── data loading ──────────────────────────────────────────────────────────

  const refreshList = useCallback(async () => {
    try {
      const [d, f] = await Promise.all([
        listDocs({
          q: query.trim() || undefined,
          tag: tagFilter ?? undefined,
          folder: folderFilter ?? undefined,
        }),
        listFolders(),
      ]);
      setDocs(d);
      setFolders(f);
      setOffline(false);
      return d;
    } catch (e) {
      if (e instanceof SncHttpError && e.status === 0) setOffline(true);
      else reportDiag("snc.list", e, {});
      return null;
    }
  }, [query, tagFilter, folderFilter]);

  const refreshTrash = useCallback(async () => {
    try {
      setTrashRows(await listTrash());
      setOffline(false);
    } catch (e) {
      if (e instanceof SncHttpError && e.status === 0) setOffline(true);
    }
  }, []);

  /** Drain the offline queue: creates POST (temp id → real row), trashes
   *  DELETE. A transport failure keeps the remainder for the next attempt. */
  const replayPending = useCallback(async () => {
    const ops = outboxRef.current;
    if (ops.length === 0 || replayingRef.current) return;
    replayingRef.current = true;
    try {
      const res = await replayOutboxLive(ops);
      if (res.created.size > 0 || res.remaining.length !== ops.length) {
        persistOutbox(res.remaining);
        // the open note may have just been born for real — swap ids in place
        const open = docRef.current;
        if (open && isLocalId(open.id)) {
          const real = res.created.get(open.id);
          if (real) {
            setDoc(real);
            if (!dirtyRef.current) {
              setDraft(real.content);
              setTitleDraft(real.title);
            }
            setSaveState("saved");
          }
        }
        if (res.remaining.length === 0) setOffline(false);
        void refreshList();
      }
    } finally {
      replayingRef.current = false;
    }
  }, [persistOutbox, refreshList]);

  // boot: connection state, the persisted outbox, then first load
  useEffect(() => {
    if (!native) return;
    void (async () => {
      try {
        const s = await sncStatus();
        setStatus(s);
        setConn(s.hasToken ? "ready" : "disconnected");
      } catch (e) {
        reportDiag("snc.status", e, {});
        setConn("disconnected");
      }
      const pending = await loadOutbox();
      if (pending.length > 0) {
        outboxRef.current = pending;
        setOutbox(pending);
      }
    })();
  }, [native]);

  // queued work retries while connected: piggyback on the poll cadence plus a
  // tighter loop when we know we're offline.
  useEffect(() => {
    if (conn !== "ready" || outbox.length === 0) return;
    void replayPending();
    const t = setInterval(() => void replayPending(), offline ? 15_000 : 30_000);
    return () => clearInterval(t);
  }, [conn, outbox.length, offline, replayPending]);

  // list follows filters/search (debounced for typing)
  useEffect(() => {
    if (conn !== "ready") return;
    const t = setTimeout(() => void refreshList(), query ? 300 : 0);
    return () => clearTimeout(t);
  }, [conn, refreshList, query]);

  // trash rows load when the trash view opens
  useEffect(() => {
    if (conn === "ready" && showTrash) void refreshTrash();
  }, [conn, showTrash, refreshTrash]);

  // gentle poll: other devices / agents write too (the whole point)
  useEffect(() => {
    if (conn !== "ready") return;
    const t = setInterval(async () => {
      const list = await refreshList();
      // pull the open note forward ONLY when it isn't being edited here
      const open = docRef.current;
      if (list && open && !dirtyRef.current && !conflictRef.current) {
        const row = list.find((r) => r.id === open.id);
        if (row && row.updatedAt !== open.updatedAt) {
          try {
            const fresh = await getDoc(open.id);
            if (!dirtyRef.current && docRef.current?.id === fresh.id) {
              setDoc(fresh);
              setDraft(fresh.content);
              setTitleDraft(fresh.title);
              setAutoTitle(fresh.title === deriveTitle(fresh.content));
            }
          } catch {
            /* next poll retries */
          }
        }
      }
    }, 20_000);
    return () => clearInterval(t);
  }, [conn, refreshList]);

  // ── saving (autosave + conflict guard) ───────────────────────────────────

  const save = useCallback(async () => {
    const open = docRef.current;
    if (!open || savingRef.current || conflictRef.current) return;
    if (!dirtyRef.current) return;
    savingRef.current = true;
    setSaveState("saving");
    const content = draftRef.current;
    const title = autoTitleRef.current
      ? deriveTitle(content)
      : titleRef.current.trim() || "Untitled";
    // a note born offline: its "save" is updating the queued create op —
    // no network, the replay loop posts it when the connection returns.
    if (isLocalId(open.id)) {
      const prev = outboxRef.current.find(
        (o): o is OutboxCreate => o.kind === "create" && o.tempId === open.id,
      );
      persistOutbox(
        upsertCreate(outboxRef.current, {
          kind: "create",
          tempId: open.id,
          content,
          title,
          tags: prev?.tags ?? open.tags,
          folderId: prev?.folderId ?? open.folderId,
          ts: prev?.ts ?? Date.now(),
        }),
      );
      dirtyRef.current = false;
      savingRef.current = false;
      setSaveState("queued");
      void replayPending();
      return;
    }
    dirtyRef.current = false;
    try {
      const updated = await updateDoc(open.id, {
        content,
        title,
        baseUpdatedAt: open.updatedAt,
      });
      // keep the ref's identity fresh so the next save bases on this one
      if (docRef.current?.id === updated.id) {
        setDoc(updated);
        if (autoTitleRef.current) setTitleDraft(updated.title);
      }
      setSaveState(dirtyRef.current ? "saving" : "saved");
      setOffline(false);
      // title/order changed → cheap list refresh
      void refreshList();
    } catch (e) {
      if (e instanceof SncConflictError) {
        // The note moved on another device. THREE-WAY MERGE (D6): base = the
        // server copy this edit was based on, ours = the live draft, theirs =
        // the 409's live row. Non-overlapping edits combine silently; only a
        // genuine overlap asks the owner to pick.
        const merged = diff3Merge(open.content, draftRef.current, e.current.content);
        if (merged.clean) {
          setDraft(merged.text);
          setDoc(e.current); // future saves base on theirs — no re-conflict
          if (autoTitleRef.current) setTitleDraft(deriveTitle(merged.text));
          dirtyRef.current = true; // the finally block schedules the save
          setMergeNotice(`merged edits from another device (${relTime(e.current.updatedAt)})`);
          setSaveState("saving");
        } else {
          setConflict(e.current);
          setConflictMerge({ text: merged.text, conflicts: merged.conflicts });
          dirtyRef.current = true;
          setSaveState("idle");
        }
      } else if (e instanceof SncHttpError && e.status === 0) {
        // offline — keep the draft dirty and retry on a timer
        dirtyRef.current = true;
        setOffline(true);
        setSaveState("queued");
      } else {
        dirtyRef.current = true;
        setSaveState("idle");
        reportDiag("snc.save", e, { id: open.id });
      }
    } finally {
      savingRef.current = false;
      if (dirtyRef.current && !conflictRef.current) {
        // more typing landed mid-save (or we're offline) — reschedule
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => void save(), offline ? 10_000 : AUTOSAVE_MS);
      }
    }
  }, [refreshList, offline, persistOutbox, replayPending]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    setSaveState("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }, [save]);

  // flush on unmount (best effort)
  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (dirtyRef.current && docRef.current && !conflictRef.current) {
        const open = docRef.current;
        const content = draftRef.current;
        const title = autoTitleRef.current ? deriveTitle(content) : titleRef.current;
        updateDoc(open.id, { content, title, baseUpdatedAt: open.updatedAt }).catch((e) =>
          reportDiag("snc.save", e, { action: "unmountSave" }),
        );
      }
    };
  }, []);

  // ── note lifecycle ────────────────────────────────────────────────────────

  const select = useCallback(async (id: string) => {
    if (docRef.current?.id === id) return;
    // flush the previous note first so nothing is lost
    if (dirtyRef.current && docRef.current && !conflictRef.current) {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      await save();
    }
    setConflict(null);
    setConflictMerge(null);
    setConfirmDelete(false);
    // a local (not-yet-posted) draft opens straight from its queued op
    if (isLocalId(id)) {
      const op = outboxRef.current.find(
        (o): o is OutboxCreate => o.kind === "create" && o.tempId === id,
      );
      if (!op) return;
      const d = localDoc(op);
      setDoc(d);
      setDraft(d.content);
      setTitleDraft(d.title);
      setAutoTitle(op.title === undefined || op.title === deriveTitle(op.content));
      dirtyRef.current = false;
      setSaveState("queued");
      return;
    }
    try {
      const fresh = await getDoc(id);
      setDoc(fresh);
      setDraft(fresh.content);
      setTitleDraft(fresh.title);
      setAutoTitle(fresh.title === deriveTitle(fresh.content));
      dirtyRef.current = false;
      setSaveState("idle");
    } catch (e) {
      reportDiag("snc.open", e, { id });
    }
  }, [save]);

  const onNew = useCallback(async () => {
    try {
      const created = await createDoc({
        folderId: folderFilter && folderFilter !== "none" ? folderFilter : null,
        tags: tagFilter ? [tagFilter] : undefined,
      });
      await refreshList();
      setDoc(created);
      setDraft(created.content);
      setTitleDraft(created.title);
      setAutoTitle(true);
      setConflict(null);
      setConflictMerge(null);
      setShowTrash(false);
      setView((v) => (v === "read" ? "edit" : v));
      dirtyRef.current = false;
      setSaveState("idle");
      requestAnimationFrame(() => taRef.current?.focus());
    } catch (e) {
      if (e instanceof SncHttpError && e.status === 0) {
        // OFFLINE create (D6): the note is born locally, editable at once,
        // queued to post the moment the connection returns.
        const op: OutboxCreate = {
          kind: "create",
          tempId: newLocalId(),
          content: "",
          tags: tagFilter ? [tagFilter] : [],
          folderId: folderFilter && folderFilter !== "none" ? folderFilter : null,
          ts: Date.now(),
        };
        persistOutbox(upsertCreate(outboxRef.current, op));
        const d = localDoc(op);
        setDoc(d);
        setDraft("");
        setTitleDraft(d.title);
        setAutoTitle(true);
        setConflict(null);
        setConflictMerge(null);
        setShowTrash(false);
        setView((v) => (v === "read" ? "edit" : v));
        dirtyRef.current = false;
        setSaveState("queued");
        setOffline(true);
        requestAnimationFrame(() => taRef.current?.focus());
      } else {
        reportDiag("snc.create", e, {});
      }
    }
  }, [folderFilter, tagFilter, refreshList, persistOutbox]);

  const onTrash = useCallback(async () => {
    const open = docRef.current;
    if (!open) return;
    dirtyRef.current = false;
    setConflict(null);
    setConflictMerge(null);
    // trashing a local draft just cancels its queued create — the server
    // never hears about a note that never existed.
    if (isLocalId(open.id)) {
      persistOutbox(queueTrash(outboxRef.current, open.id));
      setDoc(null);
      setDraft("");
      setTitleDraft("");
      return;
    }
    try {
      await trashDoc(open.id);
    } catch (e) {
      if (e instanceof SncHttpError && e.status === 0) {
        // offline: queue the trash, hide the row optimistically
        persistOutbox(queueTrash(outboxRef.current, open.id));
        setDocs((cur) => cur.filter((d) => d.id !== open.id));
        setOffline(true);
      } else {
        reportDiag("snc.trash", e, { id: open.id });
      }
    }
    setDoc(null);
    setDraft("");
    setTitleDraft("");
    await refreshList();
  }, [refreshList, persistOutbox]);

  // metadata edits save immediately (no conflict guard needed — server merges)
  const patchMeta = useCallback(
    async (patch: { pinned?: boolean; tags?: string[]; folderId?: string | null }) => {
      const open = docRef.current;
      if (!open) return;
      // local drafts: tags/folder ride the queued create op (pin needs a row)
      if (isLocalId(open.id)) {
        const prev = outboxRef.current.find(
          (o): o is OutboxCreate => o.kind === "create" && o.tempId === open.id,
        );
        if (!prev) return;
        const nextOp: OutboxCreate = {
          ...prev,
          tags: patch.tags ?? prev.tags,
          folderId: patch.folderId !== undefined ? patch.folderId : prev.folderId,
        };
        persistOutbox(upsertCreate(outboxRef.current, nextOp));
        setDoc((cur) =>
          cur ? { ...cur, tags: nextOp.tags, folderId: nextOp.folderId } : cur,
        );
        return;
      }
      try {
        const updated = await updateDoc(open.id, patch);
        if (docRef.current?.id === updated.id)
          setDoc((cur) => (cur ? { ...cur, ...patch, updatedAt: updated.updatedAt } : cur));
        void refreshList();
      } catch (e) {
        reportDiag("snc.meta", e, { id: open.id });
      }
    },
    [refreshList, persistOutbox],
  );

  // ── conflict resolution (D6 v1: explicit keep/take; diff3 merge lands next) ─

  const resolveKeepMine = useCallback(async () => {
    const open = docRef.current;
    const server = conflictRef.current;
    if (!open || !server) return;
    setConflict(null);
    setConflictMerge(null);
    try {
      const updated = await updateDoc(open.id, {
        content: draftRef.current,
        title: autoTitleRef.current ? deriveTitle(draftRef.current) : titleRef.current,
        baseUpdatedAt: server.updatedAt, // basing on the live row = deliberate overwrite
      });
      setDoc(updated);
      dirtyRef.current = false;
      setSaveState("saved");
      void refreshList();
    } catch (e) {
      reportDiag("snc.conflict", e, { id: open.id });
    }
  }, [refreshList]);

  const resolveTakeTheirs = useCallback(() => {
    const server = conflictRef.current;
    if (!server) return;
    setConflict(null);
    setConflictMerge(null);
    setDoc(server);
    setDraft(server.content);
    setTitleDraft(server.title);
    setAutoTitle(server.title === deriveTitle(server.content));
    dirtyRef.current = false;
    setSaveState("idle");
  }, []);

  /** Drop the diff3 output (with its <<<<<<< blocks) into the editor: both
   *  versions in one draft, resolve by editing. Bases on theirs so the next
   *  autosave lands cleanly. */
  const resolveInEditor = useCallback(() => {
    const server = conflictRef.current;
    const merged = conflictMerge;
    if (!server || !merged) return;
    setConflict(null);
    setConflictMerge(null);
    setDoc(server);
    setDraft(merged.text);
    setView((v) => (v === "read" ? "edit" : v));
    dirtyRef.current = true;
    setMergeNotice(null);
    setSaveState("saving");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => void save(), AUTOSAVE_MS);
  }, [conflictMerge, save]);

  // ── ⋯-menu contributions (same registry as the terminal's) ───────────────

  const menuActionsRef = useRef({ onNew, refresh: refreshList, baseUrl: "" });
  menuActionsRef.current = { onNew, refresh: refreshList, baseUrl: status?.baseUrl ?? "" };
  useEffect(() => {
    if (!paneKey) return;
    paneMenuExtras.set(paneKey, () => [
      { key: "notes-new", label: "New note", hint: "⌘N", onSelect: () => void menuActionsRef.current.onNew() },
      { key: "notes-sync", label: "Sync now", onSelect: () => void menuActionsRef.current.refresh() },
      {
        key: "notes-web",
        label: "Open stone & chisel",
        hint: "browser pane",
        onSelect: () => {
          const b = menuActionsRef.current.baseUrl;
          if (b) openUrlInPane(b, "stone & chisel");
        },
      },
    ]);
    return () => {
      paneMenuExtras.delete(paneKey);
    };
  }, [paneKey]);

  // ── keyboard: ⌘N new · ⌘S flush · ⌘1/2/3 stage views ─────────────────────

  const onKeys = useCallback(
    (e: React.KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      const k = e.key.toLowerCase();
      if (k === "n") {
        e.preventDefault();
        void onNew();
      } else if (k === "s") {
        e.preventDefault();
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        void save();
      } else if (k === "1" || k === "2" || k === "3") {
        if (!docRef.current) return;
        e.preventDefault();
        setView(k === "1" ? "edit" : k === "2" ? "split" : "read");
      }
    },
    [onNew, save],
  );

  // ── render ───────────────────────────────────────────────────────────────

  if (!native) {
    return (
      <div className="flex h-full items-center justify-center bg-[var(--color-pane)] text-[12px] text-[var(--color-faint)]">
        notes run inside the desktop shell
      </div>
    );
  }
  if (conn === "boot") {
    return <div className="h-full bg-[var(--color-pane)]" />;
  }
  if (conn === "disconnected") {
    return (
      <ConnectCard
        status={status ?? { baseUrl: "https://stone-n-chisel.vercel.app", hasToken: false }}
        onConnected={() => {
          setConn("ready");
          void sncStatus().then(setStatus).catch(() => {});
        }}
      />
    );
  }

  const folderName = (id: string | null | undefined) =>
    id ? folderById.get(id)?.name ?? "folder" : "unfiled";
  const currentFolderLabel =
    folderFilter === null ? "all notes" : folderFilter === "none" ? "unfiled" : folderName(folderFilter);
  const wordCount = draft.trim() ? draft.trim().split(/\s+/).length : 0;

  const editor = (
    <textarea
      ref={taRef}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        scheduleSave();
      }}
      onKeyDown={(e) => {
        // Tab writes two spaces (markdown nesting) instead of leaving the note
        if (e.key === "Tab" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          const el = e.currentTarget;
          const { selectionStart: s, selectionEnd: d } = el;
          setDraft((cur) => cur.slice(0, s) + "  " + cur.slice(d));
          requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
          scheduleSave();
        }
      }}
      onBlur={() => {
        if (dirtyRef.current) {
          if (saveTimer.current) window.clearTimeout(saveTimer.current);
          void save();
        }
      }}
      placeholder="write markdown — first line becomes the title. everything saves to stone & chisel."
      spellCheck={false}
      className="h-full w-full resize-none bg-transparent px-4 py-3 font-mono text-[13px] leading-relaxed text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)]"
    />
  );

  const reader = doc ? (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[46rem] px-5 py-4">
        <h1 className="text-[19px] font-semibold leading-snug text-[var(--color-text)]">
          {autoTitle ? deriveTitle(draft) : titleDraft || "Untitled"}
        </h1>
        <div className="mb-3 mt-1 flex items-center gap-2 border-b border-[var(--color-border)] pb-2.5 text-[10.5px] text-[var(--color-faint)]">
          <span className="inline-flex items-center gap-1">
            <Folder size={9.5} style={{ color: folderTint(folderById.get(doc.folderId ?? "")?.color) }} />
            {folderName(doc.folderId)}
          </span>
          {doc.tags.map((t) => (
            <span key={t} className="text-[var(--color-muted)]">#{t}</span>
          ))}
          <span className="ml-auto">edited {relTime(doc.updatedAt)}</span>
        </div>
        <div className="text-[13px] leading-relaxed text-[var(--color-text-2)]">
          <Markdown text={draft} />
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      className="flex h-full min-h-0 bg-[var(--color-pane)] text-[var(--color-text)]"
      onKeyDown={onKeys}
    >
      {/* ── list column ── */}
      {listOpen && (
        <div className="flex w-60 shrink-0 flex-col border-r border-[var(--color-border)]">
          <div className="flex items-center gap-1.5 p-2 pb-1.5">
            <div className="relative flex-1">
              <Search
                size={12}
                className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-faint)]"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="search everything"
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]/70 py-1 pl-7 pr-2 text-[12px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]/60"
              />
            </div>
            <button
              onClick={() => void onNew()}
              title="new note (⌘N)"
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
            >
              <Plus size={14} />
            </button>
          </div>

          {/* filter rail: folder menu · trash toggle */}
          <div className="flex items-center gap-1 px-2 pb-1.5">
            <Dropdown
              open={folderMenu}
              onToggle={() => setFolderMenu((v) => !v)}
              align="left"
              trigger={
                <span className="flex max-w-[10.5rem] items-center gap-1.5 truncate">
                  <Folder
                    size={11}
                    className="shrink-0"
                    style={{
                      color:
                        folderFilter && folderFilter !== "none"
                          ? folderTint(folderById.get(folderFilter)?.color)
                          : "var(--color-muted)",
                    }}
                  />
                  <span className="truncate">{currentFolderLabel}</span>
                  <ChevronDown size={10} className="shrink-0 text-[var(--color-faint)]" />
                </span>
              }
            >
              <MenuHeader>folders</MenuHeader>
              <MenuItem active={folderFilter === null} onClick={() => { setFolderFilter(null); setFolderMenu(false); }}>
                all notes
              </MenuItem>
              <MenuItem active={folderFilter === "none"} onClick={() => { setFolderFilter("none"); setFolderMenu(false); }}>
                unfiled
              </MenuItem>
              {folders.map((f) => (
                <MenuItem
                  key={f.id}
                  active={folderFilter === f.id}
                  onClick={() => { setFolderFilter(f.id); setFolderMenu(false); }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Folder size={11} className="shrink-0" style={{ color: folderTint(f.color) }} />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
                      {f.documentCount}
                    </span>
                  </span>
                </MenuItem>
              ))}
              <div className="mt-1 border-t border-[var(--color-border)] px-1 pb-0.5 pt-1.5">
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder="new folder ⏎"
                  spellCheck={false}
                  onKeyDown={async (e) => {
                    if (e.key !== "Enter" || !newFolderName.trim()) return;
                    try {
                      const f = await createFolder(newFolderName.trim());
                      setNewFolderName("");
                      setFolders((cur) => [...cur, f].sort((a, b) => a.name.localeCompare(b.name)));
                      setFolderFilter(f.id);
                      setFolderMenu(false);
                    } catch (err) {
                      reportDiag("snc.folder", err, {});
                    }
                  }}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] outline-none transition-colors focus:border-[var(--color-accent)]/60"
                />
              </div>
            </Dropdown>

            <div className="min-w-0 flex-1" />

            <IconBtn
              title={showTrash ? "back to notes" : "trash"}
              active={showTrash}
              onClick={() => setShowTrash((v) => !v)}
            >
              <Trash2 size={12} />
            </IconBtn>
          </div>

          {/* tag chips (from the live doc list) */}
          {!showTrash && tagUniverse.length > 0 && (
            <div className="flex gap-1 overflow-x-auto px-2 pb-1.5 [scrollbar-width:none]">
              {tagUniverse.slice(0, 12).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTagFilter((cur) => (cur === t ? null : t))}
                  className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                    tagFilter === t
                      ? "border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                      : "border-[var(--color-border)] text-[var(--color-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-text-2)]"
                  }`}
                >
                  #{t}
                </button>
              ))}
            </div>
          )}

          <div className="mx-2 border-t border-[var(--color-border)]" />

          {/* offline strip */}
          {offline && (
            <button
              type="button"
              onClick={() => {
                void refreshList();
                void replayPending();
              }}
              className="flex items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-panel-2)]/60 px-2.5 py-1 text-left text-[10px] text-[var(--color-muted)]"
            >
              <CloudOff size={11} className="text-[var(--color-danger)]" />
              offline{outbox.length > 0 ? ` · ${outbox.length} queued` : ""} — tap to retry
            </button>
          )}

          {/* rows */}
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {showTrash ? (
              trashRows.length === 0 ? (
                <div className="px-3 py-6 text-center text-[11px] text-[var(--color-faint)]">trash is empty</div>
              ) : (
                trashRows.map((r) => (
                  <div key={r.id} className="group/trash mx-1.5 flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--color-panel-2)]/50">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-[var(--color-muted)]">{r.title}</div>
                      <div className="text-[10px] text-[var(--color-faint)]">deleted {relTime(r.deletedAt)}</div>
                    </div>
                    <button
                      type="button"
                      title="restore"
                      onClick={async () => {
                        try {
                          await restoreDoc(r.id);
                          await Promise.all([refreshTrash(), refreshList()]);
                        } catch (e) {
                          reportDiag("snc.restore", e, { id: r.id });
                        }
                      }}
                      className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--color-faint)] opacity-0 transition-all hover:bg-[var(--color-panel-2)] hover:text-[var(--color-accent)] group-hover/trash:opacity-100"
                    >
                      <Undo2 size={12} />
                    </button>
                  </div>
                ))
              )
            ) : visibleDocs.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-3 py-6 text-center text-[11px] text-[var(--color-faint)]">
                {query || tagFilter || folderFilter ? (
                  "no matches"
                ) : (
                  <>
                    <span>no notes yet</span>
                    <button type="button" onClick={() => void onNew()} className="pill press">
                      new note
                    </button>
                  </>
                )}
              </div>
            ) : (
              visibleDocs.map((n) => {
                const active = n.id === doc?.id;
                const nf = n.folderId ? folderById.get(n.folderId) : null;
                return (
                  <button
                    key={n.id}
                    onClick={() => void select(n.id)}
                    className={`relative mx-1.5 flex w-[calc(100%-0.75rem)] flex-col gap-0.5 rounded-lg px-2.5 py-2 text-left transition-colors ${
                      active
                        ? "bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)]"
                        : "hover:bg-[var(--color-panel-2)]/50"
                    }`}
                  >
                    {active && (
                      <span
                        aria-hidden
                        className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[linear-gradient(180deg,var(--color-accent),var(--aios-accent-2))] shadow-[var(--aios-glow-soft)]"
                      />
                    )}
                    <span className="flex items-center gap-1.5">
                      {n.pinned && <Pin size={9} className="shrink-0 text-[var(--color-accent)]" />}
                      <span className={`truncate text-[12px] font-medium ${active ? "text-[var(--color-text)]" : "text-[var(--color-text-2)]"}`}>
                        {n.title}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 text-[10px] text-[var(--color-faint)]">
                      {isLocalId(n.id) ? (
                        <span
                          className="shrink-0 rounded-full border px-1.5 text-[9px]"
                          style={{ color: "var(--aios-accent-2)", borderColor: "color-mix(in srgb, var(--aios-accent-2) 40%, transparent)" }}
                          title="created offline — posts to stone & chisel when the connection returns"
                        >
                          local
                        </span>
                      ) : (
                        <span className="shrink-0">{relTime(n.updatedAt)}</span>
                      )}
                      {folderFilter === null && nf && (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 shrink-0 rounded-full"
                            style={{ background: folderTint(nf.color) }}
                          />
                          <span className="truncate">{nf.name}</span>
                        </span>
                      )}
                      {n.tags.length > 0 && (
                        <span className="truncate text-[var(--color-muted)]">
                          {n.tags.map((t) => `#${t}`).join(" ")}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* connection foot */}
          <div className="flex h-6 shrink-0 items-center justify-between border-t border-[var(--color-border)] px-2 text-[10px] text-[var(--color-faint)]">
            <button
              type="button"
              title="open stone & chisel in a browser pane"
              onClick={() => status && openUrlInPane(status.baseUrl, "stone & chisel")}
              className="flex items-center gap-1 transition-colors hover:text-[var(--color-muted)]"
            >
              <ExternalLink size={9} />
              s&amp;c
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                title="disconnect (forget the access token)"
                onClick={async () => {
                  try {
                    await sncDisconnect();
                  } catch (e) {
                    reportDiag("snc.disconnect", e, {});
                  }
                  setDoc(null);
                  setDocs([]);
                  setConn("disconnected");
                }}
                className="flex items-center gap-1 transition-colors hover:text-[var(--color-muted)]"
              >
                <KeyRound size={9} />
                token
              </button>
              <button
                type="button"
                title="refresh"
                onClick={() => void refreshList()}
                className="flex items-center gap-1 transition-colors hover:text-[var(--color-muted)]"
              >
                <RefreshCw size={9} />
                sync
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── stage ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {doc ? (
          <>
            <div className="pane-header justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-1">
                <IconBtn
                  title={listOpen ? "hide the note list" : "show the note list"}
                  onClick={() => setListOpen((v) => !v)}
                >
                  {listOpen ? <PanelLeftClose size={12} /> : <PanelLeftOpen size={12} />}
                </IconBtn>
                <input
                  value={titleDraft}
                  onChange={(e) => {
                    setTitleDraft(e.target.value);
                    setAutoTitle(false);
                    scheduleSave();
                  }}
                  spellCheck={false}
                  placeholder="Untitled"
                  title={autoTitle ? "auto-titled from the first line — type to set your own" : "note title"}
                  className="min-w-0 flex-1 truncate bg-transparent text-[12px] font-medium text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)]"
                />
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {/* stage view segmented */}
                <div className="flex items-center rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]/40 p-0.5">
                  {STAGE_VIEWS.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      title={`${v.label} (${v.key})`}
                      onClick={() => setView(v.id)}
                      className={`grid h-5 w-6 place-items-center rounded-md transition-colors ${
                        view === v.id
                          ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                          : "text-[var(--color-faint)] hover:text-[var(--color-text-2)]"
                      }`}
                    >
                      {v.icon}
                    </button>
                  ))}
                </div>

                <div className="mx-0.5 h-4 w-px bg-[var(--color-border)]" />

                <IconBtn title={doc.pinned ? "unpin" : "pin to top"} active={doc.pinned} onClick={() => void patchMeta({ pinned: !doc.pinned })}>
                  <Pin size={12} />
                </IconBtn>

                {/* tags */}
                <Dropdown
                  open={tagMenu}
                  onToggle={() => setTagMenu((v) => !v)}
                  align="right"
                  label="tags"
                  triggerClassName={`grid h-6 w-6 place-items-center rounded-md transition-colors ${
                    doc.tags.length > 0
                      ? "text-[var(--color-accent)] hover:bg-[var(--color-panel-2)]"
                      : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                  }`}
                  trigger={<Tag size={12} />}
                >
                  <MenuHeader>tags</MenuHeader>
                  {tagUniverse.length === 0 && doc.tags.length === 0 && (
                    <div className="px-2.5 py-1 text-[11px] text-[var(--color-faint)]">no tags yet — type one below</div>
                  )}
                  {[...new Set([...doc.tags, ...tagUniverse])].slice(0, 16).map((t) => {
                    const on = doc.tags.includes(t);
                    return (
                      <MenuItem
                        key={t}
                        active={on}
                        onClick={() =>
                          void patchMeta({ tags: on ? doc.tags.filter((x) => x !== t) : [...doc.tags, t] })
                        }
                      >
                        <span className="flex min-w-0 items-center gap-1">
                          <span style={{ color: "var(--aios-accent-2)" }}>#</span>
                          <span className="min-w-0 flex-1 truncate">{t}</span>
                        </span>
                      </MenuItem>
                    );
                  })}
                  <div className="mt-1 border-t border-[var(--color-border)] px-1 pb-0.5 pt-1.5">
                    <input
                      placeholder="add tag ⏎"
                      spellCheck={false}
                      onKeyDown={(e) => {
                        const v = (e.target as HTMLInputElement).value.trim().replace(/^#/, "");
                        if (e.key !== "Enter" || !v) return;
                        (e.target as HTMLInputElement).value = "";
                        if (!doc.tags.includes(v)) void patchMeta({ tags: [...doc.tags, v] });
                      }}
                      className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[11px] outline-none transition-colors focus:border-[var(--color-accent)]/60"
                    />
                  </div>
                </Dropdown>

                {/* move to folder */}
                <Dropdown
                  open={moveMenu}
                  onToggle={() => setMoveMenu((v) => !v)}
                  align="right"
                  label="move to folder"
                  triggerClassName="grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                  trigger={<Folder size={12} />}
                >
                  <MenuHeader>move to</MenuHeader>
                  <MenuItem
                    active={doc.folderId === null}
                    onClick={() => { void patchMeta({ folderId: null }); setMoveMenu(false); }}
                  >
                    unfiled
                  </MenuItem>
                  {folders.map((f) => (
                    <MenuItem
                      key={f.id}
                      active={doc.folderId === f.id}
                      onClick={() => { void patchMeta({ folderId: f.id }); setMoveMenu(false); }}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Folder size={11} className="shrink-0" style={{ color: folderTint(f.color) }} />
                        <span className="min-w-0 flex-1 truncate">{f.name}</span>
                      </span>
                    </MenuItem>
                  ))}
                </Dropdown>

                {onSend && (
                  <button
                    onClick={() => {
                      const body = draftRef.current.trim();
                      if (body) onSend(body);
                    }}
                    title="send this note to the oracle (active chat)"
                    className="flex items-center gap-1 rounded-md border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                  >
                    <Send size={11} />
                    send
                  </button>
                )}

                <button
                  onClick={() => {
                    if (confirmDelete) {
                      setConfirmDelete(false);
                      void onTrash();
                    } else {
                      setConfirmDelete(true);
                    }
                  }}
                  title={confirmDelete ? "click again to move this note to the trash" : "move to trash"}
                  className={`grid h-6 place-items-center rounded-md transition-all ${
                    confirmDelete
                      ? "w-auto bg-[var(--color-danger)]/15 px-2 font-mono text-[10px] text-[var(--color-danger)]"
                      : "w-6 text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-danger)]"
                  }`}
                >
                  {confirmDelete ? "sure?" : <Trash2 size={12} />}
                </button>
              </div>
            </div>

            {/* conflict banner — the D4/D6 guarantee made visible. Reaching
                here means diff3 found GENUINE overlaps (clean merges applied
                silently), so the options are: side, side, or merge-by-hand. */}
            {conflict && (
              <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-accent-soft)] px-3 py-1.5 text-[11px]">
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-2)]">
                  {conflictMerge
                    ? `${conflictMerge.conflicts} overlapping ${conflictMerge.conflicts === 1 ? "edit" : "edits"} with another device (${relTime(conflict.updatedAt)})`
                    : `changed on another device ${relTime(conflict.updatedAt)}`}
                </span>
                {conflictMerge && (
                  <button
                    type="button"
                    onClick={resolveInEditor}
                    title="both versions land in the editor with <<<<<<< markers — resolve by editing"
                    className="shrink-0 rounded-md border border-[var(--color-accent)]/50 bg-[var(--color-accent)]/10 px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
                  >
                    merge in editor
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void resolveKeepMine()}
                  className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)]"
                >
                  keep mine
                </button>
                <button
                  type="button"
                  onClick={resolveTakeTheirs}
                  className="shrink-0 rounded-md border border-[var(--color-border)] px-2 py-0.5 text-[11px] text-[var(--color-text)] transition-colors hover:border-[var(--color-border-strong)]"
                >
                  take theirs
                </button>
              </div>
            )}

            {/* clean-merge notice (auto-fades) */}
            {mergeNotice && !conflict && (
              <div
                className="border-b border-[var(--color-border)] px-3 py-1 text-[10.5px]"
                style={{ color: "var(--aios-accent-2)" }}
              >
                ✓ {mergeNotice}
              </div>
            )}

            {/* unresolved-marker hint after "merge in editor" */}
            {!conflict && hasConflictMarkers(draft) && (
              <div className="border-b border-[var(--color-border)] bg-[var(--color-panel-2)]/60 px-3 py-1 text-[10.5px] text-[var(--color-muted)]">
                unresolved <span className="font-mono">&lt;&lt;&lt;&lt;&lt;&lt;&lt;</span> markers in this note —
                keep the lines you want, delete the fences
              </div>
            )}

            {/* body: write / split / read */}
            <div className="min-h-0 flex-1">
              {view === "edit" && editor}
              {view === "read" && reader}
              {view === "split" && (
                <div className="grid h-full grid-cols-2 divide-x divide-[var(--color-border)]">
                  <div className="min-h-0">{editor}</div>
                  <div className="min-h-0">{reader}</div>
                </div>
              )}
            </div>

            <div className="flex h-6 shrink-0 items-center justify-between border-t border-[var(--color-border)] px-3 text-[10px] text-[var(--color-faint)]">
              <span className="flex min-w-0 items-center gap-1.5 truncate">
                <span className="inline-flex items-center gap-1 truncate">
                  <span
                    aria-hidden
                    className="h-1.5 w-1.5 shrink-0 rounded-full"
                    style={{ background: folderTint(folderById.get(doc.folderId ?? "")?.color) }}
                  />
                  <span className="truncate">{folderName(doc.folderId)}</span>
                </span>
                {doc.tags.length > 0 && (
                  <span className="truncate text-[var(--color-muted)]">{doc.tags.map((t) => `#${t}`).join(" ")}</span>
                )}
              </span>
              <span className="flex shrink-0 items-center gap-1.5">
                <span>
                  {wordCount} {wordCount === 1 ? "word" : "words"} · {relTime(doc.updatedAt)}
                </span>
                <span
                  aria-hidden
                  className={`h-1.5 w-1.5 rounded-full ${
                    saveState === "queued"
                      ? "bg-[var(--color-danger)]"
                      : saveState === "saving"
                        ? "animate-pulse bg-[var(--color-accent)]"
                        : ""
                  }`}
                  style={
                    saveState === "saved" || saveState === "idle"
                      ? { background: "var(--aios-accent-2)" }
                      : undefined
                  }
                />
                <span className="w-14 text-right">
                  {saveState === "saving"
                    ? "saving…"
                    : saveState === "queued"
                      ? "queued"
                      : "synced"}
                </span>
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-[var(--color-faint)]">
            {!listOpen && (
              <button
                type="button"
                onClick={() => setListOpen(true)}
                className="mb-2 flex items-center gap-1.5 text-[11px] transition-colors hover:text-[var(--color-muted)]"
              >
                <PanelLeftOpen size={12} />
                show the note list
              </button>
            )}
            <FileText size={28} className="opacity-40" />
            <span className="text-[12px]">{showTrash ? "restore notes from the list" : "no note selected"}</span>
            {!showTrash && (
              <div className="mt-1 flex items-center gap-2">
                <button
                  onClick={() => void onNew()}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--color-accent)]/40 bg-[var(--color-accent-soft)] px-3 py-1.5 text-[12px] text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20"
                >
                  <Plus size={13} />
                  new note
                </button>
                <button
                  onClick={() => status && openUrlInPane(status.baseUrl, "stone & chisel")}
                  className="flex items-center gap-1.5 rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
                >
                  <ExternalLink size={12} />
                  open s&amp;c
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
