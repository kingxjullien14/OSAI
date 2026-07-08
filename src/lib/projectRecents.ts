/** Project ACCESS recency — the ordering for the lock screen's "continue"
 *  shelf (L4, living-cockpit).
 *
 *  File mtime lies about what the owner actually works on: any tool or agent
 *  writing into a folder bumps it, so the shelf kept surfacing subfolders
 *  nobody ever opened. This records real OPENS instead: a project launched
 *  from anywhere, or any pane spawned with a cwd (terminal-here, chat-here,
 *  files-here). localStorage map of normalized path → last-access ms. */

const KEY = "osai.projects.access.v1";
const MAX_ENTRIES = 40;

/** Normalize for matching: forward slashes, no trailing slash, lowercase
 *  (Windows paths are case-insensitive; for a recency hint that trade is
 *  fine everywhere). */
function norm(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function load(): Record<string, number> {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) || "{}") as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Record an access to a path (a project root OR any directory inside one). */
export function touchProjectAccess(pathOrRoot: string): void {
  if (!pathOrRoot || typeof pathOrRoot !== "string") return;
  const map = load();
  map[norm(pathOrRoot)] = Date.now();
  // cap the map so it never grows unbounded — keep the freshest entries.
  const kept = Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* quota / unavailable — recency just won't persist */
  }
}

/** The full access map (normalized path → ms). Read once per sort. */
export function projectAccessTimes(): Record<string, number> {
  return load();
}

/** Last access for a project ROOT: the newest touch that was the root itself
 *  or any recorded path inside it (a chat opened in root/src counts). */
export function lastAccessFor(root: string, times: Record<string, number> = projectAccessTimes()): number {
  const r = norm(root);
  let best = 0;
  for (const [p, t] of Object.entries(times)) {
    if ((p === r || p.startsWith(`${r}/`)) && t > best) best = t;
  }
  return best;
}
