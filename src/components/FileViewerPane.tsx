/** A single file rendered in its own pane — images & PDFs via the asset
 *  protocol, text/code/markdown inline. Spawned from the Files pane's
 *  "open in pane" action so any file can live as a standalone pane.
 *
 *  Markdown renders through the HOUSE renderer (chat/Markdown — same one the
 *  notes reader and files preview use), with relative links resolved against
 *  THIS document's folder via the chat file-open context. */
import { useCallback, useEffect, useMemo, useState } from "react";

import { openPath } from "@tauri-apps/plugin-opener";
import { ExternalLink, FileText, PenLine } from "lucide-react";

import { fileSrc, readFilePreview, type FilePreview } from "../lib/fs";
import { browserRevealInFinder } from "../lib/browser";
import { isApple } from "../lib/platform";
import { dirname } from "../lib/paths.ts";
import {
  openEditorFileInPane,
  openFileInPane,
  paneMenuExtras,
  registerPaneDropSink,
  spawnPane,
} from "../lib/paneBus";
import { resolvePaneFileTarget, targetLabel } from "../lib/paneRouting";
import { ChatFileOpenContext } from "./chat/context";
import { Markdown } from "./chat/Markdown";
import { OfficePreview } from "./OfficePreview";
import { PaneDropZone } from "./PaneDropZone";
import { reportDiag } from "../lib/diag";

function fmtKB(size: number): string {
  return size >= 1_000_000 ? `${(size / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
}

export function FileViewerPane({ path, paneKey }: { path: string; paneKey?: string }) {
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [loading, setLoading] = useState(true);

  // Drop a file → open it (deterministic, via paneForFile). Same rationale as
  // EditorPane: open rather than hot-swap the prop.
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

  useEffect(() => {
    let alive = true;
    setLoading(true);
    readFilePreview(path)
      .then((p) => alive && setPreview(p))
      .catch(() => alive && setPreview(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [path]);

  // ⋯-menu contributions — parity with terminal/notes/editor. Per the owner:
  // a VIEWER offers "open in editor" (and never "open in viewer") — the
  // cross-jump only, so the menu can't gaslight you about where you are.
  useEffect(() => {
    if (!paneKey) return;
    paneMenuExtras.set(paneKey, () => [
      {
        key: "fv-edit",
        label: "Open in editor",
        hint: "source",
        onSelect: () => openEditorFileInPane(path, path.split(/[\\/]/).pop() ?? path),
      },
      { key: "fv-sep0", separator: true },
      {
        key: "fv-copy",
        label: "Copy path",
        onSelect: () => void navigator.clipboard?.writeText(path).catch(() => {}),
      },
      {
        key: "fv-reveal",
        label: isApple ? "Reveal in Finder" : "Reveal in Explorer",
        onSelect: () => void browserRevealInFinder(path).catch(() => {}),
      },
      {
        key: "fv-term",
        label: "Open terminal here",
        hint: "cd to folder",
        onSelect: () => spawnPane("terminal", { cwd: dirname(path) }),
      },
      {
        key: "fv-external",
        label: "Open externally",
        onSelect: () => void openPath(path).catch((e) => reportDiag("fileviewer.open", e, { action: "openPath" })),
      },
    ]);
    return () => {
      paneMenuExtras.delete(paneKey);
    };
  }, [paneKey, path]);

  // relative `[link](./other.md)` targets in a markdown DOC resolve against
  // the doc's own folder (the chat renderer's default resolves against cwd).
  const openRelative = useMemo(
    () => (ref: string) => {
      const resolved = resolvePaneFileTarget(ref, path);
      openFileInPane(resolved, targetLabel(resolved));
    },
    [path],
  );

  return (
    <PaneDropZone onPath={onDropFile} label="drop file to open">
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-pane)]">
      <div className="pane-header justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {/* mode identity — the owner asked for an unmissable viewer/editor tell */}
          <span
            className="shrink-0 rounded-full border border-[color-mix(in_srgb,var(--osai-accent-2)_35%,transparent)] px-1.5 py-px font-mono text-[9px] uppercase tracking-wide"
            style={{ color: "var(--osai-accent-2)" }}
            title="read-only viewer — use the pen (or ⋯) to edit"
          >
            viewer
          </span>
          <span className="truncate font-mono text-[11px] text-[var(--color-text-2)]" title={path}>
            {preview?.name ?? path.split("/").pop()}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5">
          {preview && (
            <span className="font-mono text-[9.5px] uppercase tracking-wide text-[var(--color-faint)]">
              {preview.kind} · {fmtKB(preview.size)}
            </span>
          )}
          <button
            onClick={() => openEditorFileInPane(path, preview?.name ?? path.split(/[\\/]/).pop() ?? path)}
            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            title="Open in editor (source)"
          >
            <PenLine size={12} />
          </button>
          <button
            onClick={() => openPath(path).catch((e) => reportDiag("fileviewer.open", e, { action: "openPath" }))}
            className="rounded p-1 text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            title="Open externally"
          >
            <ExternalLink size={12} />
          </button>
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {loading ? (
          <div className="grid h-full place-items-center text-[12px] text-[var(--color-faint)]">loading…</div>
        ) : preview?.kind === "image" ? (
          <div className="grid h-full place-items-center p-3">
            <img src={fileSrc(path)} alt={preview.name} className="max-h-full max-w-full object-contain" />
          </div>
        ) : preview?.kind === "pdf" ? (
          <iframe src={fileSrc(path)} title={preview.name} className="h-full w-full border-0" />
        ) : preview?.kind === "office" ? (
          <OfficePreview path={path} name={preview.name} />
        ) : preview?.kind === "video" ? (
          <video
            src={fileSrc(path)}
            controls
            className="h-full w-full bg-black"
            controlsList="nodownload"
          />
        ) : preview?.kind === "text" ? (
          isMarkdown(path) ? (
            <ChatFileOpenContext.Provider value={openRelative}>
              <div className="mx-auto max-w-3xl px-5 py-4 text-[13px] leading-relaxed text-[var(--color-text-2)]">
                <Markdown text={preview.text ?? ""} />
                {preview.truncated && (
                  <div className="mt-4 border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-faint)]">
                    … truncated — open externally for the full file
                  </div>
                )}
              </div>
            </ChatFileOpenContext.Provider>
          ) : (
            <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-[var(--color-text-2)]">
              {preview.text}
              {preview.truncated && <span className="text-[var(--color-faint)]">{"\n\n… (truncated)"}</span>}
            </pre>
          )
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--color-muted)]">
            <FileText size={28} />
            <span className="text-[12px]">binary file{preview ? ` · ${(preview.size / 1024).toFixed(0)} KB` : ""}</span>
            <button
              onClick={() => openPath(path).catch((e) => reportDiag("fileviewer.open", e, { action: "openPath" }))}
              className="rounded-md border border-[var(--color-border)] px-3 py-1 text-[11px] hover:border-[var(--color-border-strong)]"
            >
              open externally
            </button>
          </div>
        )}
      </div>
    </div>
    </PaneDropZone>
  );
}

function isMarkdown(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}
