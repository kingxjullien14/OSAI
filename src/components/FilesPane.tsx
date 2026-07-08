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
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Copy,
  FileText,
  FolderClosed,
  FolderGit2,
  FolderOpen,
  Globe,
  Home,
  Loader2,
  MessageSquareText,
  MoreHorizontal,
  PenLine,
  RefreshCw,
  Search,
  TerminalSquare,
  X,
} from "lucide-react";

import {
  convertOfficeToPdf,
  fileSrc,
  fsCreateDir,
  fsCreateFile,
  fsRename,
  fsTrash,
  gitStatus,
  homeDir,
  readDirTree,
  readFilePreview,
  type DirEntry,
  type FilePreview,
  type GitCode,
} from "../lib/fs";
import { scanWorkspaces, type ProjectInfo } from "../lib/run";
import { flattenProjectWorkspaces, getScanRoots } from "../lib/projectWorkspaces";
import { browserRevealInFinder } from "../lib/browser";
import { OSAI_DIR_MIME, OSAI_PATH_MIME, openEditorFileInPane, spawnPane, startPathDrag } from "../lib/paneBus";
import { PaneMenu, type PaneMenuEntry } from "./PaneMenu";
import { Markdown } from "./chat/Markdown";
import { fileIcon } from "../lib/fileIcons";
import { basename, dirname, normalizeSlashes } from "../lib/paths.ts";
import { isApple } from "../lib/platform";
import { PaneDropZone } from "./PaneDropZone";

/** Top-bar icon button — one hover language for the whole bar. */
const TOP_BTN =
  "grid h-6 w-6 shrink-0 place-items-center rounded-md transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]";

const GIT_COLOR: Record<GitCode, string> = {
  M: "var(--color-warning)", // modified
  A: "var(--color-success)", // added (staged)
  U: "var(--color-success)", // untracked
  D: "var(--color-danger)", // deleted
  R: "var(--color-info)", // renamed
};

// Persisted toggles (VS Code-style defaults: both hidden).
const HIDDEN_KEY = "osai.files.showHidden";
const ALL_KEY = "osai.files.showAll";
const PREVIEW_KEY = "osai.files.preview";
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
  onAnnotate,
  chatTargets,
  onAnnotateTo,
  initialRoot,
  onOpenFile,
}: {
  initialRoot?: string;
  onOpenFile?: (path: string, name: string) => void;
  /** route text (a path) into the active chat composer — "open in chat". */
  onAnnotate?: (text: string) => void;
  /** open conversations — with >1, "open in chat" becomes a picker submenu. */
  chatTargets?: { key: string; label: string }[];
  onAnnotateTo?: (paneKey: string, text: string) => void;
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
  // preview defaults ON (single-click a file → it shows here, not a new pane).
  const [previewOn, setPreviewOn] = useState(() => {
    try {
      return localStorage.getItem(PREVIEW_KEY) !== "0";
    } catch {
      return true;
    }
  });
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [projScan, setProjScan] = useState<"idle" | "scanning" | "done" | "error">("idle");
  const [projMenu, setProjMenu] = useState<{ x: number; y: number } | null>(null);
  const [chatMenu, setChatMenu] = useState<{ x: number; y: number } | null>(null);
  // Dismissing the preview is PER FILE (owner): the X hides this preview,
  // the next click on any file brings the panel back. The persistent
  // panel-off toggle lives in the ⋯ menu.
  const [previewDismissed, setPreviewDismissed] = useState(false);
  useEffect(() => setPreviewDismissed(false), [selected]);

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

  // ── root navigation history (W7.3 top bar): breadcrumbs/home/up/projects
  // go through navigateTo so back/forward always work like a browser's.
  const histRef = useRef<{ back: string[]; fwd: string[] }>({ back: [], fwd: [] });
  const rootRef = useRef(root);
  rootRef.current = root;
  const [histVer, setHistVer] = useState(0); // re-render for button disabled-ness
  const navigateTo = useCallback(
    (path: string) => {
      if (!path || path === rootRef.current) return;
      if (rootRef.current) histRef.current.back.push(rootRef.current);
      histRef.current.fwd = [];
      setHistVer((v) => v + 1);
      setRootTo(path);
    },
    [setRootTo],
  );
  const goBack = useCallback(() => {
    const prev = histRef.current.back.pop();
    if (!prev) return;
    if (rootRef.current) histRef.current.fwd.push(rootRef.current);
    setHistVer((v) => v + 1);
    setRootTo(prev);
  }, [setRootTo]);
  const goForward = useCallback(() => {
    const next = histRef.current.fwd.pop();
    if (!next) return;
    if (rootRef.current) histRef.current.back.push(rootRef.current);
    setHistVer((v) => v + 1);
    setRootTo(next);
  }, [setRootTo]);

  // ── inline entry editor (W7.3 file ops): one input row in the tree for
  // new-file / new-folder / rename. Committing runs the fs op then reloads
  // the affected dir; Escape/blur cancels.
  const [entryEdit, setEntryEdit] = useState<
    | { mode: "new-file" | "new-dir"; dir: string; depth: number }
    | { mode: "rename"; entry: DirEntry; depth: number }
    | null
  >(null);
  const [opError, setOpError] = useState<string | null>(null);
  const joinPath = (dir: string, name: string) =>
    `${dir.replace(/[\\/]+$/, "")}/${name}`;

  const commitEntryEdit = useCallback(
    async (name: string) => {
      const edit = entryEdit;
      setEntryEdit(null);
      const trimmed = name.trim();
      if (!edit || !trimmed || /[\\/]/.test(trimmed)) return;
      setOpError(null);
      try {
        if (edit.mode === "rename") {
          const dir = dirname(edit.entry.path) || rootRef.current;
          if (trimmed === edit.entry.name) return;
          const to = joinPath(dir, trimmed);
          await fsRename(edit.entry.path, to);
          await loadDir(dir);
          setSelected(to);
        } else {
          const target = joinPath(edit.dir, trimmed);
          if (edit.mode === "new-file") await fsCreateFile(target);
          else await fsCreateDir(target);
          if (edit.mode === "new-dir" || !children.has(edit.dir)) {
            setExpanded((prev) => new Set(prev).add(edit.dir));
          }
          await loadDir(edit.dir);
          setSelected(target);
        }
        refreshGit(rootRef.current);
      } catch (e) {
        setOpError(e instanceof Error ? e.message : String(e));
      }
    },
    [entryEdit, children, loadDir, refreshGit],
  );

  const trashEntry = useCallback(
    async (entry: DirEntry) => {
      setOpError(null);
      try {
        await fsTrash(entry.path);
        const dir = dirname(entry.path) || rootRef.current;
        setSelected((cur) => (cur === entry.path ? null : cur));
        setExpanded((prev) => {
          if (!prev.has(entry.path)) return prev;
          const n = new Set(prev);
          n.delete(entry.path);
          return n;
        });
        await loadDir(dir);
        refreshGit(rootRef.current);
      } catch (e) {
        setOpError(e instanceof Error ? e.message : String(e));
      }
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

  // ── per-entry context menu (W3): a FILE and a FOLDER get different menus ──
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: DirEntry } | null>(null);
  const copyPath = (path: string) => {
    navigator.clipboard?.writeText(path).catch(() => {});
  };
  const revealLabel = isApple ? "Reveal in Finder" : "Reveal in Explorer";
  /** "open in chat": one open conversation routes straight in; several become
   *  an inline picker submenu (owner ask — choose WHICH chat). */
  const chatEntry = (label: string, path: string): PaneMenuEntry => {
    const targets = chatTargets ?? [];
    if (targets.length > 1 && onAnnotateTo) {
      return {
        key: "chat",
        label,
        children: targets.map((t) => ({
          key: `chat-${t.key}`,
          label: t.label,
          onSelect: () => onAnnotateTo(t.key, path),
        })),
      };
    }
    return {
      key: "chat",
      label,
      onSelect: () =>
        targets.length === 1 && onAnnotateTo
          ? onAnnotateTo(targets[0].key, path)
          : onAnnotate?.(path),
    };
  };
  /** Tree depth of a path relative to the current root (for the inline
   *  editor's indent — no dependence on the flattened rows). */
  const depthOf = (path: string) => {
    const rel = normalizeSlashes(path).slice(normalizeSlashes(root).length);
    return Math.max(0, rel.split("/").filter(Boolean).length - 1);
  };

  const ctxItems = (entry: DirEntry): PaneMenuEntry[] => {
    const dir = entry.is_dir ? entry.path : dirname(entry.path) || root;
    const rowDepth = depthOf(entry.path);
    const opEntries: PaneMenuEntry[] = [
      ...(entry.is_dir
        ? [
            {
              key: "newfile",
              label: "New file inside",
              onSelect: () => setEntryEdit({ mode: "new-file", dir: entry.path, depth: rowDepth + 1 }),
            } satisfies PaneMenuEntry,
            {
              key: "newdir",
              label: "New folder inside",
              onSelect: () => setEntryEdit({ mode: "new-dir", dir: entry.path, depth: rowDepth + 1 }),
            } satisfies PaneMenuEntry,
          ]
        : []),
      {
        key: "rename",
        label: "Rename",
        hint: "F2",
        onSelect: () => setEntryEdit({ mode: "rename", entry, depth: rowDepth }),
      },
      {
        key: "trash",
        label: "Delete",
        hint: isApple ? "to Trash" : "to Recycle Bin",
        onSelect: () => void trashEntry(entry),
      },
    ];
    if (entry.is_dir) {
      return [
        { key: "term", label: "Open terminal here", onSelect: () => spawnPane("terminal", { cwd: entry.path }) },
        chatEntry("Send to chat", entry.path),
        { key: "sep0", separator: true },
        ...opEntries,
        { key: "sep1", separator: true },
        { key: "root", label: "Set as workspace root", onSelect: () => navigateTo(entry.path) },
        { key: "pane", label: "Open in new files pane", onSelect: () => spawnPane("files", { path: entry.path }) },
        { key: "reveal", label: revealLabel, onSelect: () => void browserRevealInFinder(entry.path).catch(() => {}) },
        { key: "copy", label: "Copy path", onSelect: () => copyPath(entry.path) },
      ];
    }
    return [
      { key: "open", label: "Open", onSelect: () => openFile(entry) },
      chatEntry("Open in chat", entry.path),
      { key: "term", label: "Open in terminal", hint: "cd here", onSelect: () => spawnPane("terminal", { cwd: dir }) },
      { key: "browser", label: "Open in browser", onSelect: () => spawnPane("browser", { url: fileSrc(entry.path) }) },
      { key: "sep0", separator: true },
      ...opEntries,
      { key: "sep1", separator: true },
      { key: "reveal", label: revealLabel, onSelect: () => void browserRevealInFinder(entry.path).catch(() => {}) },
      { key: "copy", label: "Copy path", onSelect: () => copyPath(entry.path) },
    ];
  };

  const refreshAll = useCallback(() => {
    for (const p of expanded) loadDir(p);
    if (!children.has(root)) loadDir(root);
    refreshGit(root);
  }, [expanded, children, root, loadDir, refreshGit]);

  // QOL: coming back to the app re-reads the visible tree (external tools
  // create files constantly); throttled so window-focus ping-pong is free.
  const lastFocusRefresh = useRef(0);
  useEffect(() => {
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefresh.current < 5_000) return;
      lastFocusRefresh.current = now;
      refreshAll();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshAll]);

  const collapseAll = () => setExpanded(new Set([root]));

  // ── breadcrumbs (W7.3): every ancestor is one click away. Long paths keep
  // the last three segments visible; the head collapses into a "…" menu.
  const crumbs = useMemo(() => {
    const norm = normalizeSlashes(root);
    const segs = norm.split("/");
    const list: { label: string; path: string }[] = [];
    let acc = "";
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s === "" && i > 0) continue; // trailing slash / doubled separator
      if (i === 0) {
        // "C:" (windows drive) or "" (posix root)
        acc = s === "" ? "/" : /^[A-Za-z]:$/.test(s) ? `${s}/` : s;
        list.push({ label: s === "" ? "/" : s, path: acc });
      } else {
        acc = acc.endsWith("/") ? `${acc}${s}` : `${acc}/${s}`;
        list.push({ label: s, path: acc });
      }
    }
    return list;
  }, [root]);
  const CRUMB_TAIL = 3;
  const crumbHead = crumbs.length > CRUMB_TAIL + 1 ? crumbs.slice(0, crumbs.length - CRUMB_TAIL) : [];
  const crumbTail = crumbHead.length ? crumbs.slice(-CRUMB_TAIL) : crumbs;
  const [crumbMenu, setCrumbMenu] = useState<{ x: number; y: number } | null>(null);
  const [moreMenu, setMoreMenu] = useState<{ x: number; y: number } | null>(null);

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

  const scanProjects = useCallback(() => {
    setProjScan("scanning");
    scanWorkspaces(getScanRoots())
      .then((ws) => {
        setProjects(flattenProjectWorkspaces(ws));
        setProjScan("done");
      })
      .catch(() => {
        setProjects([]);
        setProjScan("error");
      });
  }, []);

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

  // ── keyboard (W7.3 QOL): arrows walk the tree, → expands, ← collapses/jumps
  // to parent, Enter opens, F2 renames, Delete trashes, Alt+←/→ = history.
  const treeRef = useRef<HTMLDivElement | null>(null);
  const scrollRowIntoView = (path: string) => {
    requestAnimationFrame(() => {
      treeRef.current
        ?.querySelector(`[data-path="${CSS.escape(path)}"]`)
        ?.scrollIntoView({ block: "nearest" });
    });
  };
  const onTreeKeys = (e: React.KeyboardEvent) => {
    if (entryEdit) return; // the inline input owns the keyboard
    if (e.altKey && e.key === "ArrowLeft") {
      e.preventDefault();
      goBack();
      return;
    }
    if (e.altKey && e.key === "ArrowRight") {
      e.preventDefault();
      goForward();
      return;
    }
    const idx = rows.findIndex((r) => r.entry.path === selected);
    const sel = idx >= 0 ? rows[idx] : null;
    const selectAt = (i: number) => {
      const r = rows[Math.max(0, Math.min(rows.length - 1, i))];
      if (r) {
        setSelected(r.entry.path);
        scrollRowIntoView(r.entry.path);
      }
    };
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        selectAt(idx < 0 ? 0 : idx + 1);
        break;
      case "ArrowUp":
        e.preventDefault();
        selectAt(idx < 0 ? 0 : idx - 1);
        break;
      case "ArrowRight":
        if (sel?.entry.is_dir) {
          e.preventDefault();
          if (!expanded.has(sel.entry.path)) toggle(sel.entry.path);
          else selectAt(idx + 1);
        }
        break;
      case "ArrowLeft":
        if (sel) {
          e.preventDefault();
          if (sel.entry.is_dir && expanded.has(sel.entry.path)) {
            toggle(sel.entry.path);
          } else {
            const parent = normalizeSlashes(dirname(sel.entry.path));
            const pi = rows.findIndex((r) => normalizeSlashes(r.entry.path) === parent);
            if (pi >= 0) selectAt(pi);
          }
        }
        break;
      case "Enter":
        if (sel) {
          e.preventDefault();
          if (sel.entry.is_dir) toggle(sel.entry.path);
          else openFile(sel.entry);
        }
        break;
      case "F2":
        if (sel) {
          e.preventDefault();
          setEntryEdit({ mode: "rename", entry: sel.entry, depth: sel.depth });
        }
        break;
      case "Delete":
        if (sel) {
          e.preventDefault();
          void trashEntry(sel.entry);
        }
        break;
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-pane)] text-[13px]">
      {/* top bar (W7.3): history nav · breadcrumbs · git chip | terminal · projects · refresh · ⋯ */}
      <div className="relative flex h-9 shrink-0 items-center gap-0.5 border-b border-[var(--color-border)] bg-[var(--color-panel)]/40 px-1.5 text-[var(--color-muted)] backdrop-blur-md">
        <button
          onClick={goBack}
          disabled={histRef.current.back.length === 0}
          className="rounded p-1 hover:text-[var(--color-text)] disabled:opacity-30 disabled:hover:text-[var(--color-muted)]"
          title="Back (Alt+←)"
          data-hist={histVer /* re-render hook for disabled state */}
        >
          <ArrowLeft size={13} />
        </button>
        <button
          onClick={goForward}
          disabled={histRef.current.fwd.length === 0}
          className="rounded p-1 hover:text-[var(--color-text)] disabled:opacity-30 disabled:hover:text-[var(--color-muted)]"
          title="Forward (Alt+→)"
        >
          <ArrowRight size={13} />
        </button>
        <button onClick={() => void homeDir().then(navigateTo)} className="rounded p-1 hover:text-[var(--color-text)]" title="Home">
          <Home size={13} />
        </button>

        <div className="mx-1 h-4 w-px shrink-0 bg-[var(--color-border)]" />

        {/* breadcrumbs — click any ancestor to jump there */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {crumbHead.length > 0 && (
            <>
              <button
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setCrumbMenu({ x: r.left, y: r.bottom + 4 });
                }}
                className="shrink-0 rounded px-1 py-0.5 font-mono text-[11px] text-[var(--color-faint)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                title={crumbHead[crumbHead.length - 1].path}
              >
                …
              </button>
              <ChevronRight size={10} className="shrink-0 text-[var(--color-faint)]" />
            </>
          )}
          {crumbTail.map((c, i) => (
            <span key={c.path} className="flex min-w-0 items-center gap-0.5">
              {i > 0 && <ChevronRight size={10} className="shrink-0 text-[var(--color-faint)]" />}
              <button
                onClick={() => navigateTo(c.path)}
                className={`truncate rounded px-1 py-0.5 text-[11.5px] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)] ${
                  i === crumbTail.length - 1
                    ? "font-semibold text-[var(--color-text-2)]"
                    : "text-[var(--color-muted)]"
                }`}
                title={c.path}
              >
                {c.label}
              </button>
            </span>
          ))}
          {gitRoot && (
            <span
              className="ml-1 shrink-0 rounded border border-[color-mix(in_srgb,var(--osai-accent-2)_32%,transparent)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--osai-accent-2)]"
              title={`git repo · ${gitRoot}`}
            >
              git
            </span>
          )}
        </div>

        <button onClick={openTerminalHere} className={TOP_BTN} title={`Open terminal here\n${focusDir}`}>
          <TerminalSquare size={13} />
        </button>
        <button
          onClick={(e) => {
            const targets = chatTargets ?? [];
            if (targets.length > 1 && onAnnotateTo) {
              const r = e.currentTarget.getBoundingClientRect();
              setChatMenu({ x: r.right, y: r.bottom + 4 });
            } else if (targets.length === 1 && onAnnotateTo) {
              onAnnotateTo(targets[0].key, focusDir);
            } else {
              onAnnotate?.(focusDir);
            }
          }}
          className={TOP_BTN}
          title={`Send this location to chat\n${focusDir}`}
        >
          <MessageSquareText size={13} />
        </button>
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setProjMenu({ x: r.right, y: r.bottom + 4 });
            // re-scan when we have nothing — a failed/empty first scan must
            // not freeze the picker on a stale result forever.
            if (projects.length === 0) scanProjects();
          }}
          className={TOP_BTN}
          title="Open project (re-root this pane)"
        >
          <FolderGit2 size={13} />
        </button>
        <button onClick={refreshAll} className={TOP_BTN} title="Refresh">
          <RefreshCw size={12} className={loadingDirs.size ? "animate-spin" : ""} />
        </button>
        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMoreMenu({ x: r.right, y: r.bottom + 4 });
          }}
          className={TOP_BTN}
          title="More…"
        >
          <MoreHorizontal size={13} />
        </button>

        {/* project picker — a SOLID PaneMenu like every other menu (the old
            surface-pop dropdown ghosted over the preview panel). Items render
            from live state, so the list fills in as the scan completes. */}
        {projMenu && (
          <PaneMenu
            x={projMenu.x}
            y={projMenu.y}
            items={
              projects.length === 0
                ? [
                    {
                      key: "scan",
                      label:
                        projScan === "error"
                          ? "couldn't scan — retry"
                          : projScan === "done"
                            ? "no projects found"
                            : "scanning projects…",
                      disabled: projScan === "scanning" || projScan === "idle",
                      onSelect: scanProjects,
                    },
                  ]
                : projects.map((p) => ({
                    key: p.root,
                    label: p.name,
                    hint: p.kind === "unknown" ? undefined : p.kind,
                    onSelect: () => navigateTo(p.root),
                  }))
            }
            onClose={() => setProjMenu(null)}
          />
        )}

        {/* chat-target picker (several open chats → choose which) */}
        {chatMenu && (
          <PaneMenu
            x={chatMenu.x}
            y={chatMenu.y}
            items={(chatTargets ?? []).map((t) => ({
              key: t.key,
              label: t.label,
              onSelect: () => onAnnotateTo?.(t.key, focusDir),
            }))}
            onClose={() => setChatMenu(null)}
          />
        )}

        {/* ancestor jump menu (the "…" crumb) */}
        {crumbMenu && (
          <PaneMenu
            x={crumbMenu.x}
            y={crumbMenu.y}
            items={crumbHead
              .slice()
              .reverse()
              .map((c) => ({
                key: c.path,
                label: c.label,
                hint: c.path,
                onSelect: () => navigateTo(c.path),
              }))}
            onClose={() => setCrumbMenu(null)}
          />
        )}

        {/* ⋯ overflow: root file-ops + view toggles + housekeeping */}
        {moreMenu && (
          <PaneMenu
            x={moreMenu.x}
            y={moreMenu.y}
            items={[
              { key: "newfile", label: "New file", hint: "at root", onSelect: () => setEntryEdit({ mode: "new-file", dir: root, depth: 0 }) },
              { key: "newdir", label: "New folder", hint: "at root", onSelect: () => setEntryEdit({ mode: "new-dir", dir: root, depth: 0 }) },
              { key: "sep0", separator: true },
              { key: "hidden", label: showHidden ? "Hide dotfiles" : "Show dotfiles", hint: ".env, .git, …", onSelect: toggleHidden },
              { key: "junk", label: showAll ? "Hide heavy dirs" : "Show heavy dirs", hint: "node_modules, …", onSelect: toggleAll },
              { key: "preview", label: previewOn ? "Hide preview panel" : "Show preview panel", onSelect: () => setPreviewOn((v) => { saveBool(PREVIEW_KEY, !v); return !v; }) },
              { key: "sep1", separator: true },
              ...(selectedIsFile
                ? [{ key: "browser", label: "Open selected in browser", onSelect: openInBrowser } satisfies PaneMenuEntry]
                : []),
              { key: "collapse", label: "Collapse all", onSelect: collapseAll },
              { key: "reveal", label: `${revealLabel} (root)`, onSelect: () => void browserRevealInFinder(root).catch(() => {}) },
              { key: "copy", label: "Copy root path", onSelect: () => copyPath(root) },
            ]}
            onClose={() => setMoreMenu(null)}
          />
        )}

      </div>

      {/* filter rail — inset search field + junk pill (deck language) */}
      <div className="flex shrink-0 items-center gap-1.5 border-b border-[var(--color-border)] px-2 py-1.5">
        <div className="relative min-w-0 flex-1">
          <Search
            size={12}
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-faint)]"
          />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="filter files"
            spellCheck={false}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)]/70 py-1 pl-7 pr-6 text-[12px] text-[var(--color-text)] outline-none transition-colors focus:border-[var(--color-accent)]/60"
          />
          {filter && (
            <button
              onClick={() => setFilter("")}
              className="absolute right-1 top-1/2 grid h-4 w-4 -translate-y-1/2 place-items-center rounded text-[var(--color-faint)] hover:text-[var(--color-text)]"
              title="clear filter"
            >
              <X size={11} />
            </button>
          )}
        </div>
        <button
          onClick={toggleAll}
          title={
            showAll
              ? "Hide heavy dirs (node_modules, target, dist, .next)"
              : "Show heavy dirs (node_modules, target, dist, .next)"
          }
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-wide transition-colors ${
            showAll
              ? "border-[var(--color-accent)]/50 bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
              : "border-[var(--color-border)] text-[var(--color-faint)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-muted)]"
          }`}
        >
          junk
        </button>
      </div>

      {error && <p className="px-3 py-2 text-[12px] text-[var(--color-danger)]">{error}</p>}
      {opError && (
        <button
          onClick={() => setOpError(null)}
          className="border-b border-[var(--color-border)] px-3 py-1 text-left text-[11px] text-[var(--color-danger)]"
          title="dismiss"
        >
          {opError}
        </button>
      )}

      {/* body — tree on the left; when the preview panel is on and a FILE is
          selected (and not dismissed), it splits to show an inset glass card. */}
      <div className="flex min-h-0 flex-1">
      {/* tree — dropping a FOLDER here re-roots this pane at it (R-cross-pane). */}
      <div className={`min-h-0 ${previewOn && selectedIsFile && !previewDismissed ? "w-[45%] min-w-[200px] shrink-0" : "flex-1"}`}>
      <PaneDropZone
        onDir={(dir) => {
          navigateTo(dir);
          return true;
        }}
        onPath={(p) => {
          // a non-dir path dropped → open it as a file in the editor/viewer.
          onOpenFile?.(p, basename(p));
        }}
        label="drop folder to set as workspace"
      >
      {/* .stagger: initial listing cascades once (capped at 5 delays); rows are
          keyed by path so scroll/expand only animate genuinely NEW entries. */}
      <div
        ref={treeRef}
        tabIndex={0}
        onKeyDown={onTreeKeys}
        className="stagger h-full overflow-auto py-1 font-mono text-[12px] outline-none"
      >
        {entryEdit && entryEdit.mode !== "rename" && entryEdit.dir === root && (
          <EntryEditRow
            mode={entryEdit.mode}
            depth={0}
            onCommit={commitEntryEdit}
            onCancel={() => setEntryEdit(null)}
          />
        )}
        {rows.map(({ entry, depth }) =>
          entryEdit?.mode === "rename" && entryEdit.entry.path === entry.path ? (
            <EntryEditRow
              key={entry.path}
              mode="rename"
              depth={depth}
              initial={entry.name}
              isDir={entry.is_dir}
              onCommit={commitEntryEdit}
              onCancel={() => setEntryEdit(null)}
            />
          ) : (
            <div key={entry.path}>
              <TreeRow
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setSelected(entry.path);
                  setCtxMenu({ x: e.clientX, y: e.clientY, entry });
                }}
              />
              {entryEdit &&
                entryEdit.mode !== "rename" &&
                entry.is_dir &&
                entryEdit.dir === entry.path && (
                  <EntryEditRow
                    mode={entryEdit.mode}
                    depth={depth + 1}
                    onCommit={commitEntryEdit}
                    onCancel={() => setEntryEdit(null)}
                  />
                )}
            </div>
          ),
        )}
        {!rows.length && (
          <p className="px-3 py-2 text-[12px] text-[var(--color-muted)]/60">
            {f ? "no matches" : loadingDirs.size ? "loading…" : "empty"}
          </p>
        )}
      </div>
      </PaneDropZone>
      </div>
      {ctxMenu && (
        <PaneMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxItems(ctxMenu.entry)}
          onClose={() => setCtxMenu(null)}
        />
      )}
      {previewOn && selectedIsFile && selected && !previewDismissed && (
        <div className="min-h-0 min-w-0 flex-1 p-2 pl-1">
          <FilePreviewPanel
            path={selected}
            gitCode={git.get(normalizeSlashes(selected))}
            // FORCE the editor: the button says "open in editor", but the auto
            // router sends viewer-kind extensions (md, pdf, …) to the VIEWER.
            onOpenInEditor={() =>
              selected &&
              (openEditorFileInPane(selected, basename(selected)) ||
                onOpenFile?.(selected, basename(selected)))
            }
            onOpenInBrowser={openInBrowser}
            onReveal={() => browserRevealInFinder(selected).catch(() => {})}
            onClose={() => setPreviewDismissed(true)}
          />
        </div>
      )}
      </div>
    </div>
  );
}

/** Inline file preview — the right half of the Files split. Loads a capped
 *  preview (text ≤256KB, or an image/pdf via the asset protocol) and renders it
 *  in a frosted glass panel; anything non-renderable shows a typed placeholder
 *  with an "open in editor" hand-off. */
/** A line of code → lightly highlighted spans (strings green, numbers cyan,
 *  comment lines faint). Dependency-free + per-line; evokes the mockup's syntax
 *  colors without a heavyweight highlighter on a capped preview. */
function highlightLine(line: string): React.ReactNode {
  const t = line.trimStart();
  if (
    t.startsWith("//") || t.startsWith("#") || t.startsWith("*") ||
    t.startsWith("/*") || t.startsWith("--") || t.startsWith(";")
  ) {
    return <span style={{ color: "var(--color-faint)" }}>{line}</span>;
  }
  const parts: React.ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d[\d._]*\b)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(line)) !== null) {
    if (m.index > last) parts.push(line.slice(last, m.index));
    const tok = m[0];
    const isStr = /^["'`]/.test(tok);
    parts.push(
      <span key={i++} style={{ color: isStr ? "var(--color-success)" : "var(--osai-accent-2)" }}>
        {tok}
      </span>,
    );
    last = re.lastIndex;
  }
  if (last < line.length) parts.push(line.slice(last));
  return parts.length ? parts : line;
}

const GIT_WORD: Record<GitCode, string> = {
  M: "modified",
  A: "added",
  U: "untracked",
  D: "deleted",
  R: "renamed",
};

function FilePreviewPanel({
  path,
  gitCode,
  onOpenInEditor,
  onOpenInBrowser,
  onReveal,
  onClose,
}: {
  path: string;
  gitCode?: GitCode;
  onOpenInEditor: () => void;
  onOpenInBrowser: () => void;
  onReveal: () => void;
  onClose: () => void;
}) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  // markdown renders like chat prose by default; a header toggle shows source.
  const [mdRaw, setMdRaw] = useState(false);
  // office docs convert on demand (LibreOffice) → pdf iframe.
  const [officePdf, setOfficePdf] = useState<string | null>(null);
  const [officeBusy, setOfficeBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr(null);
    setPreview(null);
    setMdRaw(false);
    setOfficePdf(null);
    setOfficeBusy(false);
    setCopied(false);
    readFilePreview(path)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setErr(String(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path]);
  const name = basename(path);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const isMd =
    ["md", "mdx", "markdown"].includes(ext) &&
    preview?.kind === "text" &&
    preview.text != null;
  // line-numbered code (mockup): split into rows, capped for perf on huge files.
  const LINE_CAP = 1500;
  const lines =
    preview?.kind === "text" && preview.text != null ? preview.text.split("\n") : null;
  const shownLines = lines ? lines.slice(0, LINE_CAP) : null;
  return (
    <div className="glass flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--color-border)]">
      {/* preview header — cyan file-icon chip + name + meta + dismiss */}
      <div className="flex h-10 shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] px-3">
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--osai-accent-2)_30%,transparent)] bg-[color-mix(in_srgb,var(--osai-accent-2)_12%,transparent)] text-[var(--osai-accent-2)]">
          <FileText size={12} />
        </span>
        <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-[var(--color-text)]" title={path}>
          {name}
        </span>
        {preview && (
          <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wide text-[var(--color-faint)]">
            {(ext || preview.kind)} · {fmtBytes(preview.size)}
            {gitCode && (
              <span style={{ color: GIT_COLOR[gitCode] }}> · {GIT_WORD[gitCode]}</span>
            )}
          </span>
        )}
        {isMd && (
          <button
            onClick={() => setMdRaw((v) => !v)}
            className={`rounded px-1.5 py-0.5 font-mono text-[9.5px] uppercase tracking-wide transition-colors hover:text-[var(--color-text)] ${
              mdRaw ? "text-[var(--color-muted)]" : "text-[var(--color-accent)]"
            }`}
            title={mdRaw ? "show rendered markdown" : "show source"}
          >
            {mdRaw ? "raw" : "rendered"}
          </button>
        )}
        {preview?.kind === "text" && preview.text != null && (
          <button
            onClick={() => {
              navigator.clipboard
                ?.writeText(preview.text ?? "")
                .then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                })
                .catch(() => {});
            }}
            className={`rounded p-1 transition-colors hover:text-[var(--color-text)] ${
              copied ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"
            }`}
            title={copied ? "copied" : "copy contents"}
          >
            <Copy size={11} />
          </button>
        )}
        <button
          onClick={onClose}
          className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
          title="dismiss — the next file you click previews again"
        >
          <X size={12} />
        </button>
      </div>
      {/* preview body */}
      <div className="relative min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="grid h-full place-items-center">
            <Loader2 size={16} className="animate-spin text-[var(--color-accent)]" />
          </div>
        ) : err ? (
          <p className="p-3 font-mono text-[11px] text-[var(--color-danger)]">{err}</p>
        ) : !preview ? null : preview.kind === "image" ? (
          <div className="grid h-full place-items-center p-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileSrc(path)} alt={name} className="max-h-full max-w-full rounded-lg object-contain shadow-[var(--osai-shadow-pop)]" />
          </div>
        ) : preview.kind === "pdf" ? (
          <iframe src={fileSrc(path)} title={name} className="h-full w-full border-0" />
        ) : preview.kind === "video" ? (
          <div className="grid h-full place-items-center bg-black/20 p-3">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
            <video
              src={fileSrc(path)}
              controls
              className="max-h-full max-w-full rounded-lg shadow-[var(--osai-shadow-pop)]"
            />
          </div>
        ) : preview.kind === "office" ? (
          officePdf ? (
            <iframe src={fileSrc(officePdf)} title={name} className="h-full w-full border-0" />
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <FileText size={26} className="text-[var(--color-faint)]" />
              <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                {ext || "office"} document · {fmtBytes(preview.size)}
              </span>
              <button
                onClick={() => {
                  setOfficeBusy(true);
                  convertOfficeToPdf(path)
                    .then(setOfficePdf)
                    .catch((e) => setErr(String(e)))
                    .finally(() => setOfficeBusy(false));
                }}
                disabled={officeBusy}
                className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-[11.5px] text-[var(--color-text-2)] transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] hover:text-[var(--color-text)] disabled:opacity-50"
              >
                {officeBusy ? (
                  <>
                    <Loader2 size={12} className="animate-spin" /> converting…
                  </>
                ) : (
                  <>convert &amp; preview</>
                )}
              </button>
              <span className="text-[10px] text-[var(--color-faint)]">uses LibreOffice if installed</span>
            </div>
          )
        ) : isMd && !mdRaw ? (
          <div className="p-4 text-[13px] leading-relaxed text-[var(--color-text-2)]">
            <Markdown text={preview.text ?? ""} />
            {preview.truncated && (
              <div className="mt-2 border-t border-[var(--color-border)] pt-1.5 text-[10px] text-[var(--color-faint)]">
                preview capped · open in editor for the full file
              </div>
            )}
          </div>
        ) : shownLines ? (
          // NO soft-wrap (the mockup + every editor): long lines scroll
          // horizontally inside the panel instead of shredding CSV columns.
          <div className="min-w-max py-2 font-mono text-[11.5px] leading-[1.7]">
            {shownLines.map((ln, i) => (
              <div key={i} className="flex min-w-full pr-3 hover:bg-[color-mix(in_srgb,var(--color-accent)_5%,transparent)]">
                <span className="mr-3 w-11 shrink-0 select-none border-r border-[var(--color-border)] pl-2 pr-2.5 text-right text-[var(--color-faint)]">
                  {i + 1}
                </span>
                <span className="whitespace-pre text-[var(--color-text-2)]">{highlightLine(ln) || " "}</span>
              </div>
            ))}
            {(lines!.length > LINE_CAP || preview.truncated) && (
              <div className="mt-1 border-t border-[var(--color-border)] px-3 py-1.5 text-[10px] text-[var(--color-faint)]">
                preview capped · open in editor for the full file
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <FileText size={26} className="text-[var(--color-faint)]" />
            <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
              {preview.kind} · {ext || "file"}
            </span>
            <span className="font-mono text-[10px] text-[var(--color-faint)]">{fmtBytes(preview.size)}</span>
          </div>
        )}
      </div>
      {/* footer — gradient open-in-editor + ghost open-in-browser (mockup) */}
      <div className="flex shrink-0 items-center gap-2 border-t border-[var(--color-border)] px-3 py-2">
        <button
          onClick={onOpenInEditor}
          className="press flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] font-medium text-[var(--color-accent-fg)] transition-all bg-[linear-gradient(135deg,var(--color-accent),color-mix(in_srgb,var(--color-accent)_50%,var(--osai-accent-2)))] shadow-[0_0_16px_-5px_color-mix(in_srgb,var(--color-accent)_70%,transparent)] hover:brightness-110"
        >
          <PenLine size={12} /> open in editor
        </button>
        <button
          onClick={onOpenInBrowser}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-[11.5px] text-[var(--color-text-2)] transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] hover:text-[var(--color-text)]"
        >
          <Globe size={12} /> open in browser
        </button>
        <button
          onClick={onReveal}
          title={isApple ? "reveal in Finder" : "reveal in Explorer"}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-3 py-1.5 text-[11.5px] text-[var(--color-text-2)] transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] hover:text-[var(--color-text)]"
        >
          <FolderOpen size={12} /> reveal
        </button>
      </div>
    </div>
  );
}

/** bytes → "1.2 KB" / "3.4 MB". */
function fmtBytes(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} KB`;
  return `${n} B`;
}

/** The inline name editor (W7.3 file ops): one tree row with an input where
 *  the name goes. Enter commits, Escape cancels; blur commits when non-empty
 *  (VS Code's behavior) so click-away doesn't eat a typed name. */
function EntryEditRow({
  mode,
  depth,
  initial,
  isDir,
  onCommit,
  onCancel,
}: {
  mode: "new-file" | "new-dir" | "rename";
  depth: number;
  initial?: string;
  isDir?: boolean;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  const doneRef = useRef(false); // Enter + the blur it causes must not double-commit
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // pre-select the stem so a rename keeps the extension by default
    const dot = (initial ?? "").lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 && mode === "rename" ? dot : (initial ?? "").length);
  }, [initial, mode]);
  const dirish = mode === "new-dir" || (mode === "rename" && isDir);
  return (
    <div className="flex items-center gap-1 pr-2" style={{ height: 23 }}>
      {Array.from({ length: depth }).map((_, i) => (
        <span key={i} className="h-full w-3 shrink-0 border-l border-[var(--color-border)]/40" />
      ))}
      <span className="w-3 shrink-0" />
      {dirish ? (
        <FolderClosed size={14} className="shrink-0 text-[var(--color-muted)]" />
      ) : (
        <FileText size={14} className="shrink-0 text-[var(--color-muted)]" />
      )}
      <input
        ref={ref}
        defaultValue={initial ?? ""}
        spellCheck={false}
        placeholder={mode === "new-dir" ? "folder name" : "file name"}
        onKeyDown={(e) => {
          e.stopPropagation(); // the tree's arrow/Delete handling must not fire
          if (e.key === "Enter") {
            doneRef.current = true;
            onCommit(e.currentTarget.value);
          } else if (e.key === "Escape") {
            doneRef.current = true;
            onCancel();
          }
        }}
        onBlur={(e) => {
          if (doneRef.current) return;
          const v = e.currentTarget.value.trim();
          if (v && v !== (initial ?? "")) onCommit(v);
          else onCancel();
        }}
        className="min-w-0 flex-1 rounded border border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[var(--color-bg)] px-1 py-0 text-[12px] text-[var(--color-text)] outline-none"
      />
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
  onContextMenu,
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
  onContextMenu: (e: React.MouseEvent) => void;
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
      onContextMenu={onContextMenu}
      // HTML5 draggable stays mac-only: on Windows WebView2 turns it into a
      // native OLE drag that SUPPRESSES every in-page event — no overlays, no
      // ghost, no live feedback, delivery only at release via the Tauri drop
      // event. Disabling it lets the pointer-based drag below own the gesture.
      draggable={isApple}
      onDragStart={(ev) => {
        ev.dataTransfer.setData("text/plain", entry.path);
        ev.dataTransfer.setData(OSAI_PATH_MIME, entry.path);
        // FOLDER rows also flag the dir MIME so drop targets can `cd`/re-root
        // instead of treating the path as a file.
        if (isDir) ev.dataTransfer.setData(OSAI_DIR_MIME, entry.path);
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
        // single click: dirs expand; FILES only select → show in the preview
        // panel (no new pane). Double-click opens the file in its own pane.
        if (isDir) onToggle();
      }}
      onDoubleClick={() => !isDir && onOpen()}
      title={entry.path}
      data-path={entry.path}
      className={`group flex cursor-pointer items-center gap-1 pr-2 transition-colors ${
        selected
          ? "bg-[color-mix(in_srgb,var(--color-accent)_13%,transparent)] shadow-[inset_2px_0_0_var(--color-accent)]"
          : "hover:bg-[color-mix(in_srgb,var(--color-accent)_6%,transparent)]"
      }`}
      style={{ height: 23 }}
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
        style={{
          color: selected ? "var(--color-text)" : nameColor,
          fontWeight: gitCode || folderDirty ? 500 : 400,
        }}
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
