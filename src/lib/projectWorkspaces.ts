/** Project Workspaces — the structured, agent-aware successor to the flat
 *  project model (see misc/PLAN-projects-workspaces.md). A ProjectWorkspace is a
 *  tree:
 *
 *    ProjectWorkspace (C:\FHE-Work\WRMS)
 *    └─ Environments?  (Beta, Staging …)      ← optional grouping layer
 *       └─ Components  (admin-web, api, …)     ← the runnable units
 *          └─ { role, path, stack, runCommands, port, status, supersedes }
 *
 *  Named `ProjectWorkspace` (not `Workspace`) because `lib/workspaces.ts` already
 *  owns `Workspace` for saved *pane layouts* — a different domain. "Workspace" is
 *  still the conceptual/UI word.
 *
 *  P1 (this file): the data model + a versioned localStorage store + a one-time
 *  migration from the old `aios.projects` store + a back-compat adapter that
 *  flattens to today's `ProjectInfo` so existing consumers keep working while the
 *  detection backend / config UI / context-file phases land.
 *
 *  Design: a PURE core (migration / adapter / inference helpers — no globals, so
 *  they're unit-testable) + a thin impure shell (localStorage + event emitter).
 *  Nothing here touches `localStorage`/`window` at module scope. */
import type { ProjectInfo, ProjectKind, RunCommand } from "./run";
import type { ProjectsStore } from "./projects";

/* ── model (mirrors the Rust structs to come; see PLAN §3) ───────────── */

export type ComponentRole =
  | "frontend"
  | "backend"
  | "fullstack"
  | "mobile"
  | "desktop"
  | "infra"
  | "docs"
  | "db"
  | "other";

export type ComponentStatus = "current" | "legacy" | "wip" | "deprecated";

export interface ProjectComponent {
  /** stable id, e.g. "<wsid>/beta/admin-web". */
  id: string;
  /** folder name, verbatim ("admin-web-next"). */
  name: string;
  /** path relative to the workspace root ("Beta/admin-web-next"); "." = root. */
  path: string;
  role: ComponentRole;
  /** detected stack tag: "next" | "node" | "nitro" | "flutter" | "rust" | … ("" = unknown). */
  stack: string;
  /** detected run commands; the first is primary. */
  runCommands: RunCommand[];
  /** optional dev port — for "open in browser" + agent hints. */
  port?: number;
  /** lifecycle; absent → treated as "current". */
  status?: ComponentStatus;
  /** id of the component this one replaces (admin-web-next → admin-web). */
  supersedes?: string;
  /** freeform notes that flow into the generated context block. */
  notes?: string;
}

export interface ProjectEnvironment {
  id: string;
  /** verbatim folder name ("Beta"). */
  name: string;
  /** path relative to the workspace root ("Beta"). */
  path: string;
  components: ProjectComponent[];
}

export type ProjectStructure =
  | { kind: "fullstack"; component: ProjectComponent }
  | { kind: "split"; components: ProjectComponent[] }
  | { kind: "environments"; defaultEnv?: string; environments: ProjectEnvironment[] }
  /** discovered but not yet shaped — the user picks/auto-detects a shape. */
  | { kind: "unconfigured" };

export interface ProjectWorkspace {
  /** stable id derived from the root. */
  id: string;
  /** display name ("WRMS"), overridable. */
  name: string;
  /** absolute root path ("C:\\FHE-Work\\WRMS"). */
  root: string;
  structure: ProjectStructure;
  tags?: string[];
  hidden?: boolean;
  source: "scanned" | "custom";
  /** unix epoch seconds of the root's last modification. */
  mtime: number;
  /** "aios.workspace.json" if one exists on disk (set by the backend later). */
  manifestPath?: string;
  schemaVersion: 1;
}

/* ── store (central registry; PLAN §7) ───────────────────────────────── */

/** Per-workspace UI prefs, keyed by root — overlaid on scanned workspaces. */
export interface ProjectWorkspacePrefs {
  /** display-name override. */
  name?: string;
  /** primary run-command override (carried over from the old store). */
  cmd?: string;
  /** hidden from the home/launcher but still listed (greyed) in Settings. */
  hidden?: boolean;
  /** REMOVED from everywhere (home + Settings list) — a true "remove" for a
   *  discovered workspace you don't want (e.g. a mis-scanned system folder).
   *  Recoverable via "restore removed". */
  removed?: boolean;
  pinned?: boolean;
  tags?: string[];
  order?: number;
}

export interface ProjectWorkspacesStore {
  schemaVersion: 2;
  /** roots the backend scans for workspaces (e.g. "C:\\FHE-Work"). */
  scanRoots: string[];
  /** user-added workspaces the scanner didn't find. */
  custom: ProjectWorkspace[];
  /** root → prefs overlay for scanned workspaces. */
  prefs: Record<string, ProjectWorkspacePrefs>;
}

/* ── pure helpers (no globals — unit-tested) ─────────────────────────── */

/** Trim trailing slashes/backslashes; leave the rest verbatim. */
export function normRoot(root: string): string {
  return root.trim().replace(/[\\/]+$/, "");
}

/** Last path segment of a (possibly Windows) path. */
export function basename(path: string): string {
  const segs = normRoot(path).split(/[\\/]/);
  return segs[segs.length - 1] || path;
}

/** Join a workspace root with a relative component path, honoring the root's
 *  separator style (so Windows roots stay backslash-joined). */
export function joinPath(root: string, rel: string): string {
  if (!rel || rel === ".") return normRoot(root);
  const sep = root.includes("\\") ? "\\" : "/";
  const r = rel.replace(/[\\/]+/g, sep).replace(new RegExp(`^\\${sep}+`), "");
  return normRoot(root) + sep + r;
}

/** Stable, deterministic id from a root (djb2 → base36). No Date/random so it's
 *  resume- and test-safe. */
export function hashRoot(root: string): string {
  const s = normRoot(root).toLowerCase();
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return "ws_" + (h >>> 0).toString(36);
}

const ROLE_BACKEND = /(^|[-_])(back(end)?|api|server|svc|service|nitro|gateway|worker)([-_]|$)/i;
const ROLE_FRONTEND =
  /(^|[-_])(front(end)?|web|client|ui|admin|portal|app|site|dashboard|console)([-_]|$)/i;
const ROLE_MOBILE = /(^|[-_])(mobile|ios|android|flutter|expo|native)([-_]|$)/i;
const ROLE_INFRA = /(^|[-_])(infra|deploy|terraform|docker|ops|k8s|helm)([-_]|$)/i;
const ROLE_DOCS = /(^|[-_])(docs?|documentation)([-_]|$)/i;

/** Best-effort role from a folder name (backend signals win over frontend so
 *  "web-api" reads as backend). Advisory — always user-overridable. */
export function inferRole(name: string): ComponentRole {
  if (ROLE_BACKEND.test(name)) return "backend";
  if (ROLE_FRONTEND.test(name)) return "frontend";
  if (ROLE_MOBILE.test(name)) return "mobile";
  if (ROLE_INFRA.test(name)) return "infra";
  if (ROLE_DOCS.test(name)) return "docs";
  return "other";
}

/** A `<base>-next` / `<base>-nitro` / `<base>-v2` / `<base>2` suffix → the base
 *  name it supersedes (else null). Drives the migration/detection wip+supersedes
 *  heuristic (WRMS: admin-web-next → admin-web). Pure. */
export function supersedesBase(name: string): string | null {
  const m = name.match(/^(.*?)[-_]?(next|nitro|v2|2|new)$/i);
  if (!m || !m[1]) return null;
  const base = m[1].replace(/[-_]$/, "");
  return base && base.toLowerCase() !== name.toLowerCase() ? base : null;
}

/** Map a detected stack tag to the legacy `ProjectKind` (for the adapter). */
export function stackToKind(stack: string): ProjectKind {
  switch (stack) {
    case "flutter":
      return "flutter";
    case "rust":
      return "rust";
    case "go":
      return "go";
    case "python":
      return "python";
    case "make":
      return "make";
    case "next":
    case "nitro":
    case "nuxt":
    case "vite":
    case "angular":
    case "node":
      return "node";
    default:
      return "unknown";
  }
}

/** Inverse-ish: a legacy `ProjectKind` as a stack tag ("" for unknown). */
export function kindToStack(kind: ProjectKind): string {
  return kind === "unknown" ? "" : kind;
}

/** The canonical "primary" component of a workspace (for the flat adapter +
 *  default open target): fullstack → its component; split → first; environments
 *  → the default env's first (else first env's first). */
export function primaryComponent(ws: ProjectWorkspace): ProjectComponent | null {
  const st = ws.structure;
  switch (st.kind) {
    case "fullstack":
      return st.component;
    case "split":
      return st.components[0] ?? null;
    case "environments": {
      const env = st.environments.find((e) => e.id === st.defaultEnv) ?? st.environments[0];
      return env?.components[0] ?? null;
    }
    default:
      return null;
  }
}

/** Every runnable component across a workspace, for per-component run targets in
 *  the palette later. */
export function allComponents(ws: ProjectWorkspace): ProjectComponent[] {
  const st = ws.structure;
  switch (st.kind) {
    case "fullstack":
      return [st.component];
    case "split":
      return st.components;
    case "environments":
      return st.environments.flatMap((e) => e.components);
    default:
      return [];
  }
}

/** A short shape label for UI ("fullstack" | "split · N" | "environments · N"). */
export function projectShapeLabel(ws: ProjectWorkspace): string {
  const st = ws.structure;
  switch (st.kind) {
    case "fullstack":
      return "fullstack";
    case "split":
      return `split · ${st.components.length}`;
    case "environments":
      return `environments · ${st.environments.length}`;
    default:
      return "unconfigured";
  }
}

/* ── back-compat adapter (ProjectWorkspace → today's ProjectInfo) ─────── */

/** Flatten a workspace to the legacy `ProjectInfo` (root-level entry) so existing
 *  consumers (palette, F5, homescreen) keep working during the migration. */
export function workspaceToProjectInfo(ws: ProjectWorkspace): ProjectInfo {
  const primary = primaryComponent(ws);
  return {
    name: ws.name,
    root: ws.root,
    kind: primary ? stackToKind(primary.stack) : "unknown",
    commands: primary?.runCommands ?? [],
    mtime: ws.mtime,
  };
}

export function flattenProjectWorkspaces(list: ProjectWorkspace[]): ProjectInfo[] {
  return list.map(workspaceToProjectInfo);
}

/* ── pure migration (old projects store → v2 workspaces store) ────────── */

/** Turn a legacy custom `ProjectInfo` into a fullstack ProjectWorkspace. */
export function projectInfoToWorkspace(
  p: ProjectInfo,
  source: "custom" | "scanned" = "custom",
): ProjectWorkspace {
  const root = normRoot(p.root);
  const id = hashRoot(root);
  const component: ProjectComponent = {
    id: `${id}/.`,
    name: basename(root) || p.name,
    path: ".",
    role: inferRole(p.name || basename(root)),
    stack: kindToStack(p.kind),
    runCommands: p.commands ?? [],
    status: "current",
  };
  return {
    id,
    name: p.name || basename(root),
    root,
    structure: { kind: "fullstack", component },
    source,
    mtime: p.mtime ?? 0,
    schemaVersion: 1,
  };
}

/** Pure migration: fold the old `aios.projects` store into a v2 workspaces store.
 *  - custom projects → fullstack custom workspaces
 *  - hidden roots → prefs[root].hidden
 *  - overrides{name,cmd} → prefs[root].{name,cmd}
 *  Total + safe on partial/garbage input. */
export function migrateProjectsStore(
  old: Partial<ProjectsStore> | null | undefined,
): ProjectWorkspacesStore {
  const prefs: Record<string, ProjectWorkspacePrefs> = {};
  const touch = (root: string): ProjectWorkspacePrefs => (prefs[normRoot(root)] ??= {});
  for (const root of Array.isArray(old?.hidden) ? old!.hidden : []) {
    touch(root).hidden = true;
  }
  const overrides = old?.overrides && typeof old.overrides === "object" ? old.overrides : {};
  for (const [root, ov] of Object.entries(overrides)) {
    const p = touch(root);
    if (ov?.name?.trim()) p.name = ov.name.trim();
    if (ov?.cmd?.trim()) p.cmd = ov.cmd.trim();
  }
  const custom = (Array.isArray(old?.custom) ? old!.custom : []).map((p) =>
    projectInfoToWorkspace(p, "custom"),
  );
  return { schemaVersion: 2, scanRoots: [], custom, prefs };
}

/** Merge scanned workspaces with the store: drop hidden, apply name/tags
 *  overrides, append custom (deduped by root; scanned wins). Mirrors the old
 *  `mergeProjects`. Pure. */
export function mergeProjectWorkspaces(
  scanned: ProjectWorkspace[],
  store: ProjectWorkspacesStore,
): ProjectWorkspace[] {
  const out: ProjectWorkspace[] = [];
  const seen = new Set<string>();
  for (const ws of scanned) {
    const root = normRoot(ws.root);
    const pref = store.prefs[root];
    if (pref?.hidden || pref?.removed) {
      seen.add(root);
      continue;
    }
    let next = ws;
    if (pref?.name?.trim()) next = { ...next, name: pref.name.trim() };
    if (pref?.tags) next = { ...next, tags: pref.tags };
    out.push(next);
    seen.add(root);
  }
  for (const c of store.custom) {
    const root = normRoot(c.root);
    if (!seen.has(root)) {
      out.push(c);
      seen.add(root);
    }
  }
  return out;
}

/* ── impure shell (localStorage + event emitter) ─────────────────────── */

const KEY = "aios.workspaces.projects";
const OLD_KEY = "aios.projects";
const EVENT = "aios:project-workspaces";

const emptyStore = (): ProjectWorkspacesStore => ({
  schemaVersion: 2,
  scanRoots: [],
  custom: [],
  prefs: {},
});

function normalizeStore(p: Partial<ProjectWorkspacesStore> | null): ProjectWorkspacesStore {
  return {
    schemaVersion: 2,
    scanRoots: Array.isArray(p?.scanRoots) ? p!.scanRoots.map(normRoot).filter(Boolean) : [],
    custom: Array.isArray(p?.custom) ? p!.custom : [],
    prefs: p?.prefs && typeof p.prefs === "object" ? p!.prefs : {},
  };
}

/** Load the v2 store. On first run, lazily migrate the old `aios.projects` store
 *  (and persist the result so migration happens exactly once). */
export function loadProjectWorkspacesStore(): ProjectWorkspacesStore {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalizeStore(JSON.parse(raw) as Partial<ProjectWorkspacesStore>);
    const oldRaw = localStorage.getItem(OLD_KEY);
    if (oldRaw) {
      const migrated = migrateProjectsStore(JSON.parse(oldRaw) as ProjectsStore);
      persist(migrated);
      return migrated;
    }
  } catch {
    /* fall through to empty */
  }
  return emptyStore();
}

function persist(s: ProjectWorkspacesStore): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* quota / disabled — non-fatal */
  }
  try {
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* no window (tests) — non-fatal */
  }
}

/** Subscribe to store changes (returns an unsubscribe). */
export function subscribeProjectWorkspaces(cb: () => void): () => void {
  const h = () => cb();
  window.addEventListener(EVENT, h);
  window.addEventListener("storage", h);
  return () => {
    window.removeEventListener(EVENT, h);
    window.removeEventListener("storage", h);
  };
}

/* scan roots */
export function getScanRoots(): string[] {
  return loadProjectWorkspacesStore().scanRoots;
}
export function setScanRoots(roots: string[]): void {
  const s = loadProjectWorkspacesStore();
  const next = Array.from(new Set(roots.map(normRoot).filter(Boolean)));
  persist({ ...s, scanRoots: next });
}
export function addScanRoot(root: string): void {
  const s = loadProjectWorkspacesStore();
  const r = normRoot(root);
  if (!r || s.scanRoots.includes(r)) return;
  persist({ ...s, scanRoots: [...s.scanRoots, r] });
}
export function removeScanRoot(root: string): void {
  const s = loadProjectWorkspacesStore();
  const r = normRoot(root);
  persist({ ...s, scanRoots: s.scanRoots.filter((x) => x !== r) });
}

/* per-workspace prefs */
export function setWorkspacePref(root: string, patch: Partial<ProjectWorkspacePrefs>): void {
  const s = loadProjectWorkspacesStore();
  const r = normRoot(root);
  const next: ProjectWorkspacePrefs = { ...(s.prefs[r] ?? {}), ...patch };
  // prune empties so a cleared override disappears
  if (!next.name?.trim()) delete next.name;
  if (!next.cmd?.trim()) delete next.cmd;
  if (!next.hidden) delete next.hidden;
  if (!next.removed) delete next.removed;
  if (!next.pinned) delete next.pinned;
  if (next.tags && next.tags.length === 0) delete next.tags;
  const prefs = { ...s.prefs };
  if (Object.keys(next).length === 0) delete prefs[r];
  else prefs[r] = next;
  persist({ ...s, prefs });
}
export function setWorkspaceHidden(root: string, hidden: boolean): void {
  setWorkspacePref(root, { hidden });
}
/** True-remove a DISCOVERED workspace: gone from the home AND the Settings list
 *  (recoverable via restoreAllRemoved). For a mis-scanned folder you never want. */
export function setWorkspaceRemoved(root: string, removed: boolean): void {
  setWorkspacePref(root, { removed });
}
/** Clear the `removed` flag from every workspace (the "restore removed" action). */
export function restoreAllRemoved(): void {
  const s = loadProjectWorkspacesStore();
  const prefs: Record<string, ProjectWorkspacePrefs> = {};
  for (const [r, p] of Object.entries(s.prefs)) {
    const { removed: _drop, ...rest } = p;
    if (Object.keys(rest).length) prefs[r] = rest;
  }
  persist({ ...s, prefs });
}
export function setWorkspaceName(root: string, name: string): void {
  setWorkspacePref(root, { name });
}

/* custom workspaces */
export function addCustomWorkspace(ws: ProjectWorkspace): void {
  const s = loadProjectWorkspacesStore();
  const root = normRoot(ws.root);
  const custom = s.custom.filter((x) => normRoot(x.root) !== root);
  custom.push({ ...ws, root, source: "custom" });
  const prefs = { ...s.prefs };
  if (prefs[root]?.hidden) {
    const { hidden: _drop, ...rest } = prefs[root];
    if (Object.keys(rest).length) prefs[root] = rest;
    else delete prefs[root];
  }
  persist({ ...s, custom, prefs });
}
export function removeCustomWorkspace(root: string): void {
  const s = loadProjectWorkspacesStore();
  const r = normRoot(root);
  const prefs = { ...s.prefs };
  delete prefs[r];
  persist({ ...s, custom: s.custom.filter((x) => normRoot(x.root) !== r), prefs });
}
