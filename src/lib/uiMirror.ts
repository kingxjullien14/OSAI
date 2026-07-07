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
    const snap: Record<string, string> = {};
    for (const k of MIRROR_KEYS) {
      try {
        const v = localStorage.getItem(k);
        if (v !== null) snap[k] = v;
      } catch {
        /* localStorage unavailable — mirror what we can */
      }
    }
    void invoke("ui_state_save", { json: JSON.stringify(snap) }).catch(() => {});
  }, SAVE_DEBOUNCE_MS);
}

/** Restore mirrored keys that are MISSING from localStorage (never overwrite a
 *  present value). Returns true when anything was restored — the caller should
 *  then re-apply theme/accent/settings. */
export async function hydrateUiMirror(): Promise<boolean> {
  if (!isTauriRuntime()) return false;
  let raw: string | null;
  try {
    raw = await invoke<string | null>("ui_state_load");
  } catch {
    return false;
  }
  if (!raw) return false;
  let snap: Record<string, unknown>;
  try {
    snap = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return false;
  }
  let restored = false;
  for (const k of MIRROR_KEYS) {
    const v = snap[k];
    if (typeof v !== "string") continue;
    try {
      if (localStorage.getItem(k) === null) {
        localStorage.setItem(k, v);
        restored = true;
      }
    } catch {
      /* ignore */
    }
  }
  return restored;
}
