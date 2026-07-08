/** Disk mirror for the localStorage-backed UI prefs.
 *
 *  Everything appearance-shaped (settings blob, theme, accent, glow, density)
 *  persists in webview localStorage — which is NOT durable: WebView2 can drop
 *  it on profile resets/updates, and the dev server (localhost:5173) and the
 *  installed app (tauri.localhost) are different origins with SEPARATE
 *  localStorage, so a glow picked in one silently "doesn't persist" in the
 *  other. This module write-through-mirrors those keys to
 *  `~/.aios/state/ui-state.json` (files.rs ui_state_save) and re-hydrates any
 *  key that's missing at boot — restore-only, so a live localStorage always
 *  wins over the mirror.
 */
import { invoke, isTauriRuntime } from "./tauri";

/** The keys worth surviving a profile reset. Deliberately NOT chat history /
 *  layout (those are big and have their own stores) — just the prefs a user
 *  notices vanishing. */
const MIRROR_KEYS = [
  "aios.settings",
  "aios.theme",
  "aios.accent",
  "aios.accent2",
  "aios.accent.recents",
  "aios.density",
  // The living-cockpit companion: its soul (bond/needs/history) and name. Same
  // durability story as the prefs — the webview's localStorage isn't durable, so
  // an installed-app restart could otherwise re-adopt a fresh hatchling and drop
  // a hard-won bond. The soul is reconciled by bond at boot (see hydrateUiMirror
  // → reconcileSoulFromMirror), not merely restore-if-missing, because a pane
  // mints a fresh soul during render before this mirror can hydrate.
  "aios.pet.soul.v1",
  "aios.pet.name.v1",
] as const;

const SAVE_DEBOUNCE_MS = 800;

let saveTimer: number | null = null;

/** Debounced dump of every mirrored key to disk. Call after any pref write —
 *  cheap to over-call. No-op outside the Tauri runtime (tests / web). */
export function scheduleUiMirrorSave(): void {
  if (!isTauriRuntime() || typeof window === "undefined") return;
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void flushUiMirror();
  }, SAVE_DEBOUNCE_MS);
}

/** MERGE the mirrored keys onto whatever's already on disk, then write. Live
 *  localStorage values win; a key that's momentarily ABSENT from this origin's
 *  localStorage (a WebView2 wipe, or a pref still at its default in this build)
 *  falls back to the on-disk value instead of being pruned. The old behavior
 *  overwrote the whole file with only currently-present keys, so any such key
 *  (famously the glow, aios.accent2) silently vanished from the mirror and
 *  hydrate's restore-only pass could never bring it back. */
async function flushUiMirror(): Promise<void> {
  let existing: Record<string, unknown> = {};
  try {
    const raw = await invoke<string | null>("ui_state_load");
    if (raw) existing = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    /* no prior mirror / unreadable — start from an empty base */
  }
  const snap: Record<string, string> = {};
  for (const k of MIRROR_KEYS) {
    let v: string | null = null;
    try {
      v = localStorage.getItem(k);
    } catch {
      /* localStorage unavailable — fall back to the on-disk value below */
    }
    if (v === null && typeof existing[k] === "string") v = existing[k] as string;
    if (v !== null) snap[k] = v;
  }
  try {
    await invoke("ui_state_save", { json: JSON.stringify(snap) });
  } catch {
    /* disk unavailable — the in-memory + localStorage copies still hold */
  }
}

/** Restore mirrored keys that are MISSING from localStorage (never overwrite a
 *  present value), and return the parsed on-disk snapshot so the caller can do
 *  richer reconciliation than restore-if-missing (e.g. the pet soul, which a
 *  pane mints fresh during render before this runs — see reconcileSoulFromMirror).
 *  Returns null when there's no usable mirror; otherwise the caller should
 *  re-apply theme/accent/settings and reconcile the soul. */
export async function hydrateUiMirror(): Promise<Record<string, string> | null> {
  if (!isTauriRuntime()) return null;
  let raw: string | null;
  try {
    raw = await invoke<string | null>("ui_state_load");
  } catch {
    return null;
  }
  if (!raw) return null;
  let snap: Record<string, unknown>;
  try {
    snap = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  const out: Record<string, string> = {};
  for (const k of MIRROR_KEYS) {
    const v = snap[k];
    if (typeof v !== "string") continue;
    out[k] = v;
    try {
      if (localStorage.getItem(k) === null) localStorage.setItem(k, v);
    } catch {
      /* ignore */
    }
  }
  return out;
}
