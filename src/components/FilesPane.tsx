/** Files pane — a VS Code-style explorer tree. Nested expandable folders,
 *  file-type icons, git status decorations (M/A/D/U + folder change-dots),
 *  indent guides. Single-click a file opens it (editor pane for code, viewer
 *  for media). Rows (files AND folders) stay draggable → drop onto a terminal
 *  to `cd`, onto a files pane to re-root, etc. Files open in the Monaco editor,
 *  so there's no inline preview.
 *
 *  Header affordances:
 *   - dotfile + junk toggles (persisted): hide `.env`/`.git`/… and prune
 *     node_modules/target/dist/.next by default, like VS Code.
 *   - "open project" picker: re-root this pane at any discovered ~/Repo project
 *     so the pane becomes that workspace (and drives ⌘P/⌘⇧F via finderRoot).
 *   - "open terminal here": spawn a shell pane rooted at the selected/focused
 *     directory — the headline cross-pane-spawn example. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ChevronRight,
  Eye,
  EyeOff,
  FolderClosed,
  FolderGit2,
  FolderOpen,
  Globe,
  Home,
  ListCollapse,
  RefreshCw,
  Search,
  TerminalSquare,
} from "lucide-react";

import {
  fileSrc,
  gitStatus,
  homeDir,
  readDirTree,
  type DirEntry,
  type GitCode,
} from "../lib/fs";
import { listProjects, type ProjectInfo } from "../lib/run";
import { AIOS_DIR_MIME, AIOS_PATH_MIME, spawnPane, startPathDrag } from "../lib/paneBus";
import { fileIcon } from "../lib/fileIcons";
import { basename, dirname, normalizeSlashes } from "../lib/paths.ts";
import { isApple } from "../lib/platform";
import { PaneDropZone } from "./PaneDropZone";

const GIT_COLOR: Record<GitCode, string> = {
  M: "var(--color-warning)", // modified
  A: "var(--color-success)", // added (staged)
  U: "var(--color-success)", // untracked
  D: "var(--color-danger)", // deleted
  R: "var(--color-info)", // renamed
};

// Persisted toggles (VS Code-style defaults: both hidden).
const HIDDEN_KEY = "aios.files.showHidden";
const ALL_KEY = "aios.files.showAll";
function loadBool(key: string): boolean {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}
function saveBool(key: string, val: boolean) {
  try {
    localStorage.setItem(key, val ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function FilesPane({
  initialRoot,
  onOpenFile,
}: {
  initialRoot?: string;
  onOpenFile?: (path: string, name: string) => void;
}) {
  const [root, setRoot] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [children, setChildren] = useState<Map<string, DirEntry[]>>(new Map());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set());
  const [git, setGit] = useState<Map<string, GitCode>>(new Map());
  const [gitFolders, setGitFolders] = useState<Set<string>>(new Set());
  const [gitRoot, setGitRoot] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(() => loadBool(HIDDEN_KEY));
  const [showAll, setShowAll] = useState(() => loadBool(ALL_KEY));
  const [projOpen, setProjOpen] = useState(false);
  const [projects, setProjects] = useState<ProjectInfo[]>([]);

  // Read the live toggle values inside callbacks without re-creating loadDir on
  // every toggle (which would otherwise re-run effects). Updated each render.
  const showHiddenRef = useRef(showHidden);
  const showAllRef = useRef(showAll);
  showHiddenRef.current = showHidden;
  showAllRef.current = showAll;

  const loadDir = useCallback(async (path: string) => {
    setLoadingDirs((s) => new Set(s).add(path));
    try {
      const list = await readDirTree(path, showHiddenRef.current, showAllRef.current);
      setChildren((m) => new Map(m).set(path, list));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingDirs((s) => {
        const n = new Set(s);
        n.delete(path);
        return n;
      });
    }
  }, []);

  const refreshGit = useCallback(async (path: string) => {
    try {
      const st = await gitStatus(path);
      setGitRoot(st.root);
      // keys are normalized to forward slashes: list_dir and git_status can
      // emit different separator styles on Windows, so lookups normalize too.
      const m = new Map<string, GitCode>();
      const folders = new Set<string>();
      const stop = st.root ? normalizeSlashes(st.root) : "";
      for (const e of st.entries) {
        m.set(normalizeSlashes(e.path), e.status);
        let dir = normalizeSlashes(dirname(e.path));
        while (dir && dir.length >= stop.length) {
          folders.add(dir);
          if (dir === stop) break;
          const next = normalizeSlashes(dirname(dir));
          if (next === dir) break;
          dir = next;
        }
      }
      setGit(m);
      setGitFolders(folders);
    } catch {
      setGit(new Map());
      setGitFolders(new Set());
      setGitRoot(null);
    }
  }, []);

  const setRootTo = useCallback(
    (path: string) => {
      setRoot(path);
      setChildren(new Map());
      setExpanded(new Set([path]));
      setSelected(null);
      loadDir(path);
      refreshGit(path);
    },
    [loadDir, refreshGit],
  );

  // initial: open the requested directory, falling back to the user's home
  useEffect(() => {
    (async () => {
      setRootTo(initialRoot || (await homeDir()));
    })();
  }, [initialRoot, setRootTo]);

  // Re-read every open dir when a filter toggle flips — the backend decides what
  // to include, so we must re-fetch (children maps cache the old filtered list).
  const reloadOpenDirs = useCallback(() => {
    setChildren(new Map());
    if (root) loadDir(root);
    for (const p of expanded) if (p !== root) loadDir(p);
  }, [root, expanded, loadDir]);

  const toggle = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const n = new Set(prev);
        if (n.has(path)) {
          n.delete(path);
        } else {
          n.add(path);
          if (!children.has(path)) loadDir(path);
        }
        return n;
      });
    },
    [children, loadDir],
  );

  const openFile = (e: DirEntry) => {
    setSelected(e.path);
    onOpenFile?.(e.path, e.name);
  };

  const refreshAll = useCallback(() => {
    for (const p of expanded) loadDir(p);
    if (!children.has(root)) loadDir(root);
    refreshGit(root);
  }, [expanded, children, root, loadDir, refreshGit]);

  const collapseAll = () => setExpanded(new Set([root]));
  const goUp = () => {
    const parent = dirname(root);
    if (parent !== root) setRootTo(parent);
  };

  const toggleHidden = useCallback(() => {
    setShowHidden((v) => {
      const next = !v;
      saveBool(HIDDEN_KEY, next);
      return next;
    });
  }, []);
  const toggleAll = useCallback(() => {
    setShowAll((v) => {
      const next = !v;
      saveBool(ALL_KEY, next);
      return next;
    });
  }, []);
  // Re-fetch the visible tree whenever a toggle changes (refs are updated by
  // render before this effect runs, so loadDir reads the new values).
  useEffect(() => {
    reloadOpenDirs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden, showAll]);

  // The directory a "open terminal here" / "open in browser" acts on: the
  // selected node (its own dir if it's a folder, else its parent), else root.
  const focusDir = useMemo(() => {
    if (!selected) return root;
    // is the selection a known folder? scan loaded children for a dir match.
    for (const list of children.values()) {
      const hit = list.find((e) => e.path === selected);
      if (hit) return hit.is_dir ? hit.path : dirname(selected) || root;
    }
    return dirname(selected) || root;
  }, [selected, children, root]);

  const openTerminalHere = useCallback(() => {
    spawnPane("terminal", { cwd: focusDir });
  }, [focusDir]);

  // "open in browser": the selected FILE → file:// in a browser pane.
  const openInBrowser = useCallback(() => {
    if (!selected) return;
    // only meaningful for files; a folder selection has no file:// target.
    let isFile = false;
    for (const list of children.values()) {
      const hit = list.find((e) => e.path === selected);
      if (hit) {
        isFile = !hit.is_dir;
        break;
      }
    }
    if (!isFile) return;
    spawnPane("browser", { url: fileSrc(selected) });
  }, [selected, children]);

  const openProjectPicker = useCallback(() => {
    setProjOpen((o) => !o);
    if (projects.length === 0) {
      listProjects()
        .then(setProjects)
        .catch(() => setProjects([]));
    }
  }, [projects.length]);

  const rootName = basename(root) || root;
  const f = filter.trim().toLowerCase();

  // Whether the current selection is a file (enables "open in browser").
  const selectedIsFile = useMemo(() => {
    if (!selected) return false;
    for (const list of children.values()) {
      const hit = list.find((e) => e.path === selected);
      if (hit) return !hit.is_dir;
    }
    return false;
  }, [selected, children]);

  // flatten the visible tree into rows (respecting expand state + filter)
  const rows = useMemo(() => {
    const out: { entry: DirEntry; depth: number }[] = [];
    const walk = (path: string, depth: number) => {
      const list = children.get(path);
      if (!list) return;
      for (const e of list) {
        if (f && !e.is_dir && !e.name.toLowerCase().includes(f)) continue;
        out.push({ entry: e, depth });
        if (e.is_dir && expanded.has(e.path)) walk(e.path, depth + 1);
      }
    };
    walk(root, 0);
    return out;
  }, [children, expanded, root, f]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-pane)] text-[13px]">
      {/* header: root + actions */}
      <div className="relative flex h-9 shrink-0 items-center gap-1 border-b border-[var(--color-border)] px-2 text-[var(--color-muted)]">
        <button onClick={() => homeDir().then(setRootTo)} className="rounded p-1 hover:text-[var(--color-text)]" title="Home">
          <Home size={13} />
        </button>
        <button
          onClick={goUp}
          className="truncate px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-2)] hover:text-[var(--color-text)]"
          title={`${root}\n(click to go up)`}
        >
          {rootName}
        </button>
        {gitRoot && (
          <span className="shrink-0 font-mono text-[9.5px] text-[var(--color-faint)]" title={`git repo · ${gitRoot}`}>
            git
          </span>
        )}
        <span className="flex-1" />
        <button onClick={openTerminalHere} className="rounded p-1 hover:text-[var(--color-text)]" title={`Open terminal here\n${focusDir}`}>
          <TerminalSquare size={13} />
        </button>
        {selectedIsFile && (
          <button onClick={openInBrowser} className="rounded p-1 hover:text-[var(--color-text)]" title="Open selected file in browser">
            <Globe size={13} />
          </button>
        )}
        <button onClick={openProjectPicker} className="rounded p-1 hover:text-[var(--color-text)]" title="Open project (re-root this pane)">
          <FolderGit2 size={13} />
        </button>
        <button
          onClick={toggleHidden}
          className={`rounded p-1 hover:text-[var(--color-text)] ${showHidden ? "text-[var(--color-accent)]" : ""}`}
          title={showHidden ? "Hide dotfiles + junk" : "Show dotfiles (.env, .git, …)"}
        >
          {showHidden ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <button onClick={collapseAll} className="rounded p-1 hover:text-[var(--color-text)]" title="Collapse all">
          <ListCollapse size={13} />
        </button>
        <button onClick={refreshAll} className="rounded p-1 hover:text-[var(--color-text)]" title="Refresh">
          <RefreshCw size={12} className={loadingDirs.size ? "animate-spin" : ""} />
        </button>

        {/* project picker dropdown */}
        {projOpen && (
          <>
            <div className="fixed inset-0 z-30" onClick={() => setProjOpen(false)} />
            <div className="surface-pop absolute right-2 top-9 z-40 max-h-[60vh] w-64 overflow-auto py-1">
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-[var(--color-faint)]">open project</div>
              {projects.length === 0 ? (
                <div className="px-3 py-2 text-[12px] text-[var(--color-muted)]">scanning…</div>
              ) : (
                projects.map((p) => (
                  <button
                    key={p.root}
                    onClick={() => {
                      setRootTo(p.root);
                      setProjOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--color-text-2)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                    title={p.root}
                  >
                    <FolderGit2 size={12} className="shrink-0 text-[var(--color-muted)]" />
                    <span className="min-w-0 flex-1 truncate">{p.name}</span>
                    <span className="shrink-0 font-mono text-[9px] text-[var(--color-faint)]">{p.kind}</span>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      {/* filter */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] px-2.5 py-1.5">
        <Search size={12} className="text-[var(--color-faint)]" />
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="filter files…"
          className="min-w-0 flex-1 bg-transparent text-[12px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)]"
        />
        {showAll ? (
          <button
            onClick={toggleAll}
            className="shrink-0 rounded px-1 text-[9px] uppercase tracking-wide text-[var(--color-accent)]"
            title="Hide heavy dirs (node_modules, target, dist, .next)"
          >
            junk on
          </button>
        ) : (
          <button
            onClick={toggleAll}
            className="shrink-0 rounded px-1 text-[9px] uppercase tracking-wide text-[var(--color-faint)] hover:text-[var(--color-muted)]"
            title="Show heavy dirs (node_modules, target, dist, .next)"
          >
            junk off
          </button>
        )}
      </div>

      {error && <p className="px-3 py-2 text-[12px] text-[var(--color-danger)]">{error}</p>}

      {/* tree — dropping a FOLDER here re-roots this pane at it (R-cross-pane). */}
      <div className="min-h-0 flex-1">
      <PaneDropZone
        onDir={(dir) => {
          setRootTo(dir);
          return true;
        }}
        onPath={(p) => {
          // a non-dir path dropped → open it as a file in the editor/viewer.
          onOpenFile?.(p, basename(p));
        }}
        label="drop folder to set as workspace"
      >
      <div className="h-full overflow-auto py-1">
        {rows.map(({ entry, depth }) => (
          <TreeRow
            key={entry.path}
            entry={entry}
            depth={depth}
            open={expanded.has(entry.path)}
            loading={loadingDirs.has(entry.path)}
            selected={selected === entry.path}
            gitCode={git.get(normalizeSlashes(entry.path))}
            folderDirty={entry.is_dir && gitFolders.has(normalizeSlashes(entry.path))}
            onToggle={() => toggle(entry.path)}
            onOpen={() => openFile(entry)}
            onSelect={() => setSelected(entry.path)}
          />
        ))}
        {!rows.length && (
          <p className="px-3 py-2 text-[12px] text-[var(--color-muted)]/60">
            {f ? "no matches" : loadingDirs.size ? "loading…" : "empty"}
          </p>
        )}
      </div>
      </PaneDropZone>
      </div>
    </div>
  );
}

function TreeRow({
  entry,
  depth,
  open,
  loading,
  selected,
  gitCode,
  folderDirty,
  onToggle,
  onOpen,
  onSelect,
}: {
  entry: DirEntry;
  depth: number;
  open: boolean;
  loading: boolean;
  selected: boolean;
  gitCode?: GitCode;
  folderDirty: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onSelect: () => void;
}) {
  const isDir = entry.is_dir;
  const { Icon, color } = fileIcon(entry.name);
  // set when a pointer drag actually started, so the click that may land back
  // on this row after the gesture doesn't toggle/open it.
  const dragStartedRef = useRef(false);
  const nameColor = gitCode
    ? GIT_COLOR[gitCode]
    : isDir
      ? "var(--color-text-2)"
      : "var(--color-text-2)";

  return (
    <div
      // HTML5 draggable stays mac-only: on Windows WebView2 turns it into a
      // native OLE drag that SUPPRESSES every in-page event — no overlays, no
      // ghost, no live feedback, delivery only at release via the Tauri drop
      // event. Disabling it lets the pointer-based drag below own the gesture.
      draggable={isApple}
      onDragStart={(ev) => {
        ev.dataTransfer.setData("text/plain", entry.path);
        ev.dataTransfer.setData(AIOS_PATH_MIME, entry.path);
        // FOLDER rows also flag the dir MIME so drop targets can `cd`/re-root
        // instead of treating the path as a file.
        if (isDir) ev.dataTransfer.setData(AIOS_DIR_MIME, entry.path);
        ev.dataTransfer.effectAllowed = "copy";
      }}
      // Windows: HTML5 dnd never fires inside the Tauri webview, so rows also
      // start the pointer-based path drag after a 6px threshold (paneBus).
      onPointerDown={(ev) => {
        if (ev.button !== 0) return;
        const sx = ev.clientX;
        const sy = ev.clientY;
        const move = (me: PointerEvent) => {
          if (Math.hypot(me.clientX - sx, me.clientY - sy) < 6) return;
          cleanup();
          dragStartedRef.current = true;
          startPathDrag({ path: entry.path, isDir }, me, entry.name);
        };
        const cleanup = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", cleanup);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", cleanup);
      }}
      onClick={() => {
        if (dragStartedRef.current) {
          dragStartedRef.current = false;
          return;
        }
        onSelect();
        if (isDir) onToggle();
        else onOpen();
      }}
      onDoubleClick={() => !isDir && onOpen()}
      title={entry.path}
      className={`group flex cursor-pointer items-center gap-1 pr-2 transition-colors ${
        selected ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-panel-2)]"
      }`}
      style={{ height: 22 }}
    >
      {/* indent guides */}
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} className="h-full w-3 shrink-0 border-l border-[var(--color-border)]/40" />
      ))}

      {/* chevron (dirs) or spacer */}
      {isDir ? (
        <ChevronRight
          size={12}
          className={`shrink-0 text-[var(--color-faint)] transition-transform ${open ? "rotate-90" : ""}`}
        />
      ) : (
        <span className="w-3 shrink-0" />
      )}

      {/* icon */}
      {isDir ? (
        open ? (
          <FolderOpen size={14} className="shrink-0 text-[var(--color-muted)]" />
        ) : (
          <FolderClosed size={14} className="shrink-0 text-[var(--color-muted)]" />
        )
      ) : (
        <Icon size={14} className="shrink-0" style={{ color }} />
      )}

      {/* name */}
      <span
        className="min-w-0 flex-1 truncate"
        style={{ color: nameColor, fontWeight: gitCode || folderDirty ? 500 : 400 }}
      >
        {entry.name}
      </span>

      {/* git decoration: a letter for files, a dot for changed folders */}
      {gitCode ? (
        <span className="shrink-0 font-mono text-[10px]" style={{ color: GIT_COLOR[gitCode] }}>
          {gitCode}
        </span>
      ) : folderDirty ? (
        // status semantics, not accent: a changed folder is a warning-tier signal
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-warning)]" />
      ) : null}

      {loading && <span className="shrink-0 font-mono text-[9px] text-[var(--color-faint)]">…</span>}
    </div>
  );
}
