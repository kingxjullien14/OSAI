/** A Monaco-backed code editor pane — VS Code's editor core, so syntax
 *  highlighting, minimap, breadcrumbs, multi-cursor, find/replace all feel
 *  identical. Opens a file from the Files pane, edits in-app, ⌘S to save
 *  (atomic write). This is the foundation of replacing VS Code with the shell. */
import { useCallback, useEffect, useRef, useState } from "react";
import type * as Monaco from "monaco-editor";
import { openPath } from "@tauri-apps/plugin-opener";
import { AlertTriangle, Check, Circle, ExternalLink, Eye } from "lucide-react";

import { fileMtime, readTextFile, SaveConflictError, writeTextFile } from "../lib/fs";
import { browserRevealInFinder } from "../lib/browser";
import { chord, isApple } from "../lib/platform";
import { dirname } from "../lib/paths.ts";
import { loadSettings, subscribe as subscribeSettings } from "../lib/settings";
import { languageForPath } from "../lib/editorLanguage";
import {
  lspAcquire,
  lspDidSave,
  lspRelease,
  lspStatusForPath,
  onLspStatus,
  type LspStatusEvent,
} from "../lib/lsp/manager";
import {
  openFileInPane,
  openViewerFileInPane,
  paneMenuExtras,
  registerPaneDropSink,
  spawnPane,
} from "../lib/paneBus";
import { PaneDropZone } from "./PaneDropZone";
import { Skeleton } from "./ui";
import { reportDiag } from "../lib/diag";

// ── ref-counted URI models (STRETCH) ────────────────────────────────────────
// Anonymous `value`-based models can't see each other, so a single-file TS
// import resolves to nothing (no go-to-def / hover) and rapidly switching a
// pane's `path` leaked a model per swap. Creating models keyed by `monaco.Uri.
// file(path)` gives every open file a stable identity Monaco's language service
// can cross-reference, and lets us share one model across panes opening the same
// file. We ref-count so the model is disposed only when the LAST pane using it
// unmounts (never while another pane still shows the file).
const modelRefs = new Map<string, number>();

function acquireModel(monaco: typeof Monaco, path: string, content: string): Monaco.editor.ITextModel {
  const uri = monaco.Uri.file(path);
  const key = uri.toString();
  let model = monaco.editor.getModel(uri);
  if (!model) {
    model = monaco.editor.createModel(content, languageForPath(path), uri);
  }
  modelRefs.set(key, (modelRefs.get(key) ?? 0) + 1);
  return model;
}

function releaseModel(monaco: typeof Monaco, path: string) {
  const uri = monaco.Uri.file(path);
  const key = uri.toString();
  const n = (modelRefs.get(key) ?? 0) - 1;
  if (n <= 0) {
    modelRefs.delete(key);
    monaco.editor.getModel(uri)?.dispose();
  } else {
    modelRefs.set(key, n);
  }
}

export function EditorPane({
  path,
  name,
  paneKey,
  line,
  col,
}: {
  path: string;
  name: string;
  paneKey?: string;
  /** Optional 1-based jump target on open (global search → open-at-line). */
  line?: number;
  col?: number;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  // Save-conflict prompt state: set on a blocked save (backend mtime guard) OR
  // by the idle external-change watcher below.
  const [conflict, setConflict] = useState(false);
  // live caret for the header's Ln:Col readout.
  const [cursor, setCursor] = useState<{ ln: number; col: number } | null>(null);
  // view toggles surfaced in the window ⋯ menu (Monaco options, per pane).
  const wrapRef = useRef(false);
  const minimapRef = useRef(true);
  // "show diff" overlay (disk version vs the live buffer) while in conflict.
  const [diffOpen, setDiffOpen] = useState(false);
  // Language-server status for THIS file (null = no server involved → no pill).
  const [lsp, setLsp] = useState<LspStatusEvent | null>(null);

  // mtime captured at load (and re-based after each successful save). Drives the
  // save-conflict guard so an AI/human edit underneath us can't be clobbered.
  const mtimeRef = useRef<number>(0);
  // mirrors `dirty` for the idle watcher's interval closure.
  const dirtyRef = useRef(false);
  // true while a save/reload/overwrite is in flight — the idle watcher skips its
  // check so it can't race our own write (the write moves the mtime before we
  // re-base it).
  const busyRef = useRef(false);
  const diffHostRef = useRef<HTMLDivElement>(null);
  // in-flight LSP acquire for this path — cleanup chains release behind it.
  const lspAcquireRef = useRef<Promise<void> | null>(null);
  // keep the latest save fn reachable from the monaco keybinding closure
  const saveRef = useRef<() => void>(() => {});
  const savingRef = useRef(false);

  useEffect(() => {
    let disposed = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;
    let monacoRef: typeof Monaco | null = null;

    (async () => {
      let content: string;
      try {
        content = await readTextFile(path);
      } catch (e) {
        if (!disposed) {
          setError(String(e));
          setLoading(false);
        }
        return;
      }
      // capture mtime alongside the content for conflict detection (best-effort).
      mtimeRef.current = await fileMtime(path).catch(() => 0);
      if (disposed || !hostRef.current) return;

      const { initMonaco } = await import("../lib/monaco");
      if (disposed || !hostRef.current) return;
      const monaco = initMonaco();
      monacoRef = monaco;

      // Use a real URI-keyed model (shared, cross-referenceable) rather than an
      // anonymous inline `value` model. If another pane already holds this file
      // open, its model already reflects unsaved edits — reuse it (don't reset to
      // the freshly-read disk content, which would drop those edits).
      const model = acquireModel(monaco, path, content);

      // LSP didOpen (TRACK B). Async (resolves the workspace root + may boot a
      // server); the cleanup releases AFTER the acquire settles so the
      // refcounts pair correctly even when the pane closes mid-boot.
      lspAcquireRef.current = lspAcquire(path, model).catch(() => {});

      editor = monaco.editor.create(hostRef.current, {
        model,
        theme: "osai-dark",
        automaticLayout: true,
        // the appearance "text size" slider drives editors + terminals alike.
        fontSize: loadSettings().terminalFontSize || 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontLigatures: true,
        minimap: { enabled: true },
        smoothScrolling: true,
        cursorBlinking: "smooth",
        scrollBeyondLastLine: false,
        renderWhitespace: "selection",
        tabSize: 2,
        bracketPairColorization: { enabled: true },
        padding: { top: 10 },
      });
      editorRef.current = editor;
      setLoading(false);

      // jump-to-line (global search → open-at-line). Reveal centered + place the
      // cursor; guard against a stale/out-of-range line.
      if (line && line > 0) {
        const lineCount = model.getLineCount();
        const ln = Math.min(line, lineCount);
        editor.revealLineInCenter(ln);
        editor.setPosition({ lineNumber: ln, column: col && col > 0 ? col : 1 });
        editor.focus();
      }

      const save = async () => {
        const ed = editorRef.current;
        if (!ed) return;
        // in-flight guard: Monaco's chord + the pane-level listener can both
        // fire on one Ctrl+S — a second concurrent write raced the first's
        // mtime update into a false "changed on disk" conflict banner.
        if (savingRef.current) return;
        savingRef.current = true;
        busyRef.current = true;
        try {
          const newMtime = await writeTextFile(path, ed.getValue(), mtimeRef.current || undefined);
          if (disposed) return;
          mtimeRef.current = newMtime || mtimeRef.current;
          setDirty(false);
          setSavedAt(Date.now());
          setConflict(false);
          lspDidSave(path); // tsserver/rust-analyzer re-check dependents promptly
        } catch (e) {
          if (disposed) return;
          if (e instanceof SaveConflictError) {
            // someone changed the file on disk since we loaded it — don't clobber.
            // NOTE: do NOT re-base mtimeRef here — a plain ⌘S retry must keep
            // failing until the user picks keep mine / take disk (the old
            // re-base let a second ⌘S silently clobber the external change).
            setConflict(true);
          } else {
            setError(String(e));
          }
        } finally {
          savingRef.current = false;
          busyRef.current = false;
        }
      };
      saveRef.current = save;

      editor.onDidChangeModelContent(() => {
        if (!disposed) {
          setDirty(true);
          setSavedAt(null);
        }
      });
      editor.onDidChangeCursorPosition((ev) => {
        if (!disposed) setCursor({ ln: ev.position.lineNumber, col: ev.position.column });
      });
      // ⌘S / Ctrl+S → save
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveRef.current());
    })();

    return () => {
      disposed = true;
      // LSP didClose — awaited past the in-flight acquire so open/close always
      // pair (a pane closed during server boot must not leak a doc ref).
      const acquired = lspAcquireRef.current;
      lspAcquireRef.current = null;
      if (acquired) void acquired.finally(() => lspRelease(path));
      // Detach the model from the editor BEFORE disposing the editor so the
      // editor doesn't dispose a model another pane may still be using; then
      // release our ref-count (disposes the model only when the last pane drops it).
      editor?.setModel(null);
      editor?.dispose();
      editorRef.current = null;
      if (monacoRef) releaseModel(monacoRef, path);
    };
  }, [path, line, col]);

  // status pill: re-query this file's server status on every manager event
  // (events are coarse + rare — starting/ready/failed transitions).
  useEffect(() => {
    setLsp(lspStatusForPath(path));
    return onLspStatus(() => setLsp(lspStatusForPath(path)));
  }, [path]);

  // a tiny ⌘S affordance that also works when focus is in the header — scoped
  // to THIS pane (a window-wide listener made every open editor save at once).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s")) return;
      const root = hostRef.current?.closest("[data-pane-key]") ?? hostRef.current;
      if (!root || !(e.target instanceof Node) || !root.contains(e.target)) return;
      e.preventDefault();
      saveRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // live settings → Monaco font size (matches the terminal's behavior).
  useEffect(
    () =>
      subscribeSettings((s) => {
        editorRef.current?.updateOptions({ fontSize: s.terminalFontSize || 13 });
      }),
    [],
  );

  // ⋯-menu contributions (W7 pane 7) — the same registry the terminal and
  // notes panes use. Getter form: disabled-ness/labels evaluate at menu-open.
  useEffect(() => {
    if (!paneKey) return;
    paneMenuExtras.set(paneKey, () => [
      {
        key: "ed-save",
        label: "Save",
        hint: chord("S"),
        disabled: !dirtyRef.current,
        onSelect: () => saveRef.current(),
      },
      {
        key: "ed-format",
        label: "Format document",
        onSelect: () => {
          void editorRef.current
            ?.getAction("editor.action.formatDocument")
            ?.run()
            .catch(() => {});
        },
      },
      // the cross-jump ONLY (a viewer offers "open in editor", an editor
      // offers "open in viewer") — the menu never names the mode you're in.
      {
        key: "ed-view",
        label: "Open in viewer",
        hint: /\.(md|markdown)$/i.test(path) ? "rendered" : undefined,
        onSelect: () => openViewerFileInPane(path, name),
      },
      {
        key: "ed-wrap",
        label: wrapRef.current ? "Disable word wrap" : "Enable word wrap",
        onSelect: () => {
          wrapRef.current = !wrapRef.current;
          editorRef.current?.updateOptions({ wordWrap: wrapRef.current ? "on" : "off" });
        },
      },
      {
        key: "ed-minimap",
        label: minimapRef.current ? "Hide minimap" : "Show minimap",
        onSelect: () => {
          minimapRef.current = !minimapRef.current;
          editorRef.current?.updateOptions({ minimap: { enabled: minimapRef.current } });
        },
      },
      { key: "ed-sep", separator: true },
      {
        key: "ed-copy",
        label: "Copy path",
        onSelect: () => void navigator.clipboard?.writeText(path).catch(() => {}),
      },
      {
        key: "ed-reveal",
        label: isApple ? "Reveal in Finder" : "Reveal in Explorer",
        onSelect: () => void browserRevealInFinder(path).catch(() => {}),
      },
      {
        key: "ed-term",
        label: "Open terminal here",
        hint: "cd to folder",
        onSelect: () => spawnPane("terminal", { cwd: dirname(path) }),
      },
    ]);
    return () => {
      paneMenuExtras.delete(paneKey);
    };
  }, [paneKey, path]);

  // Reload the file from disk, discarding local edits (conflict → "take disk").
  const reloadFromDisk = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed) return;
    busyRef.current = true;
    try {
      const content = await readTextFile(path);
      mtimeRef.current = await fileMtime(path).catch(() => 0);
      ed.getModel()?.setValue(content);
      setDirty(false);
      setConflict(false);
      setSavedAt(null);
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
    }
  }, [path]);

  // Force-overwrite the on-disk file with the buffer (conflict → "keep mine").
  // No expected_mtime = the backend mtime guard is bypassed on purpose.
  const overwrite = useCallback(async () => {
    const ed = editorRef.current;
    if (!ed) return;
    busyRef.current = true;
    try {
      const newMtime = await writeTextFile(path, ed.getValue(), undefined);
      mtimeRef.current = newMtime || mtimeRef.current;
      setDirty(false);
      setSavedAt(Date.now());
      setConflict(false);
    } catch (e) {
      setError(String(e));
    } finally {
      busyRef.current = false;
    }
  }, [path]);

  // mirror `dirty` into a ref the idle watcher's interval closure can read.
  useEffect(() => {
    dirtyRef.current = dirty;
  }, [dirty]);

  // EXTERNAL-CHANGE WATCHER (idle): the backend guard only fires on ⌘S — if the
  // AI (or any other tool) rewrites the file while it just sits open here, we
  // want to know NOW, not at the next save. Cheap stat every 4s + on window
  // focus. Clean buffer → quietly take the disk version (nothing of ours to
  // lose — VS Code's auto-revert). Dirty buffer → the same conflict banner.
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      if (busyRef.current || !editorRef.current || !mtimeRef.current) return;
      const onDisk = await fileMtime(path).catch(() => 0);
      if (cancelled || busyRef.current || !editorRef.current) return;
      if (!onDisk || !mtimeRef.current || Math.abs(onDisk - mtimeRef.current) <= 1) return;
      if (dirtyRef.current) setConflict(true);
      else void reloadFromDisk();
    };
    const id = window.setInterval(check, 4000);
    window.addEventListener("focus", check);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.removeEventListener("focus", check);
    };
  }, [path, reloadFromDisk]);

  // Close the diff overlay whenever the conflict resolves.
  useEffect(() => {
    if (!conflict && diffOpen) setDiffOpen(false);
  }, [conflict, diffOpen]);

  // "show diff" — a monaco diff editor OVERLAID on the normal editor. Left =
  // on-disk version (read-only snapshot), right = the LIVE buffer model, so
  // edits made inside the diff land in the real buffer. The standalone editor
  // stays mounted underneath (automaticLayout keeps both happy).
  useEffect(() => {
    if (!diffOpen) return;
    let disposed = false;
    let diff: Monaco.editor.IStandaloneDiffEditor | null = null;
    let original: Monaco.editor.ITextModel | null = null;
    (async () => {
      let disk: string;
      try {
        disk = await readTextFile(path);
      } catch {
        setDiffOpen(false); // disk version unreadable — nothing to diff against
        return;
      }
      const { initMonaco } = await import("../lib/monaco");
      if (disposed || !diffHostRef.current) return;
      const monaco = initMonaco();
      const modified = editorRef.current?.getModel();
      if (!modified) return;
      original = monaco.editor.createModel(disk, languageForPath(path));
      diff = monaco.editor.createDiffEditor(diffHostRef.current, {
        theme: "osai-dark",
        automaticLayout: true,
        originalEditable: false,
        readOnly: false,
        renderSideBySide: true,
        fontSize: loadSettings().terminalFontSize || 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
      });
      diff.setModel({ original, modified });
    })();
    return () => {
      disposed = true;
      // Detach BEFORE dispose so the diff editor can't tear down the SHARED
      // modified model (other panes may hold it); only our snapshot dies.
      diff?.setModel(null);
      diff?.dispose();
      original?.dispose();
    };
  }, [diffOpen, path]);

  // Drop a file onto the editor → open it (in the correct pane kind via
  // paneForFile). We don't hot-swap this pane's `path` prop — opening is the
  // deterministic, consistent route and matches FilesPane "open in pane".
  const onDropFile = useCallback((raw: string) => {
    const s = raw.trim();
    if (!s || /^https?:\/\//i.test(s)) return;
    openFileInPane(s, s.split("/").pop() ?? s);
  }, []);
  useEffect(() => {
    if (!paneKey) return;
    return registerPaneDropSink(paneKey, (paths) => {
      const first = paths.find((p) => p && p.trim() && !/^https?:\/\//i.test(p));
      if (!first) return false;
      onDropFile(first);
      return true;
    });
  }, [paneKey, onDropFile]);

  return (
    <PaneDropZone onPath={onDropFile} label="drop file to open">
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg)]">
      <div className="pane-header gap-2">
        {/* mode identity — pairs with the viewer's cyan "viewer" chip */}
        <span
          className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-[var(--color-accent)]"
          title="editable — ⌘S saves to disk"
        >
          editor
        </span>
        {dirty ? (
          <Circle size={8} className="shrink-0 fill-[var(--color-accent)] text-[var(--color-accent)]" />
        ) : savedAt ? (
          <Check size={11} className="shrink-0 text-[var(--color-success)]" />
        ) : null}
        <span className="truncate font-mono text-[11px] text-[var(--color-text-2)]" title={path}>
          {name}
        </span>
        {dirty && !conflict && <span className="font-mono text-[10px] text-[var(--color-faint)]">{chord("S")} to save</span>}
        <span className="flex-1" />
        {cursor && (
          <span
            className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-faint)]"
            title="line : column"
          >
            {cursor.ln}:{cursor.col}
          </span>
        )}
        <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wide text-[var(--color-faint)]">
          {languageForPath(path)}
        </span>
        {/\.(md|markdown)$/i.test(path) && (
          <button
            onClick={() => openViewerFileInPane(path, name)}
            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            title="Open rendered preview (viewer)"
          >
            <Eye size={12} />
          </button>
        )}
        {/* LSP status pill (TRACK B): only rendered once a server is involved */}
        {lsp && lsp.status !== "stopped" && (
          <span
            className="flex items-center gap-1 rounded-full border border-[var(--color-border)] px-1.5 py-px font-mono text-[9.5px] text-[var(--color-faint)]"
            title={`${lsp.lang} lsp · ${lsp.status}${lsp.detail ? ` — ${lsp.detail}` : ""}`}
          >
            <span
              className={
                "inline-block h-1.5 w-1.5 rounded-full " +
                (lsp.status === "ready"
                  ? "bg-[var(--color-success)]"
                  : lsp.status === "starting"
                    ? "animate-pulse bg-[var(--color-accent)]"
                    : lsp.status === "failed"
                      ? "bg-[var(--color-danger)]"
                      : "bg-[var(--color-faint)]")
              }
            />
            {lsp.status === "ready" ? "lsp" : lsp.status === "starting" ? "lsp…" : lsp.status === "none" ? "no lsp" : "lsp ✕"}
          </span>
        )}
        <button
          onClick={() => openPath(path).catch((e) => reportDiag("editor.open", e, { action: "openPath" }))}
          className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
          title="open externally"
        >
          <ExternalLink size={12} />
        </button>
      </div>

      {/* SAVE-CONFLICT banner: the file changed on disk since load (AI or human
       *  edited it). Don't silently clobber — keep mine (force write), take disk
       *  (reload), or show diff (disk vs buffer, side by side). */}
      {conflict && (
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-danger)]/10 px-3 py-1.5">
          <AlertTriangle size={12} className="shrink-0 text-[var(--color-danger)]" />
          <span className="flex-1 truncate text-[11px] text-[var(--color-text-2)]">
            file changed on disk — your buffer and the disk version differ
          </span>
          <button
            onClick={overwrite}
            className="rounded border border-[var(--color-danger)]/40 px-2 py-0.5 text-[10.5px] text-[var(--color-danger)] hover:bg-[var(--color-danger)]/15"
            title="force-save your version over the on-disk changes"
          >
            keep mine
          </button>
          <button
            onClick={reloadFromDisk}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10.5px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            title="discard your edits, load the on-disk version"
          >
            take disk
          </button>
          <button
            onClick={() => setDiffOpen((v) => !v)}
            className="rounded border border-[var(--color-border)] px-2 py-0.5 text-[10.5px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
            title="compare the on-disk version with your buffer, side by side"
          >
            {diffOpen ? "hide diff" : "show diff"}
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        <div ref={hostRef} className="h-full w-full" />
        {/* show-diff overlay: monaco diff editor over the normal editor while
            the conflict banner offers it (disk snapshot left, live buffer right) */}
        {diffOpen && <div ref={diffHostRef} className="absolute inset-0 z-10 bg-[var(--color-bg)]" />}
        {loading && (
          // skeleton "code lines" instead of a bare spinner — the wait reads as
          // the editor warming up, and Monaco dissolves in over it.
          <div className="absolute inset-0 flex flex-col gap-2.5 bg-[var(--color-bg)] p-5">
            {[68, 42, 88, 55, 75, 30, 62].map((w, i) => (
              <Skeleton key={i} className="h-3" style={{ width: `${w}%` }} />
            ))}
          </div>
        )}
        {error && (
          <div className="absolute inset-0 grid place-items-center bg-[var(--color-bg)] px-6 text-center">
            <div className="flex flex-col items-center gap-2">
              <span className="font-mono text-[12px] text-[var(--color-danger)]">{error}</span>
              <button
                onClick={() => openPath(path).catch((e) => reportDiag("editor.open", e, { action: "openPath" }))}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-text)]"
              >
                open externally instead
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
    </PaneDropZone>
  );
}
