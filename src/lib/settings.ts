/** Typed, localStorage-backed settings store for the AIOS cockpit.
 *  Framework-light: plain load/save/get helpers + a tiny subscribe/notify
 *  emitter so panes can react to changes without pulling in a state lib.
 *  Persisted as JSON under a single key. */

import { scheduleUiMirrorSave } from "./uiMirror";

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
  // Multiplexer socket name for AIOS's own persistent terminal sessions
  // (tmux/psmux `-L <socket>`). A private namespace for the app's `aios-term-*`
  // sessions; change it to isolate from other tmux servers. Default "aios".
  terminalSocket: string;

  // appearance
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
  autoRefreshSeconds: number;
  showNonAiosSessions: boolean;
  // Default identity for the one-tap "spawn an oracle" shortcut (`aios-<id>`
  // session). Empty → the roster slugs the user's name, else "agent".
  primaryOracleId: string;

  // voice — local whisper.cpp transcription endpoint (dictation POSTs here).
  whisperUrl: string;
  // voice — which backend transcribes a dictation clip:
  //   "auto"   → OpenAI when a key is configured (BYOK keychain), else local
  //   "openai" → always the OpenAI API (errors without a key)
  //   "local"  → always the whisper.cpp server at whisperUrl
  // The CLI engines (claude / codex OAuth) have no speech-to-text API, so
  // "follow the chat provider" isn't possible — this is the honest knob.
  transcribeVia: TranscribeVia;

  // soundscape — whisper-quiet synthesized cues when a run finishes/fails.
  // OFF by default: an opt-in nicety, never a notification channel.
  soundscape: boolean;

  // funFx — the W5-5 personality layer: click sparks, pet confetti on a long
  // clean run, the liveness ripple. ON by default (it's the signature delight);
  // reduce-motion still overrides it. One switch for the whole playful tier.
  funFx: boolean;

  // petRoam — the glass-spirit desk creature roams the workspace floor
  // (living-cockpit P2). ON by default; only gates the roaming overlay —
  // the pet's room pane stays reachable either way.
  petRoam: boolean;

  // petVoice — the roaming spirit's speech bubbles (living-cockpit P4):
  // rare USEFUL one-liners (finished run, error, usage pace, a care need),
  // click-to-jump, hard rate-limited (lib/pet/voice.ts). Quiet mode, sleep
  // and being carried silence it regardless. ON by default.
  petVoice: boolean;

  // minimizeToTray — when ON, closing the window (X) hides AIOS to the system
  // tray and keeps it running (the tray icon's Show/Quit bring it back or
  // exit) instead of quitting. OFF by default → X quits. macOS keeps its dock
  // behavior regardless. Windows/Linux only.
  minimizeToTray: boolean;

  // showCodexUsage — whether the codex (ChatGPT-subscription) usage block
  // appears in the sidebar + idle home. Codex usage is read from
  // ~/.codex/auth.json (a ChatGPT-sub token), which can linger from a past
  // `codex login` or a migrated/shared setup even when the codex CLI isn't
  // installed — so this hides a block that may not be "yours". When OFF we
  // don't even fetch it (no ChatGPT API ping with a foreign token). ON by
  // default (show real data when it exists).
  showCodexUsage: boolean;

  // projects — when ON, a workspace's CLAUDE.md/AGENTS.md context is kept fresh on
  // rescan for workspaces that already have an aios.workspace.json (ones you've
  // opted into). OFF by default — generation is otherwise an explicit, consent-first
  // action per workspace in Settings → projects.
  regenerateContextOnChange: boolean;

  // chat provider (model-agnostic). Default "codex-cli" keeps new chats aligned
  // with the WA oracle. chatModel is the last picked model id (null = provider
  // default). NOTE: the base should follow the user's chosen CLI — see the
  // provider-base sweep in PLAN-superapp-uiux.md §13 (depends on detect_providers).
  chatProvider: string;
  chatModel: string | null;
  // Sticky composer controls — like chatModel, the last-picked effort / access /
  // context persist across panes + restarts (null = the built-in default). So
  // the composer pills remember how you like to operate.
  chatEffort: string | null;
  chatAccess: string | null;
  chatContextBudget: string | null;

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

  // localApiEndpoint — base URL of the "local" BYOK provider (any OpenAI-
  // compatible server: LM Studio :1234, llama.cpp --server :8080, vLLM…).
  // The launch sweep lists {endpoint}/models; chats POST {endpoint}/chat/….
  localApiEndpoint: string;

  // hiddenModels — "engine:id" keys the user removed from every model picker
  // (composer menu + retry menus) via the menu's manage mode. Recoverable there.
  hiddenModels: string[];
  // recentModels — "engine:id" keys of recently picked models, newest first;
  // powers the model menu's short-by-default "recent" group.
  recentModels: string[];
}

/** Routing target for "send to AI" actions. */
export type DefaultAi = "codex-code" | "claude-code" | "terminal" | "chat";

/** Composer flash intensity. */
export type FlashLevel = "calm" | "lush" | "max";

/** Dictation transcription backend. */
export type TranscribeVia = "auto" | "local" | "openai";

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
  terminalSocket: "aios",

  terminalFontSize: 13,
  splashOnLaunch: true,
  reduceMotion: false,
  // calm for a calm app; users can opt up to "lush"/"max" in Settings.
  flashLevel: "calm",
  sidebarMode: "full",
  topBarMode: "hidden",
  notificationNativeMode: "important",
  notificationQuietMode: false,

  primaryOracleId: "",
  whisperUrl: "http://localhost:9000/inference",
  transcribeVia: "auto",
  soundscape: false,
  funFx: true,
  petRoam: true,
  petVoice: true,
  minimizeToTray: false,
  showCodexUsage: true,
  regenerateContextOnChange: false,
  autoRefreshSeconds: 15,
  showNonAiosSessions: false,

  chatProvider: "codex-cli",
  chatModel: null,
  chatEffort: null,
  chatAccess: null,
  chatContextBudget: null,

  defaultAi: "codex-code",

  onboardingComplete: false,
  onboardedAt: null,

  localApiEndpoint: "http://localhost:1234/v1",

  hiddenModels: [],
  recentModels: [],
};

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
  scheduleUiMirrorSave();
  listeners.forEach((fn) => fn(next));
  return next;
}

/** Drop the in-memory cache and re-read localStorage, then notify subscribers.
 *  Called after the disk mirror restores keys at boot (uiMirror.ts) so already-
 *  mounted consumers pick up the recovered values. */
export function rehydrateSettings(): AppSettings {
  cache = null;
  const s = loadSettings();
  listeners.forEach((fn) => fn(s));
  return s;
}

/** Read a single setting by key. */
export function getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
  return loadSettings()[key];
}

/** The user's display name, or a calm fallback. The SINGLE source for the
 *  homescreen greeting and the account row — replaces the old hardcoded
 *  a previous user's name. Set during onboarding (§5). */
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
