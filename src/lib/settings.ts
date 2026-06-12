/** Typed, localStorage-backed settings store for the AIOS cockpit.
 *  Framework-light: plain load/save/get helpers + a tiny subscribe/notify
 *  emitter so panes can react to changes without pulling in a state lib.
 *  Persisted as JSON under a single key. */

const STORAGE_KEY = "aios.settings";

export type PaneType = "terminal" | "files" | "browser";
export type SidebarMode = "full" | "icons";
export type TopBarMode = "full" | "compact" | "hidden";
export type NotificationNativeMode = "off" | "important" | "all";

export interface AppSettings {
  // general
  userName: string;
  reopenLastLayout: boolean;
  confirmCloseOraclePane: boolean;
  defaultPaneType: PaneType;

  // appearance
  accentIntensity: number; // 0..100
  terminalFontSize: number; // 10..18
  splashOnLaunch: boolean;
  reduceMotion: boolean;
  // composer "flash" level — how much ambient motion/wow the prompt box has.
  //   "calm" → minimal (current baseline, respects reduce-motion)
  //   "lush" → + rotating conic-gradient rim + idle breathing glow
  //   "max"  → + aurora mesh-gradient behind the box
  // Drives `data-flash` on <html>; gated entirely in App.css (zero JS cost).
  flashLevel: FlashLevel;

  // sidebar
  sidebarMode: SidebarMode;
  topBarMode: TopBarMode;

  // notifications
  notificationNativeMode: NotificationNativeMode;
  notificationQuietMode: boolean;

  // oracles
  defaultSocketName: string;
  autoRefreshSeconds: number;
  showNonAiosSessions: boolean;

  // voice — local whisper.cpp transcription endpoint (dictation POSTs here).
  whisperUrl: string;

  // memory
  graphPhysicsStrength: number; // 0..100

  // chat provider (model-agnostic). Default "codex-cli" keeps new chats aligned
  // with the WA oracle. chatModel is the last picked model id (null = provider
  // default). NOTE: the base should follow the user's chosen CLI — see the
  // provider-base sweep in PLAN-superapp-uiux.md §13 (depends on detect_providers).
  chatProvider: string;
  chatModel: string | null;

  // where "send to AI" actions route (notes pane "send", future quick-sends):
  //   "codex-code"  → a terminal pane running `codex`
  //   "claude-code" → a terminal pane running `claude`
  //   "terminal"    → a plain shell pane (paste + run)
  //   "chat"        → the in-app chat pane (uses chatProvider/chatModel)
  defaultAi: DefaultAi;

  // onboarding (first-run flow). onboardingComplete gates the flow; only a
  // genuinely empty localStorage triggers it (veteran installs are back-filled
  // true in loadSettings). See PLAN-superapp-uiux.md §5.
  onboardingComplete: boolean;
  onboardedAt: number | null;
}

/** Routing target for "send to AI" actions. */
export type DefaultAi = "codex-code" | "claude-code" | "terminal" | "chat";

/** Composer flash intensity. */
export type FlashLevel = "calm" | "lush" | "max";

/** Reflect the flash level as `data-flash` on <html> so App.css can gate the
 *  ambient composer effects. Mirrors how theme/accent drive `data-theme`. */
export function applyFlashLevel(level: FlashLevel = loadSettings().flashLevel): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.flash = level;
}

export const DEFAULT_SETTINGS: AppSettings = {
  // empty by default → greeting/account fall back to a neutral label, never a
  // stranger's name. Onboarding (PLAN-superapp-uiux.md §5) sets the real name.
  userName: "",
  reopenLastLayout: true,
  confirmCloseOraclePane: true,
  defaultPaneType: "terminal",

  accentIntensity: 70,
  terminalFontSize: 13,
  splashOnLaunch: true,
  reduceMotion: false,
  // calm for a calm app; users can opt up to "lush"/"max" in Settings.
  flashLevel: "calm",
  sidebarMode: "full",
  topBarMode: "hidden",
  notificationNativeMode: "important",
  notificationQuietMode: false,

  defaultSocketName: "adletic",
  whisperUrl: "http://localhost:9000/inference",
  autoRefreshSeconds: 15,
  showNonAiosSessions: false,

  graphPhysicsStrength: 50,

  chatProvider: "codex-cli",
  chatModel: null,

  defaultAi: "codex-code",

  onboardingComplete: false,
  onboardedAt: null,
};

/** Read-only display value — the vault is auto-resolved from your home dir. */
export const MEMORY_VAULT_PATH =
  "~/.claude/projects/<your-home>/memory (auto-resolved)";

type Listener = (s: AppSettings) => void;
const listeners = new Set<Listener>();

let cache: AppSettings | null = null;

/** Load the full settings object, merged over defaults (forward-compatible). */
export function loadSettings(): AppSettings {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppSettings>;
      // Veteran back-fill: a persisted blob that predates onboarding has no
      // `onboardingComplete` — treat those existing installs as already
      // onboarded so only a genuinely empty localStorage triggers the flow.
      if (parsed.onboardingComplete === undefined) {
        parsed.onboardingComplete = true;
      }
      // (removed: a legacy migration here force-downgraded claude users to codex
      //  on every load, overwriting their chosen engine. The base should follow
      //  the user's CLI — see PLAN-superapp-uiux.md §13.)
      // Old installs defaulted to a branded visible titlebar. The shell now
      // treats hidden chrome as the product default; existing localStorage should
      // not keep users stuck on loud topbar modes after reinstall.
      if (parsed.topBarMode === "full" || parsed.topBarMode === "compact") {
        parsed.topBarMode = "hidden";
      }
      // One-time calm migration: installs that saved under the old loud
      // `lush` DEFAULT come down to calm; re-choosing lush afterwards sticks
      // (the marker records that the migration already ran).
      if (parsed.flashLevel === "lush" && !(parsed as Record<string, unknown>).flashMigrated) {
        parsed.flashLevel = "calm";
      }
      (parsed as Record<string, unknown>).flashMigrated = true;
      cache = { ...DEFAULT_SETTINGS, ...parsed };
    } else {
      cache = { ...DEFAULT_SETTINGS };
    }
  } catch {
    cache = { ...DEFAULT_SETTINGS };
  }
  return cache;
}

/** Merge a partial update, persist, and notify subscribers. */
export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...partial };
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota / unavailable — keep in-memory cache */
  }
  listeners.forEach((fn) => fn(next));
  return next;
}

/** Read a single setting by key. */
export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadSettings()[key];
}

/** The user's display name, or a calm fallback. The SINGLE source for the
 *  homescreen greeting and the account row — replaces the old hardcoded
 *  "firaz"/"faeez" literals. Set during onboarding (§5). */
export function displayName(fallback = "you"): string {
  return loadSettings().userName.trim() || fallback;
}

/** First-initial monogram for the avatar fallback (no name → neutral dot). */
export function monogram(): string {
  const n = loadSettings().userName.trim();
  return n ? n[0]!.toUpperCase() : "·";
}

/** Subscribe to changes; returns an unsubscribe fn. */
export function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
