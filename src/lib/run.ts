/** Run/F5 support — detects the runnable project containing a path and yields
 *  the candidate run commands (flutter/node/rust/go/python/make). The App wires
 *  F5 to spawn a terminal pane running `commands[0]` in `root`, which streams
 *  logs exactly like VS Code's run terminal (and flutter's own `r` hot-reload
 *  works right in it). */
import { invoke } from "./tauri";
import type { ProjectWorkspace } from "./projectWorkspaces";

export interface RunCommand {
  label: string;
  cmd: string;
}

export type ProjectKind =
  | "flutter"
  | "node"
  | "rust"
  | "go"
  | "python"
  | "make"
  | "unknown";

export interface ProjectRun {
  kind: ProjectKind;
  root: string | null;
  commands: RunCommand[];
}

/** Detect the runnable project that contains `path` (walks up to a marker). */
export async function detectProject(path: string): Promise<ProjectRun> {
  return invoke<ProjectRun>("detect_project", { path });
}

/** A discovered project under `~/Repo` — name + root + kind + run commands.
 *  Same command derivation as {@link detectProject}; `commands[0]` is primary. */
export interface ProjectInfo {
  name: string;
  root: string;
  kind: ProjectKind;
  commands: RunCommand[];
  /** unix epoch seconds of the project dir's last modification */
  mtime: number;
}

/** Scan `~/Repo` (bounded depth, heavy dirs pruned) for every runnable project
 *  root. Powers the per-project ⌘K run entries. Sorted by name, capped at 200. */
export async function listProjects(): Promise<ProjectInfo[]> {
  return invoke<ProjectInfo[]>("list_projects");
}

/** A short ▶ label for the run button, e.g. "▶ flutter run". */
export function runLabel(p: ProjectRun): string {
  return p.commands.length ? `▶ ${p.commands[0].label}` : "▶ run";
}

/* ── structured workspaces (PLAN-projects-workspaces.md §8; P2 backend) ──
   These call the Rust detection backend and return the `ProjectWorkspace` tree
   (model + store live in lib/projectWorkspaces.ts). Not wired into the UI yet. */

/** Scan the given roots (each child dir = a candidate workspace) for structured
 *  workspaces. Empty roots → the backend's best-effort defaults. */
export async function scanWorkspaces(roots: string[] = []): Promise<ProjectWorkspace[]> {
  return invoke<ProjectWorkspace[]>("scan_workspaces", { roots });
}

/** Infer a single workspace's structure at `root`. */
export async function detectWorkspace(root: string): Promise<ProjectWorkspace> {
  return invoke<ProjectWorkspace>("detect_workspace", { root });
}

/** Suggested scan roots for the Settings UI to offer (existing code dirs). */
export async function suggestedScanRoots(): Promise<string[]> {
  return invoke<string[]>("suggested_scan_roots");
}

/** Preview the managed context block a workspace would write — read-only, no FS
 *  writes. Powers the consent-first preview before generating. */
export async function previewWorkspaceContext(root: string): Promise<string> {
  return invoke<string>("preview_workspace_context", { root });
}

/** Write `aios.workspace.json` + upsert the managed block into CLAUDE.md +
 *  AGENTS.md at the workspace root. Returns the files written. */
export async function generateWorkspaceContext(root: string): Promise<string[]> {
  return invoke<string[]>("generate_workspace_context", { root });
}
