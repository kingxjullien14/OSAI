/** Wraps a pane's content and accepts cross-pane drops of an `x-osai-path`
 *  payload (e.g. a folder dragged from the Files pane). The drop overlay only
 *  appears WHILE a path-drag is in flight app-wide (via the `onOsaiDrag`
 *  signal), so it floats ABOVE intercepting children like xterm's canvas and
 *  reliably captures the drop — fixing the case where a terminal swallowed it.
 *
 *  Usage: <PaneDropZone onPath={(p) => insert(p)}>…pane content…</PaneDropZone> */
import { useEffect, useState } from "react";
import { OSAI_DIR_MIME, OSAI_PATH_MIME, currentPathDrag, onOsaiDrag } from "../lib/paneBus";

/** True when the drag carries our directory marker (a folder row from the Files
 *  pane). Lets a pane do the folder-appropriate thing (`cd`, re-root) instead of
 *  treating the path as a file. */
function isDirDrop(dt: DataTransfer): boolean {
  return !!dt.getData(OSAI_DIR_MIME);
}

/** Pull a filesystem path out of a drop — works for in-app pane drags (our
 *  custom mime), Finder/Explorer drags (`text/uri-list` file:// URIs), and
 *  plain text. Returns null if nothing path-like is present. */
function extractPath(dt: DataTransfer): string | null {
  const osai = dt.getData(OSAI_PATH_MIME);
  if (osai) return osai;
  const uriList = dt.getData("text/uri-list");
  if (uriList) {
    const first = uriList
      .split("\n")
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith("#"));
    if (first?.startsWith("file://")) {
      try {
        return decodeURIComponent(new URL(first).pathname);
      } catch {
        /* fall through */
      }
    }
    if (first) return first;
  }
  const txt = dt.getData("text/plain");
  return txt || null;
}

export function PaneDropZone({
  onPath,
  onFiles,
  onDir,
  label = "drop to insert path",
  children,
}: {
  onPath: (path: string) => void;
  /** First crack at the drop's actual File objects (e.g. a screenshot). Return
   *  true if consumed — then the path-insert fallback is skipped. */
  onFiles?: (files: FileList) => boolean;
  /** Called when a FOLDER (Files-pane folder row) is dropped. Return true to
   *  consume — then the generic path-insert is skipped. Falls through to onPath
   *  when not provided or it returns false. */
  onDir?: (dir: string) => boolean;
  label?: string;
  children: React.ReactNode;
}) {
  // a path-drag is happening somewhere in the app (arms the overlay)
  const [armed, setArmed] = useState(false);
  // the cursor is currently over THIS pane's overlay
  const [over, setOver] = useState(false);

  useEffect(() => onOsaiDrag(setArmed), []);

  return (
    <div className="relative h-full min-h-0 w-full">
      {children}
      {armed && (
        // armed (a drag is in flight somewhere) = a quiet dashed edge only;
        // the LABEL + accent appear on the pane you're actually hovering, so
        // the eye follows the cursor instead of every pane shouting at once.
        <div
          className={`absolute inset-0 z-30 grid place-items-center border-2 border-dashed transition-colors ${
            over
              ? "border-[var(--color-accent)] bg-[var(--color-accent)]/12"
              : "border-[var(--color-border-strong)]/60 bg-transparent"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!over) setOver(true);
          }}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setOver(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            // real files (a dropped screenshot) get first crack — so they
            // attach as images instead of inserting a bare path string.
            if (
              onFiles &&
              e.dataTransfer.files?.length &&
              onFiles(e.dataTransfer.files)
            ) {
              return;
            }
            const path = extractPath(e.dataTransfer);
            if (!path) return;
            // a folder drop gets the dir-specific handler first (cd / re-root).
            if (onDir && isDirDrop(e.dataTransfer) && onDir(path)) return;
            onPath(path);
          }}
          // pointer-based in-app drags (Windows: HTML5 dnd never fires in the
          // webview) — same delivery contract as the HTML5 path above.
          // onPointerMove (not just enter) so the overlay that mounts directly
          // under the cursor still lights up without crossing an edge first.
          onPointerEnter={() => {
            if (currentPathDrag()) setOver(true);
          }}
          onPointerMove={() => {
            if (!over && currentPathDrag()) setOver(true);
          }}
          onPointerLeave={() => setOver(false)}
          onPointerUp={() => {
            setOver(false);
            const drag = currentPathDrag();
            if (!drag) return;
            if (onDir && drag.isDir && onDir(drag.path)) return;
            onPath(drag.path);
          }}
        >
          {over && (
            <span className="fade-in-up rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel)]/95 px-3 py-1.5 text-[12px] text-[var(--color-text)] shadow-[var(--osai-shadow-pop)]">
              {label}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
