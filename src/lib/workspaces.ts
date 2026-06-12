/**
 * Workspaces — named pane layouts. A workspace snapshots the open panes in the
 * SAME persistable shape the boot layout uses (key + label + kind, one-shot
 * fields stripped) plus the grid track fractions for that pane count, so
 * restoring one rebuilds the exact grid: terminals reattach their sessions via
 * the preserved pane keys, browsers reopen on their last url (browser-mem),
 * chats come back fresh in their cwd.
 *
 * Storage is localStorage (the layout convention — see aios.layout /
 * aios.grid.tracks). Palette commands are the UI: "save workspace…", one
 * "workspace: <name>" per saved entry, and a danger-marked delete each.
 */
import type { PaneContent } from "./apps.ts";

export interface WorkspacePane {
  key: string;
  label: string;
  kind: PaneContent;
}

export interface Workspace {
  name: string;
  /** unix ms of the last save (upserts refresh it). */
  savedAt: number;
  panes: WorkspacePane[];
  /** fr-track fractions for the grid this pane count produces; null = default. */
  tracks: { cols: number[]; rows: number[] } | null;
}

const KEY = "aios.workspaces.v1";

type Listener = () => void;
const listeners = new Set<Listener>();
/** Notifies on every save/delete so the palette registry stays fresh. */
export function subscribeWorkspaces(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of [...listeners]) fn();
}

function isTrackArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((n) => typeof n === "number" && n > 0);
}

/** All saved workspaces, newest save first. Defensive parse — a corrupt entry
 *  drops silently rather than blanking the list. */
export function listWorkspaces(): Workspace[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    const out: Workspace[] = [];
    for (const w of arr) {
      if (!w || typeof w !== "object") continue;
      const { name, savedAt, panes, tracks } = w as Workspace;
      if (typeof name !== "string" || !name.trim() || !Array.isArray(panes)) continue;
      const cleanPanes = panes.filter(
        (p): p is WorkspacePane =>
          !!p &&
          typeof p === "object" &&
          typeof (p as WorkspacePane).key === "string" &&
          typeof (p as WorkspacePane).label === "string" &&
          !!(p as WorkspacePane).kind &&
          typeof (p as WorkspacePane).kind.type === "string",
      );
      if (cleanPanes.length === 0) continue;
      const cleanTracks =
        tracks && isTrackArray(tracks.cols) && isTrackArray(tracks.rows)
          ? { cols: tracks.cols, rows: tracks.rows }
          : null;
      out.push({
        name: name.trim(),
        savedAt: typeof savedAt === "number" ? savedAt : 0,
        panes: cleanPanes,
        tracks: cleanTracks,
      });
    }
    return out.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function persist(list: Workspace[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* quota / unavailable — skip */
  }
  emit();
}

/** Upsert by name (case-insensitive) — saving an existing name overwrites it. */
export function saveWorkspace(ws: Workspace): void {
  const name = ws.name.trim();
  if (!name || ws.panes.length === 0) return;
  const rest = listWorkspaces().filter((w) => w.name.toLowerCase() !== name.toLowerCase());
  persist([{ ...ws, name }, ...rest]);
}

export function deleteWorkspace(name: string): void {
  const rest = listWorkspaces().filter((w) => w.name.toLowerCase() !== name.toLowerCase());
  persist(rest);
}

export function getWorkspace(name: string): Workspace | null {
  return listWorkspaces().find((w) => w.name.toLowerCase() === name.trim().toLowerCase()) ?? null;
}
