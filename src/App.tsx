import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  Bell,
  Bot,
  Camera,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  EllipsisVertical,
  FileText,
  Folder,
  FolderPlus,
  Globe,
  GripVertical,
  Home,
  Layers,
  Maximize2,
  Minimize2,
  MessageSquare,
  MessageCircle,
  MonitorUp,
  MoveRight,
  NotebookPen,
  PanelLeft,
  Pencil,
  Pin,
  SquareStack,
  Plus,
  Radio,
  Search,
  Settings as SettingsIcon,
  TerminalSquare,
  Trash2,
  Wand2,
  Eye,
  EyeOff,
  X,
} from "lucide-react";

import { recallUrl, recallPaneUrl, forgetUrl } from "./lib/browser-mem";
import { browserOpenDevtools, setWindowFullscreen } from "./lib/browser";
import { AccountMenu } from "./components/AccountMenu";
import { ShortcutHud } from "./components/ShortcutHud";
import { Onboarding } from "./components/Onboarding";
import { CommandPalette, loadMru as loadCommandMru, type Command } from "./components/CommandPalette";
import { FileFinder } from "./components/FileFinder";
import { GlobalSearch } from "./components/GlobalSearch";
import { IdleDashboard } from "./components/IdleDashboard";
import { MirrorViewer } from "./components/MirrorViewer";
import { MoneyAgentsSection, type MoneyAgentChatState } from "./components/MoneyAgentsSection";
import { OracleRoster } from "./components/OracleRoster";
import { PaneErrorBoundary } from "./components/PaneErrorBoundary";
import { ResizableGrid } from "./components/ResizableGrid";
import { VoiceButton } from "./components/VoiceButton";
import type { PaneKind } from "./components/TerminalPane";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { appshot, listOracles, reapTerminals, type OracleInfo } from "./lib/pty";
import {
  listChatLive,
  listChatSessions,
  baseModelId,
  codexShellCommand,
  engineForProvider,
  defaultAiForProvider,
  type ChatSessionInfo,
  type LiveChat,
} from "./lib/chat";
import { detectProviders } from "./lib/providerDetect";
import { initTheme } from "./lib/theme";
import { monitorStart, monitorStop } from "./lib/monitor";
import {
  MONEY_AGENTS,
  buildMoneyAgentChatSeed,
  buildMoneyAgentRunCommand,
  loadConfiguredMoneyAgents,
  loadMoneyAgentChatSession,
  moneyAgentById,
} from "./lib/moneyAgents";
import {
  chatHandles,
  detachBusyChats,
  paneWriters,
  paneSubmitters,
  paneImageDrop,
  paneDropSink,
  registerPane,
  paneKeyAtPoint,
  openFileInPane,
  registerOpenFile,
  registerOpenEditorFile,
  registerOpenViewerFile,
  registerRevealFile,
  openEditorFileInPane,
  openViewerFileInPane,
  revealFileInPane,
  openUrlInPane,
  registerOpenUrl,
  registerOpenSettings,
  openSettingsTo,
  paneKeyForChatSession,
  registerSpawnPane,
  onChatBusy,
  type SpawnPaneKind,
  type SpawnCtx,
  type PayloadKind,
} from "./lib/paneBus";
import { containingDir, paneFileTarget } from "./lib/paneOpenActions";
import { basename as pathBasename } from "./lib/paths.ts";
import { SidebarUsage } from "./components/SidebarUsage";
import { trapTab, useExitState, ExitGate } from "./components/ui";
import { loadSettings, saveSettings, applyFlashLevel, subscribe as subscribeSettings } from "./lib/settings";
import { applyAppearance } from "./lib/appearance";
import { MOD, chord, isApple } from "./lib/platform";
import { homeDir, startupOpenPane } from "./lib/fs";
import { detectProject, listProjects, type ProjectInfo } from "./lib/run";
import { loadProjectsStore, mergeProjects, subscribeProjects } from "./lib/projects";
import { isHttpPaneTarget, resolvePaneFileTarget, targetLabel } from "./lib/paneRouting";
import { buildAppCommands } from "./lib/appCommands";
import type { AgentAction } from "./lib/agentActions";
import { isTauriRuntime } from "./lib/tauri";
import { reportDiag, reportUsage } from "./lib/diag";
import {
  ensureMirrorPairing,
  mirrorPairingFromLocation,
  mirrorShareUrl,
  mirrorWebSocketUrl,
  parseMirrorSocketMessage,
  type MirrorConnectionStatus,
  type MirrorPairing,
  type MirrorPresence,
} from "./lib/mirrorTransport";
import {
  createAgentController,
  type AgentController,
  type AgentDispatchInput,
  type AgentDispatchResult,
} from "./lib/agentController";
import type { AgentAuditEntry } from "./lib/agentActions";
import { buildMirrorSnapshot, type MirrorSnapshot } from "./lib/mirror";
import { gridTrackStorageKey, loadGridTracks, movePane, saveGridTracks } from "./lib/paneLayout";
import {
  deleteWorkspace,
  listWorkspaces,
  saveWorkspace,
  subscribeWorkspaces,
  type Workspace,
} from "./lib/workspaces";
import {
  clearAllNotifications,
  clearNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  pushNotification,
  subscribeNotifications,
  type AiosNotification,
  type NotificationTarget,
} from "./lib/notifications";

import { SPAWN, SPAWN_BY_ID, type AppDef, type PaneContent } from "./lib/apps";
import {
  loadSidebar,
  reorder,
  addLink,
  removeItem,
  renameItem,
  setItemIcon,
  toggleHidden,
  setGroup,
  addSpace,
  renameSpace,
  removeSpace,
  toggleSpaceCollapsed,
  subscribe as subscribeSidebar,
  type SidebarItem,
  type SidebarSpace,
  type SidebarState,
} from "./lib/sidebar";

// re-export the catalog types so existing consumers (IdleDashboard) keep their
// `import { AppDef } from "../App"` path working without churn.
export type { AppDef, PaneContent };

const PetPane = lazy(() => import("./components/PetPane").then((m) => ({ default: m.PetPane })));
const AttachAppsPane = lazy(() =>
  import("./components/AttachAppsPane").then((m) => ({ default: m.AttachAppsPane })),
);
const AppAttachPane = lazy(() =>
  import("./components/AppAttachPane").then((m) => ({ default: m.AppAttachPane })),
);
const AppCastPane = lazy(() => import("./components/AppCastPane").then((m) => ({ default: m.AppCastPane })));
const BridgesPane = lazy(() => import("./components/BridgesPane").then((m) => ({ default: m.BridgesPane })));
const BrowserPane = lazy(() => import("./components/BrowserPane").then((m) => ({ default: m.BrowserPane })));
const ChatPane = lazy(() => import("./components/ChatPane").then((m) => ({ default: m.ChatPane })));
const EditorPane = lazy(() => import("./components/EditorPane").then((m) => ({ default: m.EditorPane })));
const FilesPane = lazy(() => import("./components/FilesPane").then((m) => ({ default: m.FilesPane })));
const FileViewerPane = lazy(() =>
  import("./components/FileViewerPane").then((m) => ({ default: m.FileViewerPane })),
);
const MoneyAgentsPane = lazy(() =>
  import("./components/MoneyAgentsPane").then((m) => ({ default: m.MoneyAgentsPane })),
);
const NotesPane = lazy(() => import("./components/NotesPane").then((m) => ({ default: m.NotesPane })));
const PluginsPane = lazy(() => import("./components/PluginsPane").then((m) => ({ default: m.PluginsPane })));
const PulsePane = lazy(() => import("./components/PulsePane").then((m) => ({ default: m.PulsePane })));
const Settings = lazy(() => import("./components/Settings").then((m) => ({ default: m.Settings })));
const TerminalPane = lazy(() =>
  import("./components/TerminalPane").then((m) => ({ default: m.TerminalPane })),
);

interface Pane {
  key: string;
  label: string;
  kind: PaneContent;
}

/** Drop intent while drag-reordering: insertion at an edge, exchange in the
 *  middle. Computed from the pointer's position within the hovered pane. */
type PaneDropZoneKind = "before" | "after" | "swap";

const isTerminal = (k: PaneContent): k is PaneKind =>
  k.type === "shell" || k.type === "oracle" || k.type === "tmux";

// Files that render in the viewer (images / pdf / office / binary); everything
// else opens in the Monaco editor pane (the editor itself falls back to "open
// externally" if the file turns out to be binary).
const VIEWER_EXT = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico",
  "md", "markdown",
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "key", "numbers", "pages",
  "zip", "gz", "tar", "dmg", "app", "mp4", "mov", "webm", "m4v", "avi", "mkv", "mp3", "wav", "woff", "woff2", "ttf",
]);

const INTERACTIVE_SELECTOR = [
  "button",
  "a",
  "input",
  "textarea",
  "select",
  "[role='button']",
  "[role='radio']",
  "[data-no-window-drag]",
].join(",");

/** Pick the pane kind for opening a file: viewer for media/binaries, else the
 *  code editor. */
function paneForFile(path: string, name: string): PaneContent {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return VIEWER_EXT.has(ext)
    ? { type: "file", path, name }
    : { type: "editor", path, name };
}

let seq = 0;
const nextKey = () => `k${++seq}-${Math.random().toString(36).slice(2, 6)}`;

/** Advance `seq` past a restored pane key's numeric index so a freshly-minted
 *  key (`nextKey`) can never collide with a persisted one (B1). Restored keys
 *  have the shape `k<seq>-<rand>`; parse the <seq> and keep `seq` ahead of it. */
function reserveKeySeq(key: string) {
  const m = /^k(\d+)-/.exec(key);
  if (m) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > seq) seq = n;
  }
}

/** Derives the `aios-term-<name>` session SUFFIX from a pane key — MUST match
 *  `termSessionName` in TerminalRuntime.tsx (kept inline here so the reaper
 *  doesn't pull xterm into the main bundle). Used to build the keep-set for the
 *  startup GC (B2) so a live pane's session is never reaped. */
function termSessionSuffix(paneKey: string): string {
  const base = paneKey
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base; // fallback case (no key) never reaches the reaper — keys exist here
}

// ── session layout persistence ───────────────────────────────────────────────
// Reopen whatever panes were open last time (mac-app muscle memory) — closing a
// pane with its X removes it from the saved set, so the layout reflects what you
// left up. Only kinds that can be cleanly re-spawned are persisted; transient
// one-shot fields (chat seed/resume/reattach) are stripped so a restored chat
// doesn't re-fire its launcher prompt or try to reattach a dead backend id.
const LAYOUT_KEY = "aios.layout";
const GRID_TRACK_KEY = "aios.grid.tracks";
const AGENT_AUDIT_KEY = "aios.agent.audit.v1";
const AGENT_AUDIT_LIMIT = 200;

function recordAgentAudit(entry: AgentAuditEntry) {
  try {
    const raw = localStorage.getItem(AGENT_AUDIT_KEY);
    const current = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(current) ? current : [];
    localStorage.setItem(
      AGENT_AUDIT_KEY,
      JSON.stringify([entry, ...list].slice(0, AGENT_AUDIT_LIMIT)),
    );
  } catch {
    /* quota / unavailable — skip */
  }
}

/** Strip a pane kind down to its restorable shape (drop one-shot fields). */
function persistableKind(kind: PaneContent): PaneContent | null {
  if (kind.type === "chat") return { type: "chat", cwd: kind.cwd }; // fresh chat, no seed/resume/reattach
  // file/editor restore by path; everything else is self-describing.
  return kind;
}

/** Rehydrate saved pane rows into live panes — shared by the boot layout AND
 *  workspace restore so both get the same session-revival semantics. */
function hydrateSavedPanes(saved: { key?: string; label: string; kind: PaneContent }[]): Pane[] {
  return saved.map((p) => {
    // B1: REUSE the persisted key so a restored terminal pane keeps its
    // original pane key → `termSessionName` derives the SAME `aios-term-<name>`
    // and reattaches to the session its claude/codex was running in. Minting a
    // fresh key here (the old bug) computed a brand-new name → `new-session -A`
    // created an empty session and orphaned the real one. Reserve `seq` past
    // the restored index so a future nextKey() can't collide.
    const key = typeof p.key === "string" && p.key ? p.key : nextKey();
    reserveKeySeq(key);
    // Session restore (item 4): a browser pane reopens at the LAST url it was
    // on, not its original landing page. BrowserPane records its live url under
    // its pane key (the same key persisted here, B1) via browser-mem, so we
    // read it back and seed the restored pane's url. Falls back to the
    // persisted url (e.g. a pinned-site deep-link) when there's no memory.
    if (p.kind.type === "browser") {
      const last = recallPaneUrl(key) ?? recallPaneUrl(p.kind.memKey);
      const kind = last ? { ...p.kind, url: last } : p.kind;
      return { key, label: p.label, kind };
    }
    return { key, label: p.label, kind: p.kind };
  });
}

function loadLayout(): Pane[] {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (!raw) return [];
    const saved = JSON.parse(raw) as { key?: string; label: string; kind: PaneContent }[];
    if (!Array.isArray(saved)) return [];
    return hydrateSavedPanes(saved);
  } catch {
    return [];
  }
}

function saveLayout(panes: Pane[]) {
  try {
    const out = panes
      .map((p) => {
        const kind = persistableKind(p.kind);
        // Persist the pane KEY (B1) — it's the seed for `termSessionName`, so a
        // restored terminal pane must keep the same key to reattach its session.
        return kind ? { key: p.key, label: p.label, kind } : null;
      })
      .filter(Boolean);
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(out));
  } catch {
    /* quota / unavailable — skip */
  }
}

// ── recent-files MRU (⌘P empty-query list) ───────────────────────────────────
// Generalizes the old single `lastOpenPath` ref into a persisted most-recently-
// used list so the fuzzy finder can show "recent files" before you type. Newest
// first, de-duped, capped.
const MRU_KEY = "aios.files.mru";
const MRU_LIMIT = 40;

function loadMru(): string[] {
  try {
    const raw = localStorage.getItem(MRU_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function pushMru(path: string) {
  try {
    const next = [path, ...loadMru().filter((p) => p !== path)].slice(0, MRU_LIMIT);
    localStorage.setItem(MRU_KEY, JSON.stringify(next));
  } catch {
    /* quota / unavailable — skip */
  }
}

function startWindowDrag(e: React.MouseEvent<HTMLElement>) {
  if (e.button !== 0) return;
  if ((e.target as HTMLElement | null)?.closest(INTERACTIVE_SELECTOR)) return;
  // The hidden-top-bar drag strip floats over the first pane row — if an
  // interactive control sits directly UNDER the press point, don't steal it.
  const under = document
    .elementsFromPoint(e.clientX, e.clientY)
    .find((el) => el !== e.currentTarget && !e.currentTarget.contains(el));
  if (under?.closest?.(INTERACTIVE_SELECTOR)) return;
  if (!isTauriRuntime()) return;
  void getCurrentWindow().startDragging().catch((e) => reportDiag("app.window", e, { action: "startDragging" }));
}

/** The model a money-agent chatpane should boot on — the user's base model
 *  (which follows their installed/chosen engine via the §13 base sweep), NOT a
 *  hardcoded codex model that fails with "program not found" when codex isn't
 *  installed. Read fresh at spawn time so it reflects the self-healed provider. */
function agentChatModelId(): string {
  const s = loadSettings();
  return baseModelId(s.chatProvider, s.chatModel);
}

function App() {
  const nativeRuntime = useMemo(() => isTauriRuntime(), []);
  const [webViewportCompact, setWebViewportCompact] = useState(() =>
    !nativeRuntime && window.matchMedia("(max-width: 1024px)").matches,
  );
  const [panes, setPanes] = useState<Pane[]>(() =>
    loadSettings().reopenLastLayout ? loadLayout() : [],
  );
  const [sidebarOpen, setSidebarOpen] = useState(() => !(!nativeRuntime && window.matchMedia("(max-width: 1024px)").matches));
  // gate on the setting (was always-on, ignoring splashOnLaunch). Fade out
  // rather than hard-popping — see the two-phase timer below.
  const [splash, setSplash] = useState(() => loadSettings().splashOnLaunch);
  const [splashFading, setSplashFading] = useState(false);
  // first-run onboarding — only an empty localStorage (no onboardingComplete)
  // opens it; veterans are back-filled true in loadSettings. Replayable from
  // Settings via the "aios:replay-onboarding" event.
  const [onboardingOpen, setOnboardingOpen] = useState(
    () => !loadSettings().onboardingComplete,
  );
  useEffect(() => {
    const replay = () => {
      setSettingsOpen(false);
      setOnboardingOpen(true);
    };
    window.addEventListener("aios:replay-onboarding", replay);
    return () => window.removeEventListener("aios:replay-onboarding", replay);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shortcutHudOpen, setShortcutHudOpen] = useState(false);
  // When a notification deep-links to Settings → a section, App opens the overlay
  // AND hands Settings the section to jump to (consumed once on open).
  const [settingsSection, setSettingsSection] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [fileFinderOpen, setFileFinderOpen] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  // Recent-files MRU (⌘P empty-query list); kept in state so opens repaint it.
  const [mru, setMru] = useState<string[]>(loadMru);
  const [notifications, setNotifications] = useState<AiosNotification[]>(listNotifications);
  const [remoteMirrorSnapshot, setRemoteMirrorSnapshot] = useState<MirrorSnapshot | null>(null);
  const [mirrorStatus, setMirrorStatus] = useState<MirrorConnectionStatus>("off");
  const [mirrorPresence, setMirrorPresence] = useState<MirrorPresence | null>(null);
  const mirrorWsRef = useRef<WebSocket | null>(null);
  const mirrorOpenRef = useRef(false);
  const agentControllerRef = useRef<AgentController | null>(null);
  const mirrorPairing = useMemo<MirrorPairing | null>(() => {
    if (nativeRuntime) return ensureMirrorPairing();
    return mirrorPairingFromLocation();
  }, [nativeRuntime]);
  const webMirrorMode = !nativeRuntime && mirrorPairing != null;
  const mirrorUrl = useMemo(
    () => (nativeRuntime && mirrorPairing ? mirrorShareUrl(mirrorPairing) : null),
    [nativeRuntime, mirrorPairing],
  );
  const compactWebLayout = !nativeRuntime && webViewportCompact;
  // mission-control-style pane overview: fan out every open pane to switch.
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // pane key pending a close-confirm (busy chat: keep-running vs kill).
  const [closePrompt, setClosePrompt] = useState<string | null>(null);
  // Panes mid-exit-animation: still rendered (with .pane-exit) for one beat
  // before removal. Ref mirrors the state for the double-close guard.
  const [closingKeys, setClosingKeys] = useState<string[]>([]);
  const closingPanesRef = useRef<Set<string>>(new Set());
  // pane currently under a native OS file drag OR a reorder-drag (drop highlight).
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  // the pane currently being drag-reordered (null = none). Drives per-pane hover
  // reporting + the "lifted" visual. We deliberately DON'T deactivate panes during
  // a reorder (that blanked native webviews → the flicker/"offline" feel); the
  // drag is pure DOM layered over still-live webviews, tracked via each pane's own
  // pointer-enter over its HTML title strip (the original AIOS approach).
  const [dragActiveKey, setDragActiveKey] = useState<string | null>(null);
  // snap zone within the hovered target: pointer in the left ~30% → place
  // BEFORE it, right ~30% → AFTER it, middle → swap (the original gesture).
  const [dropZone, setDropZone] = useState<PaneDropZoneKind | null>(null);
  const paneDragZoneRef = useRef<PaneDropZoneKind | null>(null);
  // focus spotlight (⌘./Ctrl+.) — dim every pane but the active one.
  const [focusSpotlight, setFocusSpotlight] = useState(false);
  // activity glow — the set of chat panes with a live run (chrome breathes).
  const [busyChatKeys, setBusyChatKeys] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => onChatBusy((s) => setBusyChatKeys(new Set(s))), []);
  const paneDragRef = useRef<{ from: string; x: number; y: number; armed: boolean } | null>(null);
  const paneDragOverRef = useRef<string | null>(null);
  // per-pane window controls. The maximized pane escapes the CSS grid to fill
  // the viewport (`fixed inset-2 z-30`); every OTHER pane must deactivate
  // (active=false) because native webviews paint ABOVE html and would overpaint
  // it. Hidden panes stay MOUNTED (out of layout via display:none) so their
  // terminal/webview state survives — restored from the dock bar.
  const [maximizedKey, setMaximizedKey] = useState<string | null>(null);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);
  // the pane the user last interacted with — drives the "OPEN" rail highlight +
  // is where dictation / drops route. A ref alone wouldn't re-render the rail.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const toggleMax = useCallback(
    (key: string) => setMaximizedKey((cur) => (cur === key ? null : key)),
    [],
  );
  const toggleHide = useCallback((key: string) => {
    setHiddenKeys((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]));
    setMaximizedKey((cur) => (cur === key ? null : cur));
  }, []);
  const movePaneByKey = useCallback((key: string, delta: -1 | 1) => {
    setPanes((cur) => {
      const index = cur.findIndex((p) => p.key === key);
      const next = movePane(cur, index, delta);
      setActiveKey(next.items[next.selected]?.key ?? key);
      return next.items;
    });
  }, []);

  // pointer-driven drag-to-move: swap two panes' grid positions. HTML5 draggable
  // is swallowed by the Tauri webview's OS drag-drop, so the gesture is pure
  // pointer events. The title strip is the handle; each pane reports when the
  // drag-pointer enters it (over its HTML chrome) — NO webview hiding, so browser
  // panes never blank mid-drag. On drop the two cells swap (predictable; the CSS
  // grid auto-places by array order).
  const swapPanes = useCallback((fromKey: string, toKey: string) => {
    setPanes((cur) => {
      const a = cur.findIndex((p) => p.key === fromKey);
      const b = cur.findIndex((p) => p.key === toKey);
      if (a < 0 || b < 0 || a === b) return cur;
      const next = [...cur];
      [next[a], next[b]] = [next[b], next[a]];
      return next;
    });
    setActiveKey(fromKey);
  }, []);
  // snap-to-zone placement: pull the dragged pane out and re-insert it before/
  // after the target — an INSERTION, where swap is an exchange. With the grid
  // auto-placing by array order this is the whole window-manager move; the
  // grid-template transition glides everything into place.
  const placePane = useCallback(
    (fromKey: string, toKey: string, zone: "before" | "after") => {
      setPanes((cur) => {
        const a = cur.findIndex((p) => p.key === fromKey);
        if (a < 0) return cur;
        const next = [...cur];
        const [moved] = next.splice(a, 1);
        const b = next.findIndex((p) => p.key === toKey);
        if (b < 0) return cur;
        next.splice(zone === "before" ? b : b + 1, 0, moved);
        return next;
      });
      setActiveKey(fromKey);
    },
    [],
  );
  // pointerdown on a pane's title strip → arm a drag. The strip captures the
  // pointer once armed so moves keep flowing even over native-webview panes,
  // and the target is hit-tested from the DOM under the cursor (every pane
  // wrapper carries data-pane-key — the slot div sits under the native layer).
  // A 6px threshold keeps plain clicks click-y; text selection is suppressed
  // for the whole gesture so dragging never paints blue smears.
  const onPaneDragStart = useCallback(
    (key: string, e: React.PointerEvent<HTMLElement>) => {
      const strip = e.currentTarget;
      const pointerId = e.pointerId;
      paneDragRef.current = { from: key, x: e.clientX, y: e.clientY, armed: false };
      paneDragOverRef.current = null;
      const onMove = (ev: PointerEvent) => {
        const d = paneDragRef.current;
        if (!d) return;
        if (!d.armed) {
          if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) < 6) return;
          d.armed = true;
          setDragActiveKey(d.from);
          document.body.style.cursor = "grabbing";
          document.body.style.userSelect = "none";
          window.getSelection()?.removeAllRanges();
          try {
            strip.setPointerCapture(pointerId);
          } catch {
            /* capture is best-effort */
          }
        }
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const overEl = el?.closest?.("[data-pane-key]") ?? null;
        const overKey = overEl?.getAttribute("data-pane-key") ?? null;
        const over = overKey && overKey !== d.from ? overKey : null;
        if (paneDragOverRef.current !== over) {
          paneDragOverRef.current = over;
          setDropTargetKey(over);
        }
        // zone within the target: left ~30% → before, right ~30% → after,
        // middle → swap. Edges are insertion (window-manager placement);
        // center keeps the original exchange gesture.
        let zone: PaneDropZoneKind | null = null;
        if (over && overEl) {
          const r = (overEl as HTMLElement).getBoundingClientRect();
          const fx = r.width > 0 ? (ev.clientX - r.left) / r.width : 0.5;
          zone = fx < 0.3 ? "before" : fx > 0.7 ? "after" : "swap";
        }
        if (paneDragZoneRef.current !== zone) {
          paneDragZoneRef.current = zone;
          setDropZone(zone);
        }
      };
      const finish = (commit: boolean) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        const d = paneDragRef.current;
        const over = paneDragOverRef.current;
        const zone = paneDragZoneRef.current;
        paneDragRef.current = null;
        paneDragOverRef.current = null;
        paneDragZoneRef.current = null;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        try {
          strip.releasePointerCapture(pointerId);
        } catch {
          /* already released */
        }
        setDragActiveKey(null);
        setDropTargetKey(null);
        setDropZone(null);
        if (commit && d?.armed && over && over !== d.from) {
          if (zone === "before" || zone === "after") placePane(d.from, over, zone);
          else swapPanes(d.from, over);
        }
      };
      const onUp = () => finish(true);
      const onCancel = () => finish(false);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [swapPanes, placePane],
  );
  // TRUE video fullscreen: a child webview's HTML fullscreen only fills its rect.
  // When a video enters fullscreen we maximize the pane (webview → whole window)
  // AND fullscreen the OS window (window → whole screen); on exit we restore the
  // prior maximize state. prevMax remembers what was maximized before the video.
  const prevMaxRef = useRef<string | null>(null);
  const onVideoFullscreen = useCallback((key: string, on: boolean) => {
    if (on) {
      // SEQUENCE, don't race: maximize the pane FIRST (webview grows to fill the
      // window via its rAF bounds-sync), then OS-fullscreen the window on the
      // NEXT frames once that layout has settled. Firing both at once made the
      // webview bounds resolve mid-transition, so the fullscreen <video> locked
      // to the small pane rect — which is why it only worked when the pane was
      // already maximized. Two rAFs ≈ the pane is laid out full-window before the
      // OS fullscreen space-transition begins.
      setMaximizedKey((cur) => {
        prevMaxRef.current = cur;
        return key;
      });
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setWindowFullscreen(true).catch((e) => reportDiag("app.window", e, { action: "enterFullscreen" }))),
      );
    } else {
      // reverse order on exit: drop OS fullscreen first, then restore the prior
      // maximize state once the window is back in-space.
      setWindowFullscreen(false).catch((e) => reportDiag("app.window", e, { action: "exitFullscreen" }));
      requestAnimationFrame(() =>
        requestAnimationFrame(() => setMaximizedKey(() => prevMaxRef.current)),
      );
    }
  }, []);

  // ⌘F → fullscreen the SELECTED pane (any type — not just video). Uses the same
  // pane-maximize + OS-fullscreen path, so a browser pane goes true screen-fill
  // and a terminal/editor goes edge-to-edge. Target = the selected/focused pane,
  // else the single pane if there's only one. Toggle: a second ⌘F restores.
  const toggleFullscreenSelected = useCallback((): boolean => {
    if (panes.length === 0) return false;
    const sel = activeKey ?? focusedPane.current;
    const target =
      panes.find((p) => p.key === sel) ?? (panes.length === 1 ? panes[0] : null);
    if (!target) return false; // no clear target → let ⌘F fall through to find
    const isOn = maximizedKey === target.key;
    onVideoFullscreen(target.key, !isOn);
    return true;
  }, [panes, activeKey, maximizedKey, onVideoFullscreen]);

  // ⌘F reconciliation (R5 item 4 vs R2a pane-fullscreen). When the FOCUSED pane
  // is a browser, ⌘F means find-in-page → dispatch a window event the matching
  // BrowserPane listens for (its webview label = its pane key). Otherwise ⌘F
  // toggles pane fullscreen. Returns true if it handled ⌘F (so the caller
  // preventDefaults). The ⌘. exit-fullscreen path is untouched.
  const handleCmdF = useCallback((): boolean => {
    const sel = activeKey ?? focusedPane.current;
    const target =
      panes.find((p) => p.key === sel) ?? (panes.length === 1 ? panes[0] : null);
    if (target?.kind.type === "browser") {
      window.dispatchEvent(
        new CustomEvent("aios-browser-find", { detail: { label: target.key } }),
      );
      return true;
    }
    if (target?.kind.type === "chat") {
      // find-in-chat (ChatPane listens, matches its own pane key) — before this,
      // ⌘F on a chat pane fell through to fullscreen, of all things.
      window.dispatchEvent(
        new CustomEvent("aios-chat-find", { detail: { key: target.key } }),
      );
      return true;
    }
    return toggleFullscreenSelected();
  }, [panes, activeKey, toggleFullscreenSelected]);
  // personalizable sidebar — items + order live in lib/sidebar (localStorage).
  const [sidebar, setSidebar] = useState<SidebarState>(loadSidebar);
  useEffect(() => subscribeSidebar(setSidebar), []);
  useEffect(() => subscribeNotifications(setNotifications), []);
  const [sidebarMode, setSidebarMode] = useState(() => loadSettings().sidebarMode);
  const [topBarMode, setTopBarMode] = useState(() => loadSettings().topBarMode);
  useEffect(() =>
    subscribeSettings((next) => {
      setSidebarMode(next.sidebarMode);
      setTopBarMode(next.topBarMode);
    }),
  []);
  const iconsOnly = sidebarMode === "icons";
  // "pin a site" inline prompt.
  // which space the pin-a-site modal targets (null = closed).
  const [pinSiteSpace, setPinSiteSpace] = useState<string | null>(null);
  // workspaces: saved named layouts + the save-dialog draft (null = closed).
  const [workspaces, setWorkspaces] = useState<Workspace[]>(listWorkspaces);
  useEffect(() => subscribeWorkspaces(() => setWorkspaces(listWorkspaces())), []);
  const [wsDraft, setWsDraft] = useState<string | null>(null);
  // Native browser webviews paint ABOVE html, so any floating overlay (modals,
  // palette, finders, the busy-chat close prompt, splash, onboarding) must hide
  // them or it gets occluded.
  const overlayOpen =
    settingsOpen ||
    paletteOpen ||
    pinSiteSpace != null ||
    wsDraft != null ||
    overviewOpen ||
    fileFinderOpen ||
    globalSearchOpen ||
    closePrompt != null ||
    onboardingOpen ||
    splash;

  useEffect(() => {
    if (!splash) return; // splashOnLaunch === false → never showed; nothing to time
    const fade = setTimeout(() => setSplashFading(true), 700); // begin opacity fade
    const gone = setTimeout(() => setSplash(false), 1000); // unmount after the fade
    return () => {
      clearTimeout(fade);
      clearTimeout(gone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (nativeRuntime) return;
    const mq = window.matchMedia("(max-width: 1024px)");
    const update = () => setWebViewportCompact(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [nativeRuntime]);

  useEffect(() => {
    if (compactWebLayout) setSidebarOpen(false);
  }, [compactWebLayout]);

  useEffect(() => {
    const teardown = initTheme();
    applyFlashLevel(); // reflect stored composer flash level on <html>
    applyAppearance(); // font-scale + density + reduce-motion at boot (not just when Settings mounts)
    return teardown;
  }, []);

  // Provider self-heal: if the configured chat engine's CLI isn't installed but
  // another one IS, switch the base to the installed engine so new chats + agents
  // don't dead-end on "failed to spawn <engine>: program not found". Conservative
  // — only fires when the current engine is genuinely missing and a real
  // alternative exists; otherwise leaves the choice alone (onboarding handles the
  // no-CLI case). See the provider-base section of the UI/UX plan (§13).
  useEffect(() => {
    detectProviders().then((statuses) => {
      const installed = statuses.filter((s) => s.available);
      if (installed.length === 0) return; // nothing detected / off-Tauri → don't touch
      const s = loadSettings();
      const currentEngine = engineForProvider(s.chatProvider);
      if (installed.some((x) => x.id === currentEngine)) return; // current engine is fine
      const target = `${installed[0].id}-cli`;
      saveSettings({
        chatProvider: target,
        chatModel: null, // re-derive the base model for the new engine
        defaultAi: defaultAiForProvider(target),
      });
    });
  }, []);

  // Startup GC (B2): reap orphaned `aios-term-*` tmux sessions with no restored
  // pane. Build the keep-set from the panes present at mount (the restored
  // layout) — only shell-type terminal panes back a persistent `aios-term-*`
  // session, so those are the only suffixes we preserve. Mount-once; reads the
  // initial `panes` closure (== the restored layout). Conservative: the backend
  // kills only sessions outside the keep-set.
  useEffect(() => {
    if (!nativeRuntime) return;
    const keep = panes
      .filter((p) => p.kind.type === "shell")
      .map((p) => termSessionSuffix(p.key))
      .filter(Boolean);
    reapTerminals(keep).catch(() => {
      /* no tmux server / non-AIOS box → nothing to reap */
    });
    // mount-once: the restored layout is fixed at boot; later pane churn is
    // handled by detach/close, not the startup reaper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist the open-pane layout whenever it changes, so the next launch reopens
  // exactly what's up now (X-ing a pane drops it from the saved set).
  useEffect(() => {
    saveLayout(panes);
  }, [panes]);

  // Toast with a real exit beat (.toast-in/.toast-out). Timer refs so a second
  // flash can't have the FIRST flash's timeout clear it mid-display (the old
  // bug: every flash armed an unconditional 2.6s clear).
  const toastTimers = useRef<{ out?: number; clear?: number }>({});
  const [toastLeaving, setToastLeaving] = useState(false);
  const flash = useCallback((msg: string) => {
    clearTimeout(toastTimers.current.out);
    clearTimeout(toastTimers.current.clear);
    setToastLeaving(false);
    setToast(msg);
    toastTimers.current.out = window.setTimeout(() => setToastLeaving(true), 2400);
    toastTimers.current.clear = window.setTimeout(() => {
      setToast(null);
      setToastLeaving(false);
    }, 2600);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const win = getCurrentWindow();

    win
      .onCloseRequested(async (event) => {
        const detachedNow = detachBusyChats(true);
        let alreadyBackgrounded = false;
        try {
          alreadyBackgrounded = (await listChatLive()).some((chat) => chat.busy);
        } catch {
          alreadyBackgrounded = false;
        }
        if (detachedNow === 0 && !alreadyBackgrounded) return;

        event.preventDefault();
        // The flash toast above is the only signal needed here — a backgrounded
        // chat fires a clickable `chat.done` notification when it actually
        // finishes (see the "aios-notify" listener), so this is not a notification.
        flash(
          detachedNow > 0
            ? `kept ${detachedNow} chat${detachedNow === 1 ? "" : "s"} running in background`
            : "chat still running in background",
        );
        await win.hide().catch((e) => reportDiag("app.window", e, { action: "hide" }));
      })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e) => reportDiag("app.listen", e, { action: "statusEvent" }));

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [flash]);

  const spawn = useCallback((kind: PaneContent, label: string): string => {
    const key = nextKey();
    // Light usage event (kind:"usage") — seeds the "what I use" prioritization.
    // Carries only the pane-type enum, never any argument/label content.
    reportUsage("pane.spawn", kind.type);
    // EXIT FULLSCREEN ON ANY NEW-PANE SPAWN (R2a FIX 3): if a pane currently owns
    // OS fullscreen / maximize, a freshly-spawned pane would be invisible behind
    // it (the maximized pane fills the window + every other pane deactivates). Drop
    // fullscreen first so the new pane actually appears in the grid and firaz SEES
    // it. Functional setState reads the live value without a deps dependency.
    setMaximizedKey((m) => {
      if (m !== null) setWindowFullscreen(false).catch((e) => reportDiag("app.window", e, { action: "exitFullscreen" }));
      return null;
    });
    setPanes((p) => {
      // Make every pane label identifiable at a glance:
      //  - shell/claude panes with a cwd → suffix the dir basename ("terminal · shell")
      //  - then de-dupe: if that label is already open, append " 2", " 3", …
      // so the OPEN rail + overview never show two indistinguishable "terminal"s.
      let base = label;
      if ((kind.type === "shell") && kind.cwd) {
        const dir = pathBasename(kind.cwd);
        if (dir) base = `${label} · ${dir}`;
      }
      const taken = new Set(p.map((x) => x.label));
      let next = base;
      if (taken.has(next)) {
        let n = 2;
        while (taken.has(`${base} ${n}`)) n++;
        next = `${base} ${n}`;
      }
      return [...p, { key, kind, label: next }];
    });
    return key;
  }, []);

  const openUrl = useCallback(
    (url: string, label = "browser") => {
      spawn({ type: "browser", url }, label);
    },
    [spawn],
  );

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    // Debounce spawn spam: a link-heavy page (or a misbehaving site) can fire many
    // window.open / target=_blank requests in a burst. De-dupe identical urls
    // within a short window so one click can't spawn 10 panes.
    const recent = new Map<string, number>();
    const DEDUP_MS = 800;
    void listen<{ url: string; profile?: string; is_popup?: boolean }>(
      "browser-new-pane",
      ({ payload }) => {
        if (!payload.url) return;
        const now = Date.now();
        const last = recent.get(payload.url) ?? 0;
        if (now - last < DEDUP_MS) return; // burst from the same url → ignore
        recent.set(payload.url, now);
        // prune so the map can't grow unbounded on a long-lived session
        if (recent.size > 64) {
          for (const [u, t] of recent) if (now - t > DEDUP_MS) recent.delete(u);
        }
        // OAuth nuance: a popup (window.open with explicit size features — the
        // "sign in with Google/Apple" shape) is a TRANSIENT child of its opener.
        // We still open it as a pane (so the auth flow can complete in-app), but
        // tag it transient=true so it can be auto-reaped/associated with the opener
        // rather than stranding a permanent pane after the redirect closes it.
        spawn(
          {
            type: "browser",
            url: payload.url,
            profile: payload.profile,
            transient: payload.is_popup === true,
          },
          payload.is_popup ? "sign-in" : "browser",
        );
      },
    )
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e) => reportDiag("app.listen", e, { action: "browserEvent" }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [spawn]);

  // A file downloaded inside a browser pane → open it in the right in-app pane
  // (pdf→viewer, code→editor via paneForFile). Net: download a PDF in a browser
  // pane and it pops open in a viewer pane.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ path: string; name?: string }>("browser-download", ({ payload }) => {
      if (!payload?.path) return;
      const name = payload.name || pathBasename(payload.path);
      openFileInPane(payload.path, name);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e) => reportDiag("app.listen", e, { action: "openFileEvent" }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Backend → in-app notification bridge. The chat backend emits `aios-notify`
  // when a BACKGROUNDED chat finishes its turn (chat.rs notify_done). We turn it
  // into a clickable `chat.done` notification whose target reattaches that exact
  // session — firaz's #1 ask. (The OS toast still fires from the backend; this is
  // the in-app bell + record. Wiring the OS-toast CLICK is Phase 2.)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ kind: string; session_id: number; title?: string }>("aios-notify", ({ payload }) => {
      if (!payload || typeof payload.session_id !== "number") return;
      const title = payload.title || "chat";
      if (payload.kind === "chat.done") {
        pushNotification({
          kind: "chat.done",
          level: "success",
          priority: "high",
          sourceLabel: "chat",
          title: "chat finished",
          body: `${title} — done. click to reopen.`,
          target: { type: "chat", sessionId: payload.session_id, title },
        });
      }
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e) => reportDiag("app.listen", e, { action: "aiosNotify" }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // Resolve a sidebar item to a spawn: built-in apps look up their kind from the
  // catalog; link items open the embedded browser already at their url.
  const spawnSidebarItem = useCallback(
    (item: SidebarItem) => {
      if (item.kind.type === "link") {
        // resume at the last place this pinned site was left, falling back to its
        // pinned url; memKey = the stable item id so the memory survives restarts.
        spawn(
          { type: "browser", url: recallUrl(item.id) ?? item.kind.url, memKey: item.id },
          item.label,
        );
        return;
      }
      const app = SPAWN_BY_ID[item.kind.appId];
      if (app) spawn(app.kind, item.label);
    },
    [spawn],
  );

  // remember the last file opened in the editor so F5 knows which project to run
  const lastOpenPath = useRef<string | null>(null);
  // Live mirrors of state/callbacks the open path needs for DEDUP, but which are
  // declared later (focusPane) — refs keep these callbacks dependency-free while
  // always reading the freshest values (assigned in an effect below).
  const panesRef = useRef<Pane[]>([]);
  const focusPaneRef = useRef<(key: string) => void>(() => {});
  // voice dictation → the focused terminal pane, else clipboard. Declared up
  // here (not next to focusPane) because the finderRoot useMemo reads
  // focusedPane.current during render — a later `const` would be in its TDZ
  // and throw "cannot access before initialization" (black screen on mount).
  const focusedPane = useRef<string | null>(null);
  const setPanesRef = useRef<typeof setPanes>(setPanes);

  // OPEN-FILE DEDUP (panes ARE tabs): if a pane already shows this exact file,
  // focus it instead of spawning a duplicate. For the editor we also reveal the
  // requested line by patching the pane's kind (EditorPane re-runs on line change).
  // Returns the focused pane's key, or null when nothing matched (caller spawns).
  const focusExistingFilePane = useCallback(
    (kind: "editor" | "file", path: string, at?: { line?: number; col?: number }): string | null => {
      const existing = panesRef.current.find(
        (p) => p.kind.type === kind && p.kind.path === path,
      );
      if (!existing) return null;
      if (kind === "editor" && at?.line) {
        setPanesRef.current((ps) =>
          ps.map((p) =>
            p.key === existing.key && p.kind.type === "editor"
              ? { ...p, kind: { ...p.kind, line: at.line, col: at.col } }
              : p,
          ),
        );
      }
      focusPaneRef.current(existing.key);
      return existing.key;
    },
    [],
  );

  const recordMru = useCallback((path: string) => {
    lastOpenPath.current = path;
    pushMru(path);
    setMru(loadMru());
  }, []);
  const openFile = useCallback(
    (path: string, name: string) => {
      recordMru(path);
      const kind = paneForFile(path, name);
      const fileKind = kind.type === "editor" ? "editor" : "file";
      if (focusExistingFilePane(fileKind, path)) return;
      spawn(kind, name);
    },
    [spawn, focusExistingFilePane, recordMru],
  );
  const openEditorFile = useCallback(
    (path: string, name: string, at?: { line?: number; col?: number }) => {
      recordMru(path);
      if (focusExistingFilePane("editor", path, at)) return;
      spawn({ type: "editor", path, name, line: at?.line, col: at?.col }, name);
    },
    [spawn, focusExistingFilePane, recordMru],
  );
  const openViewerFile = useCallback(
    (path: string, name: string) => {
      recordMru(path);
      if (focusExistingFilePane("file", path)) return;
      spawn({ type: "file", path, name }, name);
    },
    [spawn, focusExistingFilePane, recordMru],
  );
  const revealFile = useCallback(
    (path: string, name: string) => {
      const root = containingDir(path);
      spawn({ type: "files", root }, `files · ${name}`);
    },
    [spawn],
  );

  // GENERIC cross-pane spawn (paneBus.spawnPane): any pane asks App to open a
  // fresh pane of a given kind carrying context. Maps (kind, ctx) → PaneContent +
  // a sensible label, then reuses `spawn` (so exit-fullscreen-on-spawn applies).
  const spawnPaneFromCtx = useCallback(
    (kind: SpawnPaneKind, ctx?: SpawnCtx) => {
      switch (kind) {
        case "terminal":
          // ctx.cmd (when present) seeds + runs a command in the new shell — the
          // shell pane's startup `cmd` fires once the PTY is ready, so a ChatPane
          // code-fence "run in terminal" lands its command without needing to look
          // the freshly-mounted pane up in the paneWriters registry.
          spawn({ type: "shell", cwd: ctx?.cwd, cmd: ctx?.cmd }, ctx?.label ?? "terminal");
          break;
        case "files": {
          const root = ctx?.path;
          const name = root ? pathBasename(root) || root : "files";
          spawn({ type: "files", root }, ctx?.label ?? `files · ${name}`);
          break;
        }
        case "browser":
          spawn({ type: "browser", url: ctx?.url }, ctx?.label ?? "browser");
          break;
        case "chat":
          spawn({ type: "chat", cwd: ctx?.cwd }, ctx?.label ?? "chat");
          break;
      }
    },
    [spawn],
  );
  // expose openFile to deep children (chat artifact cards) via paneBus, so a
  // produced file opens as an in-app viewer pane instead of the OS app.
  useEffect(() => registerOpenFile(openFile), [openFile]);
  useEffect(() => registerOpenEditorFile(openEditorFile), [openEditorFile]);
  useEffect(() => registerOpenViewerFile(openViewerFile), [openViewerFile]);
  useEffect(() => registerRevealFile(revealFile), [revealFile]);
  useEffect(() => registerOpenUrl(openUrl), [openUrl]);
  useEffect(() => registerSpawnPane(spawnPaneFromCtx), [spawnPaneFromCtx]);
  useEffect(
    () =>
      registerOpenSettings((section) => {
        setSettingsSection(section);
        setSettingsOpen(true);
      }),
    [],
  );

  const handledStartupOpen = useRef(false);
  useEffect(() => {
    if (handledStartupOpen.current) return;
    handledStartupOpen.current = true;
    startupOpenPane()
      .then((target) => {
        if (!target) return;
        if (isHttpPaneTarget(target)) openUrl(target);
        else {
          const path = resolvePaneFileTarget(target);
          openFile(path, targetLabel(path));
        }
      })
      .catch((e) => reportDiag("app.startup", e, { action: "openPane" }));
  }, [openFile, openUrl]);

  // F5 / Run — detect the project around the last-opened file (or $HOME) and
  // spawn a terminal running its default command in the project dir (logs +
  // flutter's own `r` hot-reload work right in that terminal, like VS Code).
  const runF5 = useCallback(async () => {
    try {
      const base = lastOpenPath.current ?? (await homeDir());
      const proj = await detectProject(base);
      if (!proj.root || !proj.commands.length) {
        flash("no runnable project found near the open file");
        return;
      }
      const c = proj.commands[0];
      spawn({ type: "shell", cmd: c.cmd, cwd: proj.root }, `▶ ${c.label}`);
      flash(`▶ ${c.cmd}`);
    } catch (e) {
      flash(`run failed: ${e}`);
    }
  }, [spawn, flash]);
  const addShell = useCallback(() => spawn({ type: "shell" }, "terminal"), [spawn]);
  // ⌘T / "New Pane" is CONTEXT-AWARE (R2a FIX 2): if the active/focused pane is a
  // BROWSER, ⌘T opens a fresh browser pane (tab=pane muscle memory) instead of a
  // terminal; otherwise it falls back to the normal new-terminal behavior. Reads
  // the live pane type so the menu accelerator and the keydown fallback agree.
  const newPaneForContext = useCallback(() => {
    const k = activeKey ?? focusedPane.current;
    const active = k ? panes.find((p) => p.key === k) : null;
    if (active?.kind.type === "browser") {
      spawn({ type: "browser" }, "browser");
    } else {
      addShell();
    }
  }, [activeKey, panes, addShell, spawn]);
  const addOracle = useCallback(
    (identity: string) => spawn({ type: "oracle", identity }, identity),
    [spawn],
  );
  const addTmux = useCallback(
    (socket: string, session: string) => spawn({ type: "tmux", socket, session }, session),
    [spawn],
  );
  const closePane = useCallback((key: string) => {
    // Double-close guard: the exit beat below means a second click can land
    // while the pane is already dying.
    if (closingPanesRef.current.has(key)) return;
    // If the pane being closed owns the OS fullscreen (e.g. a maximized browser
    // pane with a video in fullscreen), drop fullscreen first — otherwise the
    // window stays fullscreen with the owning pane gone ("bugs out on close").
    setMaximizedKey((m) => {
      if (m === key) setWindowFullscreen(false).catch((e) => reportDiag("app.window", e, { action: "exitFullscreen" }));
      return m === key ? null : m;
    });
    if (prevMaxRef.current === key) prevMaxRef.current = null;
    if (focusedPane.current === key) focusedPane.current = null;
    const remove = () => {
      closingPanesRef.current.delete(key);
      setClosingKeys((c) => c.filter((k) => k !== key));
      // Drop any session-restore memory for this pane key — a pane closed on
      // purpose shouldn't have its last url linger in the browser-mem map (it
      // also won't be in the next layout, so this just keeps the map from
      // accumulating dead entries). No-op for non-browser keys.
      forgetUrl(key);
      setPanes((p) => p.filter((x) => x.key !== key));
      setHiddenKeys((h) => h.filter((k) => k !== key));
      setActiveKey((a) => (a === key ? null : a));
    };
    // Exit beat: flag the pane so PaneCard plays .pane-exit (fade+scale, App.css),
    // then actually remove — the grid-reflow transition glides the survivors in.
    // Under reduce-motion remove immediately (the animation is killed anyway —
    // don't hold a frozen pane for 170ms).
    if (document.documentElement.dataset.reduceMotion === "true") {
      remove();
      return;
    }
    closingPanesRef.current.add(key);
    setClosingKeys((c) => [...c, key]);
    setTimeout(remove, 170);
  }, []);
  // Closing a chat pane whose claude is mid-task → prompt to keep it running in
  // the background (with optional done-notification) instead of killing it.
  const requestClose = useCallback(
    (key: string) => {
      const handle = chatHandles.get(key);
      if (handle?.busy()) {
        setClosePrompt(key);
        return;
      }
      closePane(key);
    },
    [closePane],
  );
  const resumeChat = useCallback(
    (s: ChatSessionInfo) =>
      spawn(
        // carry engine+model so a resumed codex thread boots on codex, not claude
        { type: "chat", resume: { id: s.id, title: s.title, engine: s.engine, model: s.model } },
        s.title || "chat",
      ),
    [spawn],
  );

  // Shared live data for the idle homescreen + the ⌘K palette: the fleet and the
  // recent chats to resume. One source, polled gently; every getter is defensive
  // so a missing backend just yields an empty list.
  const [oracles, setOracles] = useState<OracleInfo[]>([]);
  const [chats, setChats] = useState<ChatSessionInfo[]>([]);
  const [liveChats, setLiveChats] = useState<LiveChat[]>([]);
  const [moneyAgentSessionVersion, setMoneyAgentSessionVersion] = useState(0);
  // every runnable project under ~/Repo (auto-scanned), merged with the user's
  // project store (custom adds / hides / name+cmd overrides — CRUD from Settings).
  const [scanned, setScanned] = useState<ProjectInfo[]>([]);
  const [projStore, setProjStore] = useState(loadProjectsStore);
  useEffect(() => subscribeProjects(() => setProjStore(loadProjectsStore())), []);
  const projects = useMemo(() => mergeProjects(scanned, projStore), [scanned, projStore]);
  const [home, setHome] = useState<string>("");
  useEffect(() => {
    let alive = true;
    const load = () => {
      listOracles().then((v) => alive && setOracles(v)).catch((e) => reportDiag("app.load", e, { action: "oracles" }));
      listChatSessions(12).then((v) => alive && setChats(v)).catch((e) => reportDiag("app.load", e, { action: "chatSessions" }));
      listChatLive().then((v) => alive && setLiveChats(v)).catch((e) => reportDiag("app.load", e, { action: "chatLive" }));
      if (alive) setMoneyAgentSessionVersion(Date.now());
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  // Discover every runnable project under ~/Repo once on mount so each one gets
  // its own ⌘K "run <name>" entry. Cheap (bounded scan), so no polling — a stale
  // list just misses a brand-new repo until next launch.
  const loadProjects = useCallback((announce = false) => {
    listProjects()
      .then((next) => {
        setScanned(next);
        if (announce) flash(`rescanned ${next.length} project${next.length === 1 ? "" : "s"}`);
      })
      .catch((e) => {
        if (announce) flash(`project rescan failed: ${e}`);
      });
  }, [flash]);
  useEffect(() => {
    homeDir().then(setHome).catch((e) => reportDiag("app.load", e, { action: "homeDir" }));
    loadProjects();
  }, [loadProjects]);

  // Root for ⌘P file-finder + ⌘⇧F global search. Priority: the active/focused
  // files pane's root → the dir of the last-opened file → $HOME. So the finder
  // searches the project you're actually working in, like VS Code's workspace.
  const finderRoot = useMemo(() => {
    const k = activeKey ?? focusedPane.current;
    const active = k ? panes.find((p) => p.key === k) : null;
    if (active?.kind.type === "files" && active.kind.root) return active.kind.root;
    const filesPane = panes.find((p) => p.kind.type === "files" && p.kind.root);
    if (filesPane && filesPane.kind.type === "files" && filesPane.kind.root) return filesPane.kind.root;
    if (lastOpenPath.current) return containingDir(lastOpenPath.current);
    return home;
  }, [panes, activeKey, home]);

  // spawn a run terminal for a discovered project, exactly like F5 (logs stream
  // + flutter `r` hot-reload work in-pane). Uses the project's primary command.
  const runProject = useCallback(
    (p: ProjectInfo) => {
      const c = p.commands[0];
      if (!c) {
        spawn({ type: "shell", cwd: p.root }, `terminal · ${p.name}`);
        flash(`opened ${p.name}`);
        return;
      }
      spawn({ type: "shell", cmd: c.cmd, cwd: p.root }, `▶ ${p.name}`);
      flash(`▶ ${c.cmd}`);
    },
    [spawn, flash],
  );

  const fireAppshot = useCallback(async () => {
    try {
      const path = await appshot();
      flash(`appshot → master oracle · ${pathBasename(path)}`);
    } catch (e) {
      flash(`appshot failed: ${e}`);
    }
  }, [flash]);

  // Focus a pane from the "OPEN" rail: restore it if minimized, mark it active
  // so dictation / drops target it (and the rail row highlights).
  const focusPane = useCallback((key: string) => {
    setHiddenKeys((h) => h.filter((k) => k !== key));
    focusedPane.current = key;
    setActiveKey(key);
  }, []);
  // Keep the open-file-dedup refs pointed at the freshest panes + focusPane.
  useEffect(() => {
    panesRef.current = panes;
  }, [panes]);
  useEffect(() => {
    focusPaneRef.current = focusPane;
  }, [focusPane]);
  // Rename a pane (double-click its OPEN-rail row) — persists via the layout save.
  const renamePane = useCallback((key: string, label: string) => {
    const v = label.trim();
    if (!v) return;
    setPanes((p) => p.map((x) => (x.key === key ? { ...x, label: v } : x)));
  }, []);
  const handleTranscript = useCallback(
    (text: string) => {
      const k = focusedPane.current;
      const w = k ? paneWriters.get(k) : null;
      if (w) {
        w(text.endsWith(" ") ? text : `${text} `);
        flash("dictated → pane");
      } else {
        navigator.clipboard?.writeText(text).catch((e) => reportDiag("app.clipboard", e, { action: "dictate" }));
        flash(`transcribed → ${chord("V")} to paste`);
      }
    },
    [flash],
  );

  // Browser annotations / selections → into a chat pane (the shell loop).
  const routeToChat = useCallback(
    (text: string) => {
      const chatPane = panes.find((p) => p.kind.type === "chat");
      const w = chatPane ? paneWriters.get(chatPane.key) : null;
      if (w) {
        w(text);
        flash("→ chat");
      } else {
        navigator.clipboard?.writeText(text).catch((e) => reportDiag("app.clipboard", e, { action: "toChat" }));
        spawn({ type: "chat" }, "chat");
        flash(`opened chat · annotation copied (${chord("V")})`);
      }
    },
    [panes, flash, spawn],
  );

  // Route an image FILE (absolute path) to the active chat as a vision attachment
  // — the screenshot sibling of routeToChat. Reuses the same pane image-sink the
  // OS file-drop path uses (chat → thumbnail chip). When no chat is open, spawn
  // one and attach as soon as its sink registers (the spawn returns the new key,
  // so we target it directly rather than guessing).
  const routeImageToChat = useCallback(
    (path: string) => {
      const chatPane = panes.find((p) => p.kind.type === "chat");
      const existing = chatPane ? paneImageDrop.get(chatPane.key) : null;
      if (existing) {
        existing([path]);
        flash("→ chat");
        return;
      }
      const key = spawn({ type: "chat" }, "chat");
      let tries = 0;
      const iv = setInterval(() => {
        tries += 1;
        const sink = paneImageDrop.get(key);
        if (sink) {
          sink([path]);
          flash("→ chat");
          clearInterval(iv);
        } else if (tries > 30) {
          clearInterval(iv); // ~3s give-up; chat never came up
        }
      }, 100);
    },
    [panes, flash, spawn],
  );

  // "Send to AI" (notes pane → the configured default AI). Routes by the
  // `defaultAi` setting: codex/claude terminal, a plain terminal, or the
  // in-app chat. Reuses each pane's SUBMITTER (paneSubmitters)
  // so the text is pasted AND actually sent (terminal: text + Enter; chat: real
  // submit). Restores a minimized target, or spawns a fresh pane and fires once
  // it's live (claude's TUI needs a beat to boot, so a freshly-spawned terminal
  // gets a delayed submit).
  const sendToAi = useCallback(
    (text: string) => {
      const body = text.trim();
      if (!body) return;
      const ai = loadSettings().defaultAi;

      // submit into an EXISTING pane (restore it from minimized first).
      const fireExisting = (key: string): boolean => {
        const s = paneSubmitters.get(key);
        if (!s) return false;
        setHiddenKeys((h) => h.filter((k) => k !== key));
        focusedPane.current = key;
        setActiveKey(key);
        s(body);
        return true;
      };

      // spawn a fresh pane, then poll for its submitter and fire (after a boot
      // grace for CLI TUIs like claude that aren't ready the instant they mount).
      const spawnAndFire = (kind: PaneContent, label: string, bootMs: number) => {
        const key = spawn(kind, label);
        let tries = 0;
        const tick = () => {
          const s = paneSubmitters.get(key);
          if (s) {
            setTimeout(() => s(body), bootMs);
            return;
          }
          if (tries++ < 50) setTimeout(tick, 150);
        };
        tick();
      };

      if (ai === "chat") {
        const cp = panes.find((p) => p.kind.type === "chat");
        if (cp && fireExisting(cp.key)) {
          flash("sent → chat");
          return;
        }
        // a fresh chat auto-sends its `seed` once claude is ready — cleanest path.
        spawn({ type: "chat", seed: body }, "chat");
        flash("sent → new chat");
        return;
      }

      // codex-code / claude-code: a shell pane whose command launches that
      // agent runtime. terminal: any plain shell pane (no agent command).
      const wantCodex = ai === "codex-code";
      const wantClaude = ai === "claude-code";
      const match = panes.find(
        (p) =>
          p.kind.type === "shell" &&
          (wantCodex
            ? (p.kind.cmd ?? "").includes("codex")
            : wantClaude
              ? (p.kind.cmd ?? "").includes("claude")
              : !(p.kind.cmd ?? "").includes("claude") && !(p.kind.cmd ?? "").includes("codex")),
      );
      if (match && fireExisting(match.key)) {
        flash(wantCodex ? "sent → codex" : wantClaude ? "sent → claude code" : "sent → terminal");
        return;
      }
      // none open → spawn the right one and fire when it's live.
      if (wantCodex) {
        spawnAndFire(
          { type: "shell", cmd: codexShellCommand(loadSettings().chatModel) },
          "codex",
          3200,
        );
        flash("opening codex → sending…");
      } else if (wantClaude) {
        spawnAndFire(
          { type: "shell", cmd: "claude --dangerously-skip-permissions" },
          "claude code",
          3200,
        );
        flash("opening claude code → sending…");
      } else {
        spawnAndFire({ type: "shell" }, "terminal", 600);
        flash("opening terminal → sending…");
      }
    },
    [panes, flash, spawn],
  );

  // ---- keyboard: ⌘B sidebar · ⌘K palette · ⌘T terminal · ⌘, settings · ⌘⌘ appshot
  const lastMeta = useRef(0);
  // live commands list for the repeat-last chord (ref: the keydown listener
  // must not re-bind every time the registry rebuilds).
  const commandsRef = useRef<Command[]>([]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === "k") {
        // ⌘⇧K / Ctrl+Shift+K — repeat the last palette command. Power users
        // live on repetition; the MRU the palette already records makes this
        // a one-keystroke re-fire (appshot loops, run-project loops…).
        e.preventDefault();
        const [lastId] = loadCommandMru();
        const cmd = lastId ? commandsRef.current.find((c) => c.id === lastId) : undefined;
        if (cmd) {
          flash(`repeat: ${cmd.title}`);
          cmd.run();
        } else {
          flash("nothing to repeat yet — run something from the palette first");
        }
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        // ⌘⇧F — global content search (must come BEFORE the bare ⌘F fullscreen
        // branch below, which also keys on "f").
        e.preventDefault();
        setGlobalSearchOpen((v) => !v);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "p") {
        // ⌘P — fuzzy file finder ("go to file"). firaz's #1 pain.
        e.preventDefault();
        setFileFinderOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((v) => !v);
      } else if (mod && (e.key.toLowerCase() === "t" || e.key.toLowerCase() === "n")) {
        // ⌘T / ⌘N — new pane (context-aware: browser pane focused → new browser
        // pane; otherwise a new terminal).
        e.preventDefault();
        newPaneForContext();
      } else if (mod && e.key === ".") {
        // ⌘. / Ctrl+. — focus spotlight: dim every pane but the active one so
        // a busy grid collapses into the thing you're working in.
        e.preventDefault();
        setFocusSpotlight((v) => {
          flash(v ? "spotlight off" : "spotlight — focused pane only");
          return !v;
        });
      } else if (mod && e.key.toLowerCase() === "r") {
        // ⌘R — reload the cockpit fresh (re-init theme, re-poll all live data).
        e.preventDefault();
        window.location.reload();
      } else if (mod && e.key.toLowerCase() === "w") {
        // ⌘W — close the focused pane (mac muscle memory). Falls back to the
        // active pane; no-op when nothing's focused.
        e.preventDefault();
        const k = focusedPane.current ?? activeKey;
        if (k) requestClose(k);
      } else if ((mod && e.key === "`") || (e.ctrlKey && e.key === "ArrowUp")) {
        // ⌘` / Ctrl+↑ — toggle the mission-control pane overview (switch panes).
        // Ctrl+↑ mirrors macOS Mission Control; ⌘` mirrors window-cycle.
        e.preventDefault();
        if (panes.length > 0) setOverviewOpen((v) => !v);
      } else if (mod && e.key.toLowerCase() === "f") {
        // ⌘F — context-aware: browser pane focused → find-in-page; else fullscreen
        // the selected pane. Only preventDefault when we actually handled it.
        if (handleCmdF()) e.preventDefault();
      } else if (mod && e.key.toLowerCase() === "m") {
        // ⌘M — minimize (hide) the selected pane to the OPEN rail. ⇧ restores all.
        e.preventDefault();
        if (e.shiftKey) {
          setHiddenKeys([]);
          setMaximizedKey(null);
        } else {
          const k = activeKey ?? focusedPane.current;
          if (k) toggleHide(k);
        }
      } else if (mod && /^[1-9]$/.test(e.key)) {
        // ⌘1..9 — jump to the Nth open pane (restore + select it).
        e.preventDefault();
        const idx = Number(e.key) - 1;
        const p = panes[idx];
        if (p) focusPane(p.key);
      } else if (mod && (e.key === "?" || (e.shiftKey && e.key === "/"))) {
        // ⌘? / Ctrl+? — the shortcut HUD (every chord, one overlay, from the
        // single shortcuts.ts catalog).
        e.preventDefault();
        setShortcutHudOpen((v) => !v);
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setSettingsOpen(true);
      } else if (e.key === "F5") {
        // F5 — run the current project (VS Code's start-debugging muscle memory)
        e.preventDefault();
        runF5();
      } else if (e.key === "Escape" && maximizedKey) {
        // Esc — exit a maximized/fullscreen pane.
        setWindowFullscreen(false).catch((e) => reportDiag("app.window", e, { action: "exitFullscreen" }));
        setMaximizedKey(null);
      }
      // ⌘ double-tap appshot is macOS-only (the capture backend is SCK); on
      // Windows "Meta" is the Win key — firing there opened a dead feature.
      if (isApple && e.key === "Meta") {
        const now = e.timeStamp || performance.now();
        if (now - lastMeta.current < 400) {
          lastMeta.current = 0;
          fireAppshot();
        } else {
          lastMeta.current = now;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [addShell, newPaneForContext, fireAppshot, runF5, handleCmdF, requestClose, toggleHide, focusPane, activeKey, maximizedKey, panes]);

  // NATIVE MENU BRIDGE (R2a FIX 1 — the urgent fix). The `window.keydown` handler
  // above only fires when the REACT webview has focus. When focus is inside a
  // native child webview — a browser PANE (its own WKWebView) or a terminal
  // (xterm grabs keys) — those keystrokes never reach React, so Esc/⌘F/⌘W/⌘1-9/…
  // all DIE exactly when a pane is focused (firaz got stuck unable to exit a
  // fullscreen pane). A real app-MENU accelerator fires whenever the app is
  // frontmost REGARDLESS of which webview holds focus, so the Rust menu emits
  // `menu-action` and we dispatch into the SAME handlers as the keydown fallback.
  // The keydown handler stays as the in-React path; the handlers are idempotent
  // (functional setState / focusPane) so a double-fire is harmless.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ action: string; arg?: number | null }>("menu-action", ({ payload }) => {
      const { action } = payload;
      switch (action) {
        case "exit-fullscreen": {
          // THE URGENT PATH: unconditionally drop OS fullscreen + clear the
          // maximized pane. Works even when a browser webview has focus because
          // it arrives via the native menu, not a webview keystroke.
          setWindowFullscreen(false).catch((e) => reportDiag("app.window", e, { action: "exitFullscreen" }));
          setMaximizedKey(null);
          break;
        }
        case "toggle-fullscreen":
          // ⌘F via the native menu — context-aware: browser pane focused →
          // find-in-page; else maximize/restore the pane (the path firaz hit).
          // This is the webview-independent route (fires even when a child
          // webview holds focus), so ⌘F find works inside a focused browser pane.
          handleCmdF();
          break;
        case "open-devtools": {
          // DevTools for the focused browser pane (native menu item).
          const sel = activeKey ?? focusedPane.current;
          const target =
            panes.find((p) => p.key === sel) ??
            panes.find((p) => p.kind.type === "browser") ??
            null;
          if (target?.kind.type === "browser") browserOpenDevtools(target.key).catch((e) => reportDiag("app.browser", e, { action: "openDevtools" }));
          break;
        }
        case "new":
          newPaneForContext();
          break;
        case "close": {
          const k = focusedPane.current ?? activeKey;
          if (k) requestClose(k);
          break;
        }
        case "palette":
          setPaletteOpen((v) => !v);
          break;
        case "file-finder":
          setFileFinderOpen((v) => !v);
          break;
        case "global-search":
          setGlobalSearchOpen((v) => !v);
          break;
        case "sidebar":
          setSidebarOpen((v) => !v);
          break;
        case "minimize": {
          const k = activeKey ?? focusedPane.current;
          if (k) toggleHide(k);
          break;
        }
        case "overview":
          if (panes.length > 0) setOverviewOpen((v) => !v);
          break;
        case "jump": {
          const idx = (payload.arg ?? 0) - 1;
          const p = idx >= 0 ? panes[idx] : null;
          if (p) focusPane(p.key);
          break;
        }
        default:
          break;
      }
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e) => reportDiag("app.listen", e, { action: "menuAction" }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [
    handleCmdF,
    newPaneForContext,
    requestClose,
    toggleHide,
    focusPane,
    activeKey,
    panes,
  ]);

  // Native OS drag-drop (Finder files/folders, e.g. a screenshot) → route to the
  // targeted pane. Because `dragDropEnabled` is true, macOS intercepts file drops
  // natively and the webview's HTML5 drag events never fire — so this Tauri
  // handler is the ONLY path for OS files (the in-app `application/x-aios-path`
  // handler on the panes covers Files-pane drags).
  useEffect(() => {
    if (!isTauriRuntime()) return;
    // Resolve the pane key under a physical (device-pixel) drop position via the
    // canonical pane-rect registry — robust over native child WKWebViews (which
    // `document.elementFromPoint` cannot resolve, so a browser pane was a dead
    // zone). Tauri reports the drop position in PHYSICAL pixels; the registry's
    // rects are in CSS pixels, so divide by the device-pixel ratio.
    const paneKeyAt = (x: number, y: number): string | null => {
      const dpr = window.devicePixelRatio || 1;
      return paneKeyAtPoint(x / dpr, y / dpr);
    };

    const un = getCurrentWebview().onDragDropEvent((event) => {
      const p = event.payload;
      if (p.type === "enter" || p.type === "over") {
        // live highlight on the pane that would receive the drop.
        const key = paneKeyAt(p.position.x, p.position.y);
        setDropTargetKey((cur) => (cur === key ? cur : key));
        return;
      }
      if (p.type === "leave") {
        setDropTargetKey(null);
        return;
      }
      if (p.type !== "drop") return;
      setDropTargetKey(null);
      const { paths, position } = p;
      if (!paths?.length) return;
      const dropKey = paneKeyAt(position.x, position.y);
      // 1) A pane-specific drop sink (browser → navigate to file://, editor/
      // viewer → open it) gets first crack — it owns the meaning of "a file
      // dropped on me". Falls through to the writer logic only if it declines.
      if (dropKey) {
        const sink = paneDropSink.get(dropKey);
        if (sink && sink(paths)) {
          flash(`dropped ${paths.length} item${paths.length > 1 ? "s" : ""}`);
          return;
        }
      }
      // 2) Prefer the pane under the cursor; fall back to the focused pane so a
      // drop that lands on a gap / title bar still inserts (screenshots are easy
      // to miss-aim). Only fall back to a real terminal-backed pane.
      let key = dropKey;
      if (!key || !paneWriters.get(key)) {
        const fk = focusedPane.current;
        if (fk && paneWriters.get(fk)) key = fk;
      }
      const w = key ? paneWriters.get(key) : null;
      if (!w) {
        flash("open a terminal pane, then drop the file to insert its path");
        return;
      }
      // Split image files from the rest: images go to the pane's IMAGE sink (chat
      // → thumbnail chip, ready to send for vision), everything else inserts as a
      // quoted path. A pane with no image sink (a terminal) just gets all paths
      // as text, same as before.
      // Only formats the vision APIs actually accept. svg/bmp/heic/tiff would be
      // tagged image/png and rejected — corrupting the whole turn — so let them
      // fall through to the path-insert writer instead of attaching as an image.
      const isImage = (p: string) => /\.(png|jpe?g|gif|webp)$/i.test(p);
      const imgs = paths.filter(isImage);
      const rest = paths.filter((p) => !isImage(p));
      const imgSink = key ? paneImageDrop.get(key) : null;
      if (imgs.length && imgSink) {
        imgSink(imgs);
      } else if (imgs.length) {
        // no image sink on this pane → fall back to inserting their paths as text.
        rest.push(...imgs);
      }
      if (rest.length) {
        const text = rest
          .map((path) => (/[\s'"\\]/.test(path) ? `'${path.replace(/'/g, "'\\''")}' ` : `${path} `))
          .join("");
        w(text);
      }
      flash(`dropped ${paths.length} item${paths.length > 1 ? "s" : ""}`);
    });
    return () => {
      void un.then((f) => f()).catch((e) => reportDiag("app.listen", e, { action: "unlisten" }));
    };
  }, [flash]);

  // grid is sized to the VISIBLE panes — hidden ones are display:none (out of
  // grid flow), so they leave no empty cell behind.
  const visibleCount = panes.length - hiddenKeys.length;
  const { cols, rows } = useMemo(() => {
    const n = visibleCount || 1;
    if (compactWebLayout) return { cols: 1, rows: n };
    const c = Math.ceil(Math.sqrt(n));
    return { cols: c, rows: Math.ceil(n / c) };
  }, [visibleCount, compactWebLayout]);

  // ── workspaces: named pane layouts (save / restore / delete via palette) ───
  const saveCurrentWorkspace = useCallback(
    (name: string) => {
      const clean = name.trim();
      if (!clean || panes.length === 0) return;
      const saved = panes
        .map((p) => {
          const kind = persistableKind(p.kind);
          return kind ? { key: p.key, label: p.label, kind } : null;
        })
        .filter((p): p is { key: string; label: string; kind: PaneContent } => p != null);
      saveWorkspace({
        name: clean,
        savedAt: Date.now(),
        panes: saved,
        // current fr fractions for THIS grid shape (null = never resized)
        tracks: loadGridTracks(gridTrackStorageKey(GRID_TRACK_KEY, cols, rows), cols, rows),
      });
      flash(`workspace “${clean}” saved`);
    },
    [panes, cols, rows, flash],
  );

  // "pick up where you left off" on the idle home: when every pane is hidden
  // (e.g. via the sidebar home anchor) the pill un-hides them all; when none
  // are open but a layout survives in storage (boot with reopenLastLayout off)
  // it rehydrates that layout. Hidden-all is the common case — close-all wipes
  // the stored layout by design, so there's rarely a stale restore to offer.
  const allPanesHidden = panes.length > 0 && panes.every((p) => hiddenKeys.includes(p.key));
  const storedLayout = useMemo(() => (panes.length === 0 ? loadLayout() : []), [panes.length]);
  const resumeLayoutInfo = useMemo(() => {
    if (allPanesHidden) return { count: panes.length, labels: panes.map((p) => p.label) };
    if (panes.length === 0 && storedLayout.length > 0) {
      return { count: storedLayout.length, labels: storedLayout.map((p) => p.label) };
    }
    return null;
  }, [allPanesHidden, panes, storedLayout]);
  const onResumeLayout = useCallback(() => {
    if (panes.length > 0) {
      setHiddenKeys([]);
      const first = panes[0]?.key ?? null;
      focusedPane.current = first;
      setActiveKey(first);
      return;
    }
    if (storedLayout.length === 0) return;
    setPanes(storedLayout);
    setHiddenKeys([]);
    const first = storedLayout[0]?.key ?? null;
    focusedPane.current = first;
    setActiveKey(first);
  }, [panes, storedLayout]);

  const applyWorkspace = useCallback(
    (ws: Workspace) => {
      const hydrated = hydrateSavedPanes(ws.panes);
      if (hydrated.length === 0) return;
      // busy chats in panes being swapped out keep running in the background
      // (the close-prompt's primary path), with the done-notification.
      const keep = new Set(hydrated.map((p) => p.key));
      for (const p of panes) {
        if (keep.has(p.key)) continue;
        const h = chatHandles.get(p.key);
        if (h?.busy()) h.detach(true);
      }
      // seed the track store for the TARGET grid shape before the panes land,
      // so ResizableGrid's shape-reset effect reads the workspace's fractions
      // (and the reflow transition glides the grid there).
      if (ws.tracks) {
        const n = hydrated.length;
        const c = compactWebLayout ? 1 : Math.ceil(Math.sqrt(n));
        const r = compactWebLayout ? n : Math.ceil(n / c);
        if (ws.tracks.cols.length === c && ws.tracks.rows.length === r) {
          saveGridTracks(gridTrackStorageKey(GRID_TRACK_KEY, c, r), ws.tracks.cols, ws.tracks.rows);
        }
      }
      setMaximizedKey((m) => {
        // a maximized pane may own OS fullscreen — drop it with the maximize
        if (m) setWindowFullscreen(false).catch((e) => reportDiag("app.window", e, { action: "exitFullscreen" }));
        return null;
      });
      setHiddenKeys([]);
      setPanes(hydrated);
      const first = hydrated[0]?.key ?? null;
      focusedPane.current = first;
      setActiveKey(first);
      flash(`workspace “${ws.name}” restored`);
    },
    [panes, compactWebLayout, flash],
  );

  const removeWorkspace = useCallback(
    (name: string) => {
      deleteWorkspace(name);
      flash(`workspace “${name}” deleted`);
    },
    [flash],
  );

  const commands: Command[] = useMemo(() => {
    return buildAppCommands({
      notify: flash,
      activeKey,
      panesCount: panes.length,
      home,
      chats,
      oracles,
      projects,
      spawn,
      resumeChat,
      addOracle,
      runProject,
      runF5,
      reloadProjects: () => loadProjects(true),
      fireAppshot,
      setSidebarOpen,
      setTopBarMode: (mode) => {
        setTopBarMode(mode);
        saveSettings({ topBarMode: mode });
      },
      setOverviewOpen,
      setSettingsOpen,
      setHiddenKeys,
      setMaximizedKey,
      workspaces,
      openSaveWorkspace: () => setWsDraft(""),
      applyWorkspace,
      deleteWorkspace: removeWorkspace,
    });
  }, [spawn, fireAppshot, chats, oracles, resumeChat, addOracle, runF5, loadProjects, projects, home, runProject, panes.length, activeKey, workspaces, applyWorkspace, removeWorkspace]);
  // keep the repeat-last chord's view of the registry fresh without re-binding
  // the global keydown listener on every rebuild.
  commandsRef.current = commands;

  const agentController = useMemo(
    () =>
      createAgentController({
        getPanes: () =>
          panes.map((pane) => ({
            key: pane.key,
            label: pane.label,
            type: pane.kind.type,
            hidden: hiddenKeys.includes(pane.key),
            active: pane.key === activeKey,
          })),
        focusPane,
        hidePane: (key) => {
          setHiddenKeys((cur) => (cur.includes(key) ? cur : [...cur, key]));
          setMaximizedKey((cur) => (cur === key ? null : cur));
        },
        maximizePane: (key) => {
          setHiddenKeys((cur) => cur.filter((k) => k !== key));
          setMaximizedKey(key);
          focusedPane.current = key;
          setActiveKey(key);
        },
        closePane,
        setSidebarOpen,
        setOverviewOpen,
        setSettingsOpen,
        stopChat: (key) => chatHandles.get(key)?.stop?.(),
        detachChat: (key) => chatHandles.get(key)?.detach(true),
        audit: recordAgentAudit,
      }),
    [panes, hiddenKeys, activeKey, focusPane, closePane],
  );

  useEffect(() => {
    agentControllerRef.current = agentController;
  }, [agentController]);

  useEffect(() => {
    const dispatchAgentAction = (input: AgentDispatchInput) => agentController.dispatch(input);
    (window as typeof window & {
      __aiosAgentControl?: (
        action: unknown,
        options?: { source?: AgentDispatchInput["source"]; confirmed?: boolean },
      ) => Promise<AgentDispatchResult>;
    }).__aiosAgentControl = (action, options = {}) =>
      dispatchAgentAction({
        source: options.source ?? "codex",
        action,
        confirmed: options.confirmed,
      });

    const onAgentAction = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { requestId?: string; source?: AgentDispatchInput["source"]; action?: unknown; confirmed?: boolean }
        | undefined;
      const requestId = detail?.requestId ?? `agent-${Date.now()}`;
      void dispatchAgentAction({
        source: detail?.source ?? "codex",
        action: detail?.action,
        confirmed: detail?.confirmed,
      }).then((result) => {
        window.dispatchEvent(new CustomEvent("aios-agent-action-result", { detail: { requestId, result } }));
      });
    };

    window.addEventListener("aios-agent-action", onAgentAction);
    return () => {
      window.removeEventListener("aios-agent-action", onAgentAction);
      delete (window as typeof window & { __aiosAgentControl?: unknown }).__aiosAgentControl;
    };
  }, [agentController]);

  const mirrorSnapshot = useMemo(
    () =>
      buildMirrorSnapshot({
        panes,
        hiddenKeys,
        activeKey,
        maximizedKey,
        sidebarOpen,
        overviewOpen,
        settingsOpen,
      }),
    [panes, hiddenKeys, activeKey, maximizedKey, sidebarOpen, overviewOpen, settingsOpen],
  );

  useEffect(() => {
    const w = window as typeof window & {
      __aiosMirrorSnapshot?: () => MirrorSnapshot;
    };
    w.__aiosMirrorSnapshot = () => mirrorSnapshot;

    const emit = (requestId?: string) => {
      window.dispatchEvent(
        new CustomEvent("aios-mirror-snapshot", {
          detail: { requestId, snapshot: mirrorSnapshot },
        }),
      );
    };
    const onRequest = (event: Event) => {
      const detail = (event as CustomEvent).detail as { requestId?: string } | undefined;
      emit(detail?.requestId);
    };

    window.addEventListener("aios-mirror-request", onRequest);
    emit();
    return () => {
      window.removeEventListener("aios-mirror-request", onRequest);
      delete w.__aiosMirrorSnapshot;
    };
  }, [mirrorSnapshot]);

  useEffect(() => {
    if (!mirrorPairing) {
      setMirrorStatus("off");
      return;
    }

    let disposed = false;
    let retryTimer: number | null = null;
    let retry = 0;
    const role = nativeRuntime ? "desktop" : "viewer";

    const connect = () => {
      if (disposed) return;
      setMirrorStatus("connecting");
      const ws = new WebSocket(mirrorWebSocketUrl(mirrorPairing));
      mirrorWsRef.current = ws;

      ws.onopen = () => {
        retry = 0;
        mirrorOpenRef.current = true;
        setMirrorStatus("connected");
        ws.send(JSON.stringify({ type: "hello", role, token: mirrorPairing.token }));
        if (role === "desktop") {
          ws.send(JSON.stringify({ type: "snapshot", snapshot: mirrorSnapshot }));
        }
      };

      ws.onmessage = (event) => {
        const msg = parseMirrorSocketMessage(event.data);
        if (!msg) return;
        if ((msg.type === "hello" || msg.type === "presence") && msg.presence) {
          setMirrorPresence(msg.presence);
        }
        if ((msg.type === "hello" || msg.type === "snapshot") && "snapshot" in msg && !nativeRuntime) {
          setRemoteMirrorSnapshot((msg.snapshot as MirrorSnapshot | null) ?? null);
        }
        if (msg.type === "control" && nativeRuntime) {
          const requestId = msg.requestId;
          void agentControllerRef.current
            ?.dispatch({ source: "mirror", action: msg.action, confirmed: true })
            .then((result) => {
              if (mirrorWsRef.current?.readyState === WebSocket.OPEN) {
                mirrorWsRef.current.send(
                  JSON.stringify({ type: "control_result", requestId, result }),
                );
              }
            });
        }
      };

      ws.onerror = () => {
        setMirrorStatus("error");
      };

      ws.onclose = () => {
        if (mirrorWsRef.current === ws) mirrorWsRef.current = null;
        mirrorOpenRef.current = false;
        if (disposed) return;
        setMirrorStatus("error");
        retryTimer = window.setTimeout(connect, Math.min(10_000, 1000 + retry++ * 1500));
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer != null) window.clearTimeout(retryTimer);
      mirrorOpenRef.current = false;
      mirrorWsRef.current?.close(1000, "app closing");
      mirrorWsRef.current = null;
    };
    // connect once per pairing/role; snapshots publish through the separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nativeRuntime, mirrorPairing?.room, mirrorPairing?.token]);

  useEffect(() => {
    if (!nativeRuntime || !mirrorOpenRef.current || mirrorWsRef.current?.readyState !== WebSocket.OPEN) return;
    mirrorWsRef.current.send(JSON.stringify({ type: "snapshot", snapshot: mirrorSnapshot }));
  }, [nativeRuntime, mirrorSnapshot]);

  const sendMirrorControl = useCallback((action: AgentAction) => {
    if (!mirrorWsRef.current || mirrorWsRef.current.readyState !== WebSocket.OPEN) return;
    mirrorWsRef.current.send(
      JSON.stringify({
        type: "control",
        requestId: `mirror-${Date.now().toString(36)}`,
        action,
      }),
    );
  }, []);

  const unreadNotifications = notifications.filter((n) => !n.read).length;
  const notificationsPane = panes.find((pane) => pane.kind.type === "notifications");
  const notificationsActive = notificationsPane?.key === activeKey;
  const openNotificationsPane = useCallback(() => {
    const existing = panes.find((pane) => pane.kind.type === "notifications");
    if (existing) {
      focusPane(existing.key);
      return;
    }
    spawn({ type: "notifications" }, "notifications");
  }, [panes, focusPane, spawn]);
  const openNotificationTarget = useCallback((item: AiosNotification) => {
    markNotificationRead(item.id);
    const t = item.target;
    if (!t) return;
    switch (t.type) {
      case "pane":
      case "terminal": {
        const pane = panes.find((p) => p.key === t.key);
        if (pane) focusPane(pane.key);
        break;
      }
      case "chat": {
        // The killer case. If a chat pane is still open + bound to this backend
        // session id, focus it. Else reattach the detached session — the backend
        // replays its buffer and goes live, so firaz lands back in the exact chat.
        const boundKey = paneKeyForChatSession(t.sessionId);
        const open = boundKey ? panes.find((p) => p.key === boundKey) : undefined;
        if (open) focusPane(open.key);
        else spawn({ type: "chat", reattach: t.sessionId }, t.title ?? "chat");
        break;
      }
      case "diagnostics":
        openSettingsTo("diagnostics");
        break;
      case "file":
        if (t.mode === "reveal") revealFileInPane(t.path, t.name ?? t.path);
        else if (t.mode === "viewer") openViewerFileInPane(t.path, t.name ?? t.path);
        else openEditorFileInPane(t.path, t.name ?? t.path, t.at);
        break;
      case "url":
        openUrlInPane(t.url, t.label);
        break;
    }
  }, [panes, focusPane, spawn]);
  const askFromPalette = useCallback((query: string) => {
    spawn({ type: "chat", seed: query }, "ask");
  }, [spawn]);
  const talkToJarvis = useCallback((seed: string) => {
    spawn({ type: "chat", seed }, "chat");
  }, [spawn]);
  const openMoneyAgentChat = useCallback(
    (id: string, label: string, command?: string) => {
      const agent = moneyAgentById(id);
      if (!agent) return;
      const submitWhenReady = (key: string, text: string, reveal = false) => {
        let tries = 0;
        const tick = () => {
          const submit = paneSubmitters.get(key);
          if (submit) {
            if (reveal) {
              setHiddenKeys((current) => current.filter((value) => value !== key));
              focusedPane.current = key;
              setActiveKey(key);
            }
            submit(text);
            return;
          }
          if (tries++ < 60) setTimeout(tick, 150);
        };
        tick();
      };
      const existingPane = panes.find(
        (pane) => pane.kind.type === "chat" && pane.kind.agentId === agent.id,
      );
      if (existingPane) {
        if (command) submitWhenReady(existingPane.key, command);
        else focusPane(existingPane.key);
        return;
      }
      const live = liveChats.find(
        (chat) => chat.title === agent.label || chat.title === agent.shortLabel,
      );
      if (live) {
        const key = spawn(
          {
            type: "chat",
            reattach: live.id,
            modelId: agentChatModelId(),
            agentId: agent.id,
            agentLabel: agent.label,
          },
          label,
        );
        if (command) {
          setHiddenKeys((current) => (current.includes(key) ? current : [...current, key]));
          submitWhenReady(key, command);
        }
        return;
      }
      const saved = loadMoneyAgentChatSession(agent.id);
      if (saved) {
        const key = spawn(
          {
            type: "chat",
            resume: { id: saved.sessionId, title: saved.title },
            modelId: agentChatModelId(),
            agentId: agent.id,
            agentLabel: agent.label,
          },
          label,
        );
        if (command) {
          setHiddenKeys((current) => (current.includes(key) ? current : [...current, key]));
          submitWhenReady(key, command);
        }
        return;
      }
      const key = spawn(
        {
          type: "chat",
          seed: command ? `${buildMoneyAgentChatSeed(agent)}\n\noperator command:\n${command}` : buildMoneyAgentChatSeed(agent),
          modelId: agentChatModelId(),
          agentId: agent.id,
          agentLabel: agent.label,
        },
        label,
      );
      if (command) {
        setHiddenKeys((current) => (current.includes(key) ? current : [...current, key]));
      }
    },
    [focusPane, liveChats, panes, spawn],
  );
  const moneyAgentChatStates = useMemo(() => {
    const out: Partial<Record<(typeof MONEY_AGENTS)[number]["id"], MoneyAgentChatState>> = {};
    for (const agent of loadConfiguredMoneyAgents()) {
      const open = panes.some((pane) => pane.kind.type === "chat" && pane.kind.agentId === agent.id);
      const live = liveChats.some(
        (chat) => chat.title === agent.label || chat.title === agent.shortLabel,
      );
      const saved = loadMoneyAgentChatSession(agent.id);
      out[agent.id] = open ? "open" : live ? "running" : saved ? "saved" : "none";
    }
    return out;
  }, [liveChats, moneyAgentSessionVersion, panes]);
  const moneyAgentBootstrapRef = useRef(false);
  useEffect(() => {
    if (moneyAgentBootstrapRef.current || !nativeRuntime) return;
    moneyAgentBootstrapRef.current = true;
    for (const agent of loadConfiguredMoneyAgents()) {
      if (panes.some((pane) => pane.kind.type === "chat" && pane.kind.agentId === agent.id)) continue;
      const saved = loadMoneyAgentChatSession(agent.id);
      const key = spawn(
        saved
          ? {
              type: "chat",
              resume: { id: saved.sessionId, title: saved.title },
              modelId: agentChatModelId(),
              agentId: agent.id,
              agentLabel: agent.label,
            }
          : {
              type: "chat",
              seed: buildMoneyAgentChatSeed(agent),
              modelId: agentChatModelId(),
              agentId: agent.id,
              agentLabel: agent.label,
            },
        agent.label,
      );
      setHiddenKeys((current) => (current.includes(key) ? current : [...current, key]));
    }
  }, [nativeRuntime, panes, spawn]);
  useEffect(() => {
    if (!nativeRuntime) return;
    const cadenceMs = (schedule?: string): number | null => {
      const value = (schedule || "manual").toLowerCase();
      if (value.includes("manual")) return null;
      if (value.includes("hour")) return 60 * 60 * 1000;
      if (value.includes("always")) return 6 * 60 * 60 * 1000;
      if (value.includes("daily") || value.includes("work block")) return 24 * 60 * 60 * 1000;
      return null;
    };
    const lastRunKey = (id: string) => `aios.chatAgents.lastScheduledRun:${id}`;
    const submitHidden = (key: string, text: string) => {
      let tries = 0;
      const tick = () => {
        const submit = paneSubmitters.get(key);
        if (submit) {
          submit(text);
          return;
        }
        if (tries++ < 60) setTimeout(tick, 150);
      };
      tick();
    };
    const tick = () => {
      const now = Date.now();
      for (const agent of loadConfiguredMoneyAgents()) {
        const cadence = cadenceMs(agent.schedule);
        if (!cadence) continue;
        const key = lastRunKey(agent.id);
        const lastRun = Number(localStorage.getItem(key) || "0");
        if (lastRun && now - lastRun < cadence) continue;
        localStorage.setItem(key, String(now));
        const command = buildMoneyAgentRunCommand(agent, "scheduled");
        const existingPane = panes.find(
          (pane) => pane.kind.type === "chat" && pane.kind.agentId === agent.id,
        );
        if (existingPane) {
          submitHidden(existingPane.key, command);
          continue;
        }
        const live = liveChats.find(
          (chat) => chat.title === agent.label || chat.title === agent.shortLabel,
        );
        const saved = loadMoneyAgentChatSession(agent.id);
        const paneKey = spawn(
          live
            ? {
                type: "chat",
                reattach: live.id,
                modelId: agentChatModelId(),
                agentId: agent.id,
                agentLabel: agent.label,
              }
            : saved
              ? {
                  type: "chat",
                  resume: { id: saved.sessionId, title: saved.title },
                  modelId: agentChatModelId(),
                  agentId: agent.id,
                  agentLabel: agent.label,
                }
              : {
                  type: "chat",
                  seed: `${buildMoneyAgentChatSeed(agent)}\n\noperator command:\n${command}`,
                  modelId: agentChatModelId(),
                  agentId: agent.id,
                  agentLabel: agent.label,
                },
          agent.label,
        );
        setHiddenKeys((current) => (current.includes(paneKey) ? current : [...current, paneKey]));
        if (live || saved) submitHidden(paneKey, command);
      }
    };
    const start = setTimeout(tick, 5_000);
    const interval = setInterval(tick, 60_000);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [liveChats, nativeRuntime, panes, spawn]);
  const deepSearchFromPalette = useCallback((query: string) => {
    spawn({
      type: "chat",
      seed: `search the aios shell context for this and answer with the most useful result. use available tools, memory, files, and current panes when relevant.\n\nquery: ${query}`,
    }, "search");
  }, [spawn]);
  const topBarHidden = topBarMode === "hidden";
  const topBarLeft = (
    <div className="flex items-center gap-1">
      <IconBtn title={`Toggle sidebar (${chord("B")})`} onClick={() => setSidebarOpen((v) => !v)} active={sidebarOpen}>
        <PanelLeft size={15} />
      </IconBtn>
      <IconBtn title={`Command palette (${chord("K")})`} onClick={() => setPaletteOpen(true)}>
        <Search size={15} />
      </IconBtn>
      <IconBtn
        title={"Mission Control — show all panes (" + chord("`") + ")"}
        onClick={() => setOverviewOpen(true)}
        active={overviewOpen}
        disabled={panes.length === 0}
      >
        <Layers size={15} />
      </IconBtn>
    </div>
  );
  const topBarRight = (
    <div className="flex items-center gap-1">
      {mirrorUrl && (
        <IconBtn
          title={`Copy desktop mirror link · ${mirrorStatus}`}
          onClick={() => {
            navigator.clipboard?.writeText(mirrorUrl).catch((e) => reportDiag("app.clipboard", e, { action: "mirrorUrl" }));
            flash("mirror link copied");
          }}
          active={mirrorStatus === "connected"}
        >
          <MonitorUp size={15} />
        </IconBtn>
      )}
      <VoiceButton onTranscript={handleTranscript} />
      {isApple && (
        <IconBtn title={`Appshot — screenshot to oracle (${MOD} double-tap)`} onClick={fireAppshot}>
          <Camera size={15} />
        </IconBtn>
      )}
      <div className="relative" data-no-window-drag>
        <button
          type="button"
          onClick={openNotificationsPane}
          title="notifications"
          className={`relative rounded-md p-1.5 transition-colors ${
            notificationsActive
              ? "bg-[var(--color-panel-2)] text-[var(--color-accent)]"
              : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
          }`}
        >
          <Bell size={15} />
          {unreadNotifications > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[var(--color-danger)] px-1 text-[8px] font-bold leading-none text-[var(--color-bg)]">
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </button>
      </div>
    </div>
  );
  // Compact action row that lives in the SIDEBAR (the persistent chrome) now that
  // the hover top-bar pill is gone. Same handlers as the header variant; the
  // sidebar-toggle is dropped here (redundant inside the sidebar) and the
  // rarely-used desktop-mirror link moved into Settings → general.
  const sidebarActions = (
    <div className={`flex items-center ${iconsOnly ? "flex-col gap-0.5" : "gap-0.5"}`}>
      <IconBtn title={`Command palette (${chord("K")})`} onClick={() => setPaletteOpen(true)}>
        <Search size={15} />
      </IconBtn>
      <IconBtn
        title={"Mission Control — show all panes (" + chord("`") + ")"}
        onClick={() => setOverviewOpen(true)}
        active={overviewOpen}
        disabled={panes.length === 0}
      >
        <Layers size={15} />
      </IconBtn>
      <VoiceButton onTranscript={handleTranscript} />
      {isApple && (
        <IconBtn title={`Appshot — screenshot to oracle (${MOD} double-tap)`} onClick={fireAppshot}>
          <Camera size={15} />
        </IconBtn>
      )}
      <div className="relative" data-no-window-drag>
        <button
          type="button"
          onClick={openNotificationsPane}
          title="notifications"
          className={`relative rounded-md p-1.5 transition-colors ${
            notificationsActive
              ? "bg-[var(--color-panel-2)] text-[var(--color-accent)]"
              : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
          }`}
        >
          <Bell size={15} />
          {unreadNotifications > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[var(--color-danger)] px-1 text-[8px] font-bold leading-none text-[var(--color-bg)]">
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </button>
      </div>
    </div>
  );

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[var(--color-bg)] text-[var(--color-text)]">
      {splash && <Splash fading={splashFading} />}
      {!splash && onboardingOpen && (
        <Onboarding onClose={() => setOnboardingOpen(false)} />
      )}

      {topBarHidden ? (
        // No floating overlay — actions now live in the sidebar. Keep ONLY a thin
        // top drag strip so the window can still be moved by its top edge. 6px:
        // thin enough to sit inside the pane chrome's dead top padding, so the
        // first row's close/maximize buttons stay fully clickable.
        <div
          className="absolute left-0 right-0 top-0 z-40 h-1.5"
          data-tauri-drag-region
          onMouseDown={startWindowDrag}
        />
      ) : (
        <header
          className="glass flex h-7 shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-panel)]/45 pl-20 pr-2"
          data-tauri-drag-region
          onMouseDown={startWindowDrag}
        >
          {topBarLeft}
          <div className="min-w-4" data-tauri-drag-region />
          {topBarRight}
        </header>
      )}

      {/* body: sidebar + pane grid */}
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && !compactWebLayout && (
          <aside
            className={`flex shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-panel)] transition-[width] ${
              iconsOnly ? "w-16" : "w-60"
            }`}
          >
            <div
              className={`flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2 ${
                topBarHidden ? "pt-8" : ""
              }`}
            >
              {/* home anchor — the brand mark is also the way BACK: one click
                  rests every pane to the idle home (they stay in the OPEN list
                  to restore). Previously the only route was hiding panes one
                  by one. */}
              {panes.length > 0 && panes.some((p) => !hiddenKeys.includes(p.key)) && (
                <button
                  type="button"
                  onClick={() => {
                    setMaximizedKey((m) => {
                      if (m) setWindowFullscreen(false).catch((e) => reportDiag("app.window", e, { action: "exitFullscreen" }));
                      return null;
                    });
                    setHiddenKeys(panes.map((p) => p.key));
                  }}
                  title="back to the idle home (panes stay restorable in OPEN)"
                  className={`group flex shrink-0 items-center rounded-md px-2 py-1 text-left transition-colors hover:bg-[var(--color-panel-2)] ${
                    iconsOnly ? "justify-center" : "gap-2"
                  }`}
                >
                  <Home size={13} className="shrink-0 text-[var(--color-muted)] transition-colors group-hover:text-[var(--color-text)]" />
                  {!iconsOnly && (
                    <span className="font-mono text-[11px] tracking-[0.14em] text-[var(--color-muted)] transition-colors group-hover:text-[var(--color-text)]">
                      aios
                    </span>
                  )}
                </button>
              )}
              {panes.length > 0 && (
                <OpenPanesList
                  panes={panes}
                  hiddenKeys={hiddenKeys}
                  maximizedKey={maximizedKey}
                  activeKey={activeKey}
                  iconsOnly={iconsOnly}
                  onSelect={focusPane}
                  onToggleHide={toggleHide}
                  onClose={requestClose}
                  onRename={renamePane}
                  onOpenOverview={() => setOverviewOpen(true)}
                />
              )}
              <SidebarRail
                state={sidebar}
                iconsOnly={iconsOnly}
                onSpawn={spawnSidebarItem}
                onPinSite={(spaceId) => setPinSiteSpace(spaceId)}
              />
              <OracleRoster
                iconsOnly={iconsOnly}
                onAttachOracle={addOracle}
                onAttachTmux={addTmux}
                chatpaneAgentsOnly
                moneyAgentsSlot={
                  <MoneyAgentsSection
                    iconsOnly={iconsOnly}
                    embedded={!iconsOnly}
                    agentChatStates={moneyAgentChatStates}
                    onOpenOverview={() => spawn({ type: "money-agents" }, "agents")}
                    onOpenAgentChat={openMoneyAgentChat}
                  />
                }
              />
            </div>
            <div className="flex flex-col gap-0.5 border-t border-[var(--color-border)] p-2">
              {/* live 5h/7d usage — pinned to the footer so it's ALWAYS visible
                  (it used to hide inside the collapsible agents section). */}
              {!iconsOnly && (
                <div className="px-1.5 pb-2">
                  <SidebarUsage />
                </div>
              )}
              <div className={`flex pb-1 ${iconsOnly ? "justify-center" : "justify-center px-1.5"}`}>
                {sidebarActions}
              </div>
              <AccountMenu iconsOnly={iconsOnly} onOpenSettings={() => setSettingsOpen(true)} />
            </div>
          </aside>
        )}

        {/* collapsed-sidebar fallback chrome: palette + notifications must stay
            reachable when the rail is hidden — a minimal floating corner cluster
            (same handlers/badge state as the rail's action row). */}
        {!sidebarOpen && !compactWebLayout && !webMirrorMode && (
          <div
            data-no-window-drag
            className="absolute bottom-3 left-3 z-30 flex items-center gap-0.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel)]/90 px-1.5 py-1 shadow-[var(--aios-shadow-pop)] backdrop-blur"
          >
            <IconBtn title={`Command palette (${chord("K")})`} onClick={() => setPaletteOpen(true)}>
              <Search size={14} />
            </IconBtn>
            <IconBtn title={`Show sidebar (${chord("B")})`} onClick={() => setSidebarOpen(true)}>
              <PanelLeft size={14} />
            </IconBtn>
            <button
              type="button"
              onClick={openNotificationsPane}
              title="notifications"
              className="relative rounded-md p-1.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            >
              <Bell size={14} />
              {unreadNotifications > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[var(--color-danger)] px-1 text-[8px] font-bold leading-none text-[var(--color-bg)]">
                  {unreadNotifications > 9 ? "9+" : unreadNotifications}
                </span>
              )}
            </button>
          </div>
        )}

        {/* (resume-layout pill data is computed just above the idle mount — see
            resumeLayoutInfo/onResumeLayout, threaded through IdleDashboard) */}
        <main className="relative min-h-0 flex-1">
          {(() => {
            if (webMirrorMode) {
              return (
                <MirrorViewer
                  snapshot={remoteMirrorSnapshot}
                  status={mirrorPairing ? mirrorStatus : "off"}
                  presence={mirrorPresence}
                  onControl={sendMirrorControl}
                />
              );
            }
            const idleDash = (
              <IdleDashboard
                apps={SPAWN}
                oracles={oracles}
                projects={projects}
                sidebar={sidebar}
                onApplyWorkspace={applyWorkspace}
                onSpawn={spawn}
                onAttachOracle={addOracle}
                onOpenProject={(p) => spawn({ type: "shell", cwd: p.root }, p.name)}
                onOpenSidebarItem={spawnSidebarItem}
                onRevealSidebar={() => setSidebarOpen(true)}
                onOpenMoneyAgents={() => spawn({ type: "money-agents" }, "agents")}
                onOpenPet={() => spawn({ type: "pet" }, "pet")}
                onOpenMoneyAgentChat={openMoneyAgentChat}
                onOpenPalette={() => setPaletteOpen(true)}
                onResumeLast={chats.length ? () => resumeChat(chats[0]) : undefined}
                resumeLabel={chats[0]?.title}
                resumeLayout={resumeLayoutInfo}
                onResumeLayout={onResumeLayout}
                notifications={notifications}
                onTalkToJarvis={talkToJarvis}
                onOpenNotificationTarget={openNotificationTarget}
                onClearNotification={clearNotification}
              />
            );
            // No panes at all → idle. If panes exist but ALL are hidden, keep them
            // mounted (state-preserving) in the grid and overlay idle on top — else
            // the grid is all-`display:none` and the screen goes blank.
            if (panes.length === 0) return idleDash;
            return (
              <>
                {visibleCount === 0 && <div className="absolute inset-0 z-10">{idleDash}</div>}
            <ResizableGrid cols={cols} rows={rows} gap={8} storageKey={gridTrackStorageKey(GRID_TRACK_KEY, cols, rows)}>
              {panes.map((pane) => {
                const visibleIndex = panes
                  .filter((p) => !hiddenKeys.includes(p.key))
                  .findIndex((p) => p.key === pane.key);
                const paneStyle =
                  visibleCount === 3 && visibleIndex === 2
                    ? ({ gridColumn: "2", gridRow: "1 / span 2" } satisfies CSSProperties)
                    : undefined;
                return (
                <PaneCard
                  key={pane.key}
                  pane={pane}
                  defaultCwd={home}
                  active={
                    !overlayOpen &&
                    !hiddenKeys.includes(pane.key) &&
                    (maximizedKey === null || maximizedKey === pane.key)
                  }
                  maximized={maximizedKey === pane.key}
                  hidden={hiddenKeys.includes(pane.key)}
                  style={paneStyle}
                  dropTarget={dropTargetKey === pane.key}
                  dropZone={dropTargetKey === pane.key ? dropZone : null}
                  closing={closingKeys.includes(pane.key)}
                  onClose={() => requestClose(pane.key)}
                  onToggleMax={() => toggleMax(pane.key)}
                  onToggleHide={() => toggleHide(pane.key)}
                  onMoveLeft={() => movePaneByKey(pane.key, -1)}
                  onMoveRight={() => movePaneByKey(pane.key, 1)}
                  reorderable={panes.length > 1}
                  isDragging={dragActiveKey === pane.key}
                  busy={busyChatKeys.has(pane.key)}
                  dimmed={
                    focusSpotlight &&
                    panes.length > 1 &&
                    maximizedKey === null &&
                    (activeKey ?? focusedPane.current) !== pane.key
                  }
                  onPaneDragStart={onPaneDragStart}
                  onFocus={() => {
                    focusedPane.current = pane.key;
                    setActiveKey(pane.key);
                  }}
                  onAnnotate={routeToChat}
                  onSendImage={routeImageToChat}
                  onSendToAi={sendToAi}
                  onOpenFile={openFile}
                  onOpenEditorFile={openEditorFile}
                  onOpenViewerFile={openViewerFile}
                  onRevealFile={revealFile}
                  onDuplicate={() => spawn(pane.kind, pane.label)}
                  onOpenUrl={openUrl}
                  notifications={notifications}
                  onMarkNotificationRead={markNotificationRead}
                  onOpenNotificationTarget={openNotificationTarget}
                  onMarkAllNotificationsRead={markAllNotificationsRead}
                  onClearNotification={clearNotification}
                  onClearAllNotifications={clearAllNotifications}
                  onOpenMoneyAgentChat={openMoneyAgentChat}
                  onAttachApp={(app) =>
                    spawn(
                      { type: "app", name: app.name, bundleId: app.bundle_id },
                      app.name,
                    )
                  }
                  onProfileChange={(profile) =>
                    setPanes((ps) =>
                      ps.map((p) =>
                        p.key === pane.key && p.kind.type === "browser"
                          ? { ...p, kind: { ...p.kind, profile } }
                          : p,
                      ),
                    )
                  }
                  onVideoFullscreen={(on) => onVideoFullscreen(pane.key, on)}
                />
                );
              })}
            </ResizableGrid>
              </>
            );
          })()}
        </main>
      </div>

      {compactWebLayout && (
        <MobileBottomNav
          panesCount={panes.length}
          onNewChat={() => spawn({ type: "chat" }, "chat")}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenBrowser={() => spawn({ type: "browser" }, "browser")}
          onOpenPet={() => spawn({ type: "pet" }, "pet")}
          onShowPanes={() => {
            if (panes.length > 0) setOverviewOpen(true);
          }}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {toast && (
        // .toast-in/out own the -50% X in their keyframes; keyed by message so
        // a replacing flash re-plays the entrance. (was .modal-in — a modal's
        // slide-up gesture on a toast — with shadow-2xl and no exit at all)
        <div
          key={toast}
          className={`${toastLeaving ? "toast-out" : "toast-in"} glass absolute bottom-4 left-1/2 z-40 -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/90 px-3 py-2 text-[12px] text-[var(--color-text)] shadow-[var(--aios-shadow-pop)]`}
        >
          {toast}
        </div>
      )}

      {/* minimized panes now live in the sidebar "OPEN" list (OpenPanesList) —
          no floating overlay. Restore / hide / close all happen from the rail. */}

      {/* close a busy chat: keep running in background, or kill */}
      {closePrompt && (
        <div className="overlay-backdrop absolute inset-0 z-50 grid place-items-center bg-black/50" onClick={() => setClosePrompt(null)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="this chat is still working"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                setClosePrompt(null);
                return;
              }
              trapTab(e, e.currentTarget);
            }}
            className="modal-in w-[400px] rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] p-4 shadow-[var(--aios-shadow-pop)]"
          >
            <div className="text-[13px] font-medium text-[var(--color-text)]">this chat is still working</div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">
              keep it running in the background so it finishes the task, or stop it?
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                autoFocus
                onClick={() => {
                  // Ack-of-an-action-just-taken is noise. The real signal — chat
                  // done — fires later as a clickable `chat.done` notification.
                  chatHandles.get(closePrompt)?.detach(true);
                  closePane(closePrompt);
                  setClosePrompt(null);
                }}
                className="rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent-fg)]"
              >
                keep running + notify me when done
              </button>
              <button
                onClick={() => {
                  chatHandles.get(closePrompt)?.detach(false);
                  closePane(closePrompt);
                  setClosePrompt(null);
                }}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] hover:border-[var(--color-accent)]/50"
              >
                keep running (no notification)
              </button>
              <button
                onClick={() => {
                  closePane(closePrompt);
                  setClosePrompt(null);
                }}
                className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-danger)] hover:border-[var(--color-danger)]/50"
              >
                stop &amp; close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ExitGate keeps the lazy mount alive ~160ms after close so Settings'
          internal data-closing exit can play (the parent conditional used to
          unmount it in the same frame). */}
      <ExitGate open={settingsOpen}>
        <Suspense fallback={null}>
          <Settings
            open={settingsOpen}
            initialSection={settingsSection}
            onClose={() => {
              setSettingsOpen(false);
              setSettingsSection(null);
            }}
            mirrorUrl={mirrorUrl}
            mirrorStatus={mirrorStatus}
            onCopyMirrorUrl={() => {
              if (!mirrorUrl) return;
              navigator.clipboard?.writeText(mirrorUrl).catch((e) => reportDiag("app.clipboard", e, { action: "mirrorUrl" }));
              flash("mirror link copied");
            }}
          />
        </Suspense>
      </ExitGate>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={commands}
        onAsk={askFromPalette}
        onDeepSearch={deepSearchFromPalette}
      />
      <FileFinder
        open={fileFinderOpen}
        root={finderRoot}
        mru={mru}
        onClose={() => setFileFinderOpen(false)}
        onPick={(abs) => openFile(abs, pathBasename(abs))}
      />
      <GlobalSearch
        open={globalSearchOpen}
        root={finderRoot}
        onClose={() => setGlobalSearchOpen(false)}
        onPick={(abs, line, col) => openEditorFile(abs, pathBasename(abs), { line, col })}
      />
      <ShortcutHud open={shortcutHudOpen} onClose={() => setShortcutHudOpen(false)} />
      <PinSiteModal spaceId={pinSiteSpace} onClose={() => setPinSiteSpace(null)} />
      <SaveWorkspaceModal
        draft={wsDraft}
        existing={workspaces.map((w) => w.name)}
        onChange={setWsDraft}
        onSave={saveCurrentWorkspace}
        onClose={() => setWsDraft(null)}
      />
      <PaneOverview
        open={overviewOpen}
        panes={panes}
        hiddenKeys={hiddenKeys}
        activeKey={activeKey}
        onClose={() => setOverviewOpen(false)}
        onPick={(key) => {
          focusPane(key);
          setMaximizedKey(null);
          setOverviewOpen(false);
        }}
        onClosePane={requestClose}
        onShowAll={() => {
          // un-minimize + un-maximize everything (tile all panes into the grid).
          setHiddenKeys([]);
          setMaximizedKey(null);
          setOverviewOpen(false);
        }}
      />
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  active,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`rounded-md p-1.5 transition-colors ${
        disabled
          ? "cursor-not-allowed text-[var(--color-faint)] opacity-40"
          : active
            ? "bg-[var(--color-panel-2)] text-[var(--color-accent)]"
            : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
      }`}
    >
      {children}
    </button>
  );
}

function MobileBottomNav({
  panesCount,
  onNewChat,
  onOpenPalette,
  onOpenBrowser,
  onOpenPet,
  onShowPanes,
  onOpenSettings,
}: {
  panesCount: number;
  onNewChat: () => void;
  onOpenPalette: () => void;
  onOpenBrowser: () => void;
  onOpenPet: () => void;
  onShowPanes: () => void;
  onOpenSettings: () => void;
}) {
  const items = [
    { label: "chat", icon: MessageSquare, action: onNewChat },
    { label: "search", icon: Search, action: onOpenPalette },
    { label: "web", icon: Globe, action: onOpenBrowser },
    { label: panesCount > 0 ? "panes" : "pet", icon: panesCount > 0 ? Layers : Bot, action: panesCount > 0 ? onShowPanes : onOpenPet },
    { label: "settings", icon: SettingsIcon, action: onOpenSettings },
  ];
  return (
    <nav
      className="glass z-40 grid h-16 shrink-0 grid-cols-5 border-t border-[var(--color-border)] bg-[var(--color-panel)]/92 px-1 pb-[max(env(safe-area-inset-bottom),0px)]"
      aria-label="mobile navigation"
      data-no-window-drag
    >
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.label}
            type="button"
            onClick={item.action}
            className="relative flex min-w-0 flex-col items-center justify-center gap-0.5 rounded-md px-1 text-[10px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            title={item.label}
          >
            <Icon size={19} />
            <span className="w-full truncate text-center leading-none">{item.label}</span>
            {item.label === "panes" && panesCount > 0 && (
              <span className="absolute right-3 top-1.5 grid h-4 min-w-4 place-items-center rounded-full bg-[var(--color-accent)] px-1 text-[9px] font-semibold leading-none text-black">
                {panesCount > 9 ? "9+" : panesCount}
              </span>
            )}
          </button>
        );
      })}
    </nav>
  );
}

/** The explicit action verb a notification row shows / its click does, derived
 *  from the deep-link target (replaces the generic "open pane"). */
function notificationActionVerb(target: NotificationTarget): string {
  switch (target.type) {
    case "chat":
      return "reopen chat";
    case "diagnostics":
      return "open diagnostics";
    case "terminal":
      return "go to terminal";
    case "url":
      return "open link";
    case "file":
      return target.mode === "reveal"
        ? "reveal file"
        : target.mode === "viewer"
          ? "open file"
          : "open in editor";
    case "pane":
    default:
      return "open pane";
  }
}

function NotificationCenter({
  notifications,
  onMarkRead,
  onOpenTarget,
  onMarkAllRead,
  onClear,
  onClearAll,
}: {
  notifications: AiosNotification[];
  onMarkRead: (id: string) => void;
  onOpenTarget: (item: AiosNotification) => void;
  onMarkAllRead: () => void;
  onClear: (id: string) => void;
  onClearAll: () => void;
}) {
  const unread = notifications.filter((n) => !n.read).length;
  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--color-bg)] text-[12px] text-[var(--color-text)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
        <div>
          <div className="text-[12px] font-medium">notifications</div>
          <div className="text-[10px] text-[var(--color-muted)]">
            {unread > 0 ? `${unread} unread` : "all caught up"}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onMarkAllRead}
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            title="mark all read"
          >
            <CheckCheck size={14} />
          </button>
          <button
            type="button"
            onClick={onClearAll}
            className="grid h-7 w-7 place-items-center rounded-md text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-danger)]"
            title="clear all"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>
      {/* .stagger: the panel mounts fresh per open, so rows cascade once
          (capped at 5 delays) instead of appearing as a slab */}
      <div className="stagger min-h-0 flex-1 overflow-y-auto p-2">
        {notifications.length === 0 ? (
          <div className="grid h-28 place-items-center rounded-md border border-dashed border-[var(--color-border)] text-[11px] text-[var(--color-faint)]">
            no notifications yet
          </div>
        ) : (
          notifications.map((item) => (
            <div
              key={item.id}
              className={`group flex gap-2 rounded-md px-2 py-2 transition-colors hover:bg-[var(--color-panel-2)] ${
                item.read ? "opacity-65" : ""
              }`}
            >
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                  item.level === "error"
                    ? "bg-[var(--color-danger)]"
                    : item.level === "warning"
                      ? "bg-[var(--color-warning)]"
                      : item.level === "success"
                        ? "bg-[var(--color-success)]"
                        : "bg-[var(--color-accent)]"
                }`}
              />
              <button
                type="button"
                onClick={() => (item.target ? onOpenTarget(item) : onMarkRead(item.id))}
                className="min-w-0 flex-1 text-left"
                title={item.target ? notificationActionVerb(item.target) : item.read ? "read" : "mark read"}
              >
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[12px] font-medium text-[var(--color-text)]">{item.title}</span>
                  {!item.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-accent)]" />}
                </div>
                {item.body && (
                  <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-[var(--color-muted)]">
                    {item.body}
                  </div>
                )}
                <div className="mt-1 flex items-center gap-1.5 text-[9px] uppercase tracking-wide text-[var(--color-faint)]">
                  <span>{item.sourceLabel ?? item.kind}</span>
                  {item.target && (
                    <>
                      <span>·</span>
                      <span>{notificationActionVerb(item.target)}</span>
                    </>
                  )}
                  <span>·</span>
                  <span>{new Date(item.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => onClear(item.id)}
                className="grid h-6 w-6 shrink-0 place-items-center rounded text-[var(--color-muted)] opacity-0 transition-opacity hover:bg-[var(--color-panel)] hover:text-[var(--color-danger)] group-hover:opacity-100"
                title="clear"
              >
                <X size={12} />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/* ── personalizable sidebar rail ─────────────────────────────────────────── */

/** A collapsible space header: click the title to fold/unfold; hover reveals a
 *  ⋯ menu (rename always; delete only for custom spaces — the three built-ins
 *  are protected). Inline rename mirrors the row rename UX. */
function SpaceHeader({
  space,
  count,
  iconsOnly = false,
}: {
  space: SidebarSpace;
  count: number;
  iconsOnly?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(space.name);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== space.name) renameSpace(space.id, v);
    setRenaming(false);
  };

  if (renaming) {
    return (
      <div className="px-2.5 py-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") {
              setDraft(space.name);
              setRenaming(false);
            }
          }}
          spellCheck={false}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60"
        />
      </div>
    );
  }

  return (
    <div className={`group/sh relative flex items-center ${iconsOnly ? "justify-center px-0" : "pl-1.5 pr-1"}`}>
      <button
        onClick={() => toggleSpaceCollapsed(space.id)}
        className={`flex min-w-0 items-center gap-1 py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)] ${
          iconsOnly ? "justify-center" : "flex-1 text-left"
        }`}
        title={`${space.name} · ${space.collapsed ? "expand" : "collapse"}`}
      >
        {space.collapsed ? <ChevronRight size={11} /> : <ChevronDown size={11} />}
        {!iconsOnly && <span className="truncate">{space.name}</span>}
        {!iconsOnly && space.collapsed && count > 0 && (
          <span className="text-[var(--color-faint)]">({count})</span>
        )}
      </button>
      {!iconsOnly && <div ref={menuRef} className="relative shrink-0">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="grid h-5 w-5 place-items-center rounded text-[var(--color-faint)] opacity-0 transition-opacity hover:bg-[var(--color-panel)] hover:text-[var(--color-text)] group-hover/sh:opacity-100"
          title="space options"
        >
          <EllipsisVertical size={12} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-panel-2)] py-1 text-[12px] text-[var(--color-text)] shadow-lg">
            <RowMenuItem
              icon={<Pencil size={13} />}
              label="rename"
              onClick={() => {
                setDraft(space.name);
                setRenaming(true);
                setMenuOpen(false);
              }}
            />
            {!space.system && (
              <RowMenuItem
                icon={<Trash2 size={13} />}
                label="delete space"
                onClick={() => {
                  removeSpace(space.id);
                  setMenuOpen(false);
                }}
              />
            )}
          </div>
        )}
      </div>}
    </div>
  );
}

/** The store-driven rail: built-in apps + pinned sites organized into SPACES
 *  (collapsible, user-creatable sections). Drag-to-reorder rows within/across
 *  spaces (native HTML5 DnD); per-row rename / hide / unpin / move-to-space;
 *  per-space rename / collapse / delete; "+ new space" at the foot. */
function SidebarRail({
  state,
  iconsOnly = false,
  onSpawn,
  onPinSite,
}: {
  state: SidebarState;
  iconsOnly?: boolean;
  onSpawn: (item: SidebarItem) => void;
  onPinSite: (spaceId: string) => void;
}) {
  // index of the row being dragged + the row currently hovered (drop target),
  // both into the FULL ordered items array (reorder() takes absolute indices).
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [overIdx, setOverIdx] = useState<number | null>(null);

  const items = state.items;
  const spaces = state.spaces;
  const indexOf = useCallback(
    (id: string) => items.findIndex((it) => it.id === id),
    [items],
  );

  // Drop onto a row: if it came from another space, reassign it to the target's
  // space first (that's how you sort an item into a space by dragging), then
  // reorder to the drop position.
  const onDrop = useCallback(
    (toId: string, toGroup: string) => {
      const from = dragIdx;
      const dragged = from != null ? items[from] : null;
      setDragIdx(null);
      setOverIdx(null);
      const to = indexOf(toId);
      if (from == null || to < 0 || !dragged) return;
      if (dragged.group !== toGroup) setGroup(dragged.id, toGroup);
      if (from !== to) reorder(from, to);
    },
    [dragIdx, items, indexOf],
  );

  // Drop onto an (empty area of a) space: just reassign space, keep order.
  const onDropToSpace = useCallback(
    (group: string) => {
      const from = dragIdx;
      const dragged = from != null ? items[from] : null;
      setDragIdx(null);
      setOverIdx(null);
      if (!dragged) return;
      if (dragged.group !== group) setGroup(dragged.id, group);
    },
    [dragIdx, items],
  );

  const spaceNames = spaces.map((s) => ({ id: s.id, name: s.name }));

  return (
    <>
      {spaces.map((space, si) => {
        const rows = items.filter((it) => it.group === space.id && !it.hidden);
        const isPinned = space.id === "pinned";
        return (
          <div
            key={space.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => onDropToSpace(space.id)}
            className={`flex flex-col gap-0.5 ${si > 0 ? "border-t border-[var(--color-border)] pt-1.5" : ""}`}
          >
            <SpaceHeader space={space} count={rows.length} iconsOnly={iconsOnly} />
            {!space.collapsed && (
              <>
                {rows.map((it) => {
                  const idx = indexOf(it.id);
                  return (
                    <SidebarRow
                      key={it.id}
                      item={it}
                      spaces={spaceNames}
                      dragging={dragIdx === idx}
                      over={overIdx === idx && dragIdx !== idx}
                      onSpawn={() => onSpawn(it)}
                      onSetSpace={(g) => setGroup(it.id, g)}
                      onDragStart={() => setDragIdx(idx)}
                      onDragEnter={() => setOverIdx(idx)}
                      onDragEnd={() => {
                        setDragIdx(null);
                        setOverIdx(null);
                      }}
                      onDrop={() => onDrop(it.id, space.id)}
                      iconsOnly={iconsOnly}
                    />
                  );
                })}
                {isPinned && (
                  <button
                    onClick={() => onPinSite(space.id)}
                    className={`group flex w-full items-center rounded-md py-1.5 text-[12px] text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)] ${
                      iconsOnly ? "justify-center px-0" : "gap-2.5 px-2.5 text-left"
                    }`}
                    title="pin a website to the sidebar"
                  >
                    <Plus size={14} className="shrink-0" />
                    {!iconsOnly && "pin a site"}
                  </button>
                )}
                {!iconsOnly && !isPinned && rows.length === 0 && (
                  <div className="px-2.5 py-1.5 text-[11px] italic text-[var(--color-faint)]">
                    drag items here
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
      <button
        onClick={() => addSpace("new space")}
        className={`group mt-1.5 flex w-full items-center rounded-md border-t border-[var(--color-border)] pt-2.5 pb-1.5 text-[12px] text-[var(--color-faint)] transition-colors hover:text-[var(--color-text)] ${
          iconsOnly ? "justify-center px-0" : "gap-2.5 px-2.5 text-left"
        }`}
        title="create a new space"
      >
        <FolderPlus size={14} className="shrink-0" />
        {!iconsOnly && "new space"}
      </button>
    </>
  );
}

const SIDEBAR_ICON_CHOICES: { name: string; label: string; icon: typeof Folder }[] = [
  { name: "chat", label: "chat", icon: MessageSquare },
  { name: "terminal", label: "terminal", icon: TerminalSquare },
  { name: "bot", label: "agent", icon: Bot },
  { name: "notes", label: "notes", icon: NotebookPen },
  { name: "files", label: "files", icon: Folder },
  { name: "browser", label: "web", icon: Globe },
  { name: "database", label: "data", icon: Database },
  { name: "automations", label: "time", icon: Clock },
  { name: "contacts", label: "people", icon: MessageCircle },
  { name: "studio", label: "studio", icon: Wand2 },
  { name: "notifications", label: "alerts", icon: Bell },
  { name: "doc", label: "doc", icon: FileText },
  { name: "pin", label: "pin", icon: Pin },
  { name: "settings", label: "settings", icon: SettingsIcon },
  { name: "layers", label: "layers", icon: Layers },
];

const SIDEBAR_ICON_BY_NAME: Record<string, typeof Folder> = Object.fromEntries(
  SIDEBAR_ICON_CHOICES.map((choice) => [choice.name, choice.icon]),
) as Record<string, typeof Folder>;

/** One sidebar row — draggable, resolves to a custom lucide icon or a cached
 *  favicon (links), with a hover ⋯ menu (rename / icon / hide / unpin). */
function SidebarRow({
  item,
  spaces,
  dragging,
  over,
  iconsOnly = false,
  onSpawn,
  onSetSpace,
  onDragStart,
  onDragEnter,
  onDragEnd,
  onDrop,
}: {
  item: SidebarItem;
  spaces: { id: string; name: string }[];
  dragging: boolean;
  over: boolean;
  iconsOnly?: boolean;
  onSpawn: () => void;
  onSetSpace: (spaceId: string) => void;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [iconOpen, setIconOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.label);
  const [favBroken, setFavBroken] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const isLink = item.kind.type === "link";
  const app = item.kind.type === "app" ? SPAWN_BY_ID[item.kind.appId] : undefined;
  const Icon = SIDEBAR_ICON_BY_NAME[item.iconName] ?? app?.icon ?? Globe;

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // close the nested move-to submenu whenever the parent menu closes.
  useEffect(() => {
    if (!menuOpen) setMoveOpen(false);
    if (!menuOpen) setIconOpen(false);
  }, [menuOpen]);

  const commitRename = () => {
    const v = draft.trim();
    if (v && v !== item.label) renameItem(item.id, v);
    setRenaming(false);
  };

  if (renaming) {
    return (
      <div className="flex items-center gap-2 rounded-md px-2.5 py-1">
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            else if (e.key === "Escape") {
              setDraft(item.label);
              setRenaming(false);
            }
          }}
          spellCheck={false}
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60"
        />
      </div>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        // a transparent payload keeps Firefox/Safari happy with HTML5 DnD.
        e.dataTransfer.setData("text/plain", item.id);
        onDragStart();
      }}
      onDragEnter={onDragEnter}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      title={item.label}
      className={`group relative flex items-center rounded-md transition-colors ${
        dragging ? "opacity-40" : ""
      } ${over ? "bg-[var(--color-accent-soft)] ring-1 ring-[var(--color-accent)]/40" : "hover:bg-[var(--color-panel-2)]"}`}
    >
      <span className={`grid shrink-0 cursor-grab place-items-center text-[var(--color-faint)] opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing ${iconsOnly ? "w-0" : "w-4"}`}>
        <GripVertical size={12} />
      </span>
      <button
        onClick={onSpawn}
        className={`flex min-w-0 flex-1 items-center text-[13px] text-[var(--color-text-2)] transition-colors group-hover:text-[var(--color-text)] ${
          iconsOnly ? "min-h-11 justify-center px-0 py-2" : "gap-2.5 py-1.5 pr-1 text-left"
        }`}
      >
        {isLink && item.iconName === "favicon" && item.faviconUrl && !favBroken ? (
          <img
            src={item.faviconUrl}
            alt=""
            onError={() => setFavBroken(true)}
            className={`${iconsOnly ? "h-[22px] w-[22px]" : "h-[15px] w-[15px]"} shrink-0 rounded-sm`}
          />
        ) : (
          <Icon
            size={iconsOnly ? 23 : 15}
            className="shrink-0 text-[var(--color-muted)] group-hover:text-[var(--color-text)]"
          />
        )}
        {!iconsOnly && <span className="truncate">{item.label}</span>}
      </button>
      <div ref={menuRef} className={`relative shrink-0 ${iconsOnly ? "absolute right-0 top-0" : ""}`}>
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className={`grid place-items-center rounded text-[var(--color-muted)] opacity-0 transition-opacity hover:bg-[var(--color-panel)] hover:text-[var(--color-text)] group-hover:opacity-100 ${
            iconsOnly ? "h-5 w-5" : "h-6 w-6"
          }`}
          title="options"
        >
          <EllipsisVertical size={13} />
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-[var(--color-border)] bg-[var(--color-panel-2)] py-1 text-[12px] text-[var(--color-text)] shadow-lg">
            <RowMenuItem
              icon={<Pencil size={13} />}
              label="rename"
              onClick={() => {
                setDraft(item.label);
                setRenaming(true);
                setMenuOpen(false);
              }}
            />
            <div className="relative">
              <button
                type="button"
                onClick={() => setIconOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-panel)]"
              >
                <Wand2 size={13} className="shrink-0 text-[var(--color-muted)]" />
                <span className="flex-1">change icon</span>
                <ChevronRight size={12} className="text-[var(--color-faint)]" />
              </button>
              {iconOpen && (
                <div className="grid grid-cols-5 gap-1 border-y border-[var(--color-border)] bg-[var(--color-panel)]/40 p-2">
                  {isLink && item.faviconUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setItemIcon(item.id, "favicon");
                        setMenuOpen(false);
                      }}
                      title="favicon"
                      className={`grid h-7 w-7 place-items-center rounded-md border ${
                        item.iconName === "favicon"
                          ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)]"
                          : "border-transparent hover:bg-[var(--color-panel-2)]"
                      }`}
                    >
                      <img src={item.faviconUrl} alt="" className="h-4 w-4 rounded-sm" />
                    </button>
                  )}
                  {SIDEBAR_ICON_CHOICES.map((choice) => {
                    const ChoiceIcon = choice.icon;
                    return (
                      <button
                        key={choice.name}
                        type="button"
                        onClick={() => {
                          setItemIcon(item.id, choice.name);
                          setMenuOpen(false);
                        }}
                        title={choice.label}
                        className={`grid h-7 w-7 place-items-center rounded-md border ${
                          item.iconName === choice.name
                            ? "border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                            : "border-transparent text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                        }`}
                      >
                        <ChoiceIcon size={15} />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMoveOpen((o) => !o)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-[var(--color-panel)]"
              >
                <MoveRight size={13} className="shrink-0 text-[var(--color-muted)]" />
                <span className="flex-1">move to space</span>
                <ChevronRight size={12} className="text-[var(--color-faint)]" />
              </button>
              {moveOpen && (
                <div className="mb-1 ml-5 flex flex-col border-l border-[var(--color-border)] pl-1">
                  {spaces.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      disabled={s.id === item.group}
                      onClick={() => {
                        onSetSpace(s.id);
                        setMenuOpen(false);
                      }}
                      className={`truncate px-3 py-1 text-left ${
                        s.id === item.group
                          ? "text-[var(--color-accent)]"
                          : "text-[var(--color-text-2)] hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                      }`}
                    >
                      {s.id === item.group ? "• " : ""}
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isLink ? (
              <RowMenuItem
                icon={<Trash2 size={13} />}
                label="unpin"
                onClick={() => {
                  removeItem(item.id);
                  setMenuOpen(false);
                }}
              />
            ) : (
              <RowMenuItem
                icon={<EyeOff size={13} />}
                label="hide"
                onClick={() => {
                  toggleHidden(item.id, true);
                  setMenuOpen(false);
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function RowMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[var(--color-text)] transition-colors hover:bg-[var(--color-panel)]"
    >
      <span className="text-[var(--color-muted)]">{icon}</span>
      {label}
    </button>
  );
}

/** Inline modal to pin a website by url (favicon resolved by the store). */
function PinSiteModal({ spaceId, onClose }: { spaceId: string | null; onClose: () => void }) {
  const open = spaceId != null;
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (open) {
      setUrl("");
      setLabel("");
    }
  }, [open]);
  const { mounted, closing } = useExitState(open);
  if (!mounted) return null;
  const submit = () => {
    const u = url.trim();
    if (!u) return;
    addLink(u, label.trim() || undefined, undefined, spaceId ?? "pinned");
    onClose();
  };
  return (
    <div
      data-closing={closing || undefined}
      className={`overlay-backdrop fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-sm ${closing ? "pointer-events-none" : ""}`}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="pin a site"
        data-closing={closing || undefined}
        className="modal-in glass w-[380px] rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-panel)]/95 p-4 shadow-[var(--aios-shadow-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e, e.currentTarget)}
      >
        <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-[var(--color-text)]">
          <Pin size={14} className="text-[var(--color-accent)]" />
          pin a site
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-2"
        >
          <input
            autoFocus
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="youtube.com"
            spellCheck={false}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 font-mono text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="label (optional)"
            spellCheck={false}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60"
          />
          <div className="mt-1 flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-2)] hover:border-[var(--color-border-strong)]"
            >
              cancel
            </button>
            <button
              type="submit"
              className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent-fg)]"
            >
              pin
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Inline modal naming the current layout as a workspace ("save workspace…"
 *  in the palette). Existing names render as one-click pills; reusing a name
 *  overwrites that workspace (the button says so). */
function SaveWorkspaceModal({
  draft,
  existing,
  onChange,
  onSave,
  onClose,
}: {
  /** Current input value; null = modal closed. */
  draft: string | null;
  existing: string[];
  onChange: (v: string) => void;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  // Sticky draft: during the 160ms closing render draft is already null — keep
  // the last real value so the input doesn't blank mid-exit.
  const lastDraft = useRef("");
  if (draft != null) lastDraft.current = draft;
  const { mounted, closing } = useExitState(draft != null);
  if (!mounted) return null;
  const value = draft ?? lastDraft.current;
  const clean = value.trim();
  const overwrites = existing.some((n) => n.toLowerCase() === clean.toLowerCase());
  const submit = () => {
    if (!clean) return;
    onSave(clean);
    onClose();
  };
  return (
    <div
      data-closing={closing || undefined}
      className={`overlay-backdrop fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-sm ${closing ? "pointer-events-none" : ""}`}
      onMouseDown={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="save workspace"
        data-closing={closing || undefined}
        className="modal-in glass w-[380px] rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-panel)]/95 p-4 shadow-[var(--aios-shadow-pop)]"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => trapTab(e, e.currentTarget)}
      >
        <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-[var(--color-text)]">
          <SquareStack size={14} className="text-[var(--color-accent)]" />
          save workspace
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="flex flex-col gap-2"
        >
          <input
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && onClose()}
            placeholder="e.g. deep work · review · research"
            spellCheck={false}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60"
          />
          {existing.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {existing.map((n) => (
                <button key={n} type="button" onClick={() => onChange(n)} className="pill press text-[10px]">
                  {n}
                </button>
              ))}
            </div>
          )}
          <div className="mt-1 flex items-center justify-between gap-2">
            <span className="font-mono text-[10px] text-[var(--color-faint)]">
              {overwrites ? "existing name — saving overwrites it" : "keeps panes + grid sizes"}
            </span>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-[var(--color-border)] px-3 py-1.5 text-[12px] text-[var(--color-text-2)] hover:border-[var(--color-border-strong)]"
              >
                cancel
              </button>
              <button
                type="submit"
                disabled={!clean}
                className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent-fg)] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {overwrites ? "overwrite" : "save"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Type → glyph for the overview cards (Mission-Control-style window thumbnails). */
const PANE_GLYPH: Record<string, typeof Folder> = {
  shell: TerminalSquare,
  oracle: Bot,
  tmux: TerminalSquare,
  files: Folder,
  browser: Globe,
  notes: NotebookPen,
  bridges: Radio,
  plugins: Layers,
  pulse: Radio,
  apps: MonitorUp,
  chat: MessageSquare,
  file: FileText,
  editor: FileText,
};

/** Mission-control-style pane overview: a full-screen scrim that fans out every
 *  open pane as a big window-thumbnail card so you can SEE them all and switch.
 *  Opened by three-finger swipe-up (wheel-fling), ⌘` / Ctrl+↑, or the palette.
 *  Pick a card → focus that pane; "show all" → tile every pane back into the
 *  grid. ←/→/⏎ keyboard, Esc / click-scrim closes. Cards are styled previews
 *  (window chrome + big type glyph) — no live webview duplication. */
function PaneOverview({
  open,
  panes,
  hiddenKeys,
  activeKey,
  onClose,
  onPick,
  onClosePane,
  onShowAll,
}: {
  open: boolean;
  panes: Pane[];
  hiddenKeys: string[];
  activeKey: string | null;
  onClose: () => void;
  onPick: (key: string) => void;
  onClosePane: (key: string) => void;
  onShowAll: () => void;
}) {
  const [sel, setSel] = useState(0);

  useEffect(() => {
    if (!open) return;
    const start = Math.max(0, panes.findIndex((p) => p.key === activeKey));
    setSel(start);
  }, [open, activeKey, panes]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" || e.key === "Tab") {
        e.preventDefault();
        setSel((i) => (i + 1) % Math.max(1, panes.length));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setSel((i) => (i - 1 + panes.length) % Math.max(1, panes.length));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const p = panes[sel];
        if (p) onPick(p.key);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, panes, sel, onClose, onPick]);

  // Exit motion — same closing contract as the palette (App.css data-closing).
  const { mounted, closing } = useExitState(open);

  if (!mounted) return null;

  // Card width adapts so 1-2 panes sit big + centered (not stretched), many panes
  // wrap into a tidy gallery — the Mission-Control feel at any count.
  const n = panes.length;
  const cardW = n <= 1 ? 460 : n <= 2 ? 400 : n <= 6 ? 340 : 280;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="mission control — open panes"
      data-closing={closing || undefined}
      className={`modal-in fixed inset-0 z-[60] flex flex-col bg-black/55 backdrop-blur-2xl ${closing ? "pointer-events-none" : ""}`}
      onMouseDown={onClose}
    >
      {/* top bar — title centered like macOS "Desktop", controls on the right */}
      <div className="relative flex h-12 shrink-0 items-center justify-center px-6">
        <div className="flex items-center gap-2 text-[13px] font-medium text-[var(--color-text-2)]">
          <Layers size={14} className="text-[var(--color-accent)]" />
          <span>{n} open {n === 1 ? "pane" : "panes"}</span>
          <span className="text-[var(--color-faint)]">· ←/→ ⏎ · esc</span>
        </div>
        <div className="absolute right-6 flex items-center gap-2" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onMouseDown={(e) => { e.stopPropagation(); onShowAll(); }}
            className="rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/70 px-3 py-1.5 text-[12px] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-accent)]/50 hover:text-[var(--color-accent)]"
            title="tile every pane back into the grid"
          >
            show all
          </button>
          <button
            onMouseDown={(e) => { e.stopPropagation(); onClose(); }}
            className="grid h-8 w-8 place-items-center rounded-lg text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            title="close (Esc)"
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* the gallery — empty space stays click-to-close (cards stop their own
          propagation), so a stray click anywhere dims out of Mission Control */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
        {/* .stagger: cards fan in on each open (the overview fully unmounts on
            close, so the cascade replays per open, capped at 5 delays) */}
        <div className="stagger flex flex-wrap items-center justify-center gap-6">
          {panes.map((p, i) => {
            const hidden = hiddenKeys.includes(p.key);
            const isSel = i === sel;
            const Glyph = PANE_GLYPH[p.kind.type] ?? Layers;
            return (
              <div key={p.key} className="flex flex-col items-center gap-2" style={{ width: cardW }}>
                <button
                  onMouseEnter={() => setSel(i)}
                  onMouseDown={(e) => { e.stopPropagation(); onPick(p.key); }}
                  style={{ width: cardW }}
                  className={`group relative flex aspect-[16/10] flex-col overflow-hidden rounded-xl border bg-[var(--color-pane)] text-left shadow-[var(--aios-shadow-pop)] transition-all duration-150 hover:-translate-y-1 ${
                    isSel
                      ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/60 scale-[1.02]"
                      : "border-[var(--color-border-strong)] hover:border-[var(--color-accent)]/40"
                  } ${hidden ? "opacity-60" : ""}`}
                >
                  {/* window chrome strip */}
                  <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-panel)] px-3">
                    <span className={`status-dot shrink-0 ${hidden ? "status-dot--cold" : DOT[p.kind.type] ?? "status-dot--cold"}`} />
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-text-2)]">{p.label}</span>
                    <span
                      role="button"
                      tabIndex={0}
                      aria-label={`close ${p.label}`}
                      onMouseDown={(e) => { e.stopPropagation(); onClosePane(p.key); }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          onClosePane(p.key);
                        }
                      }}
                      className="grid h-5 w-5 shrink-0 place-items-center rounded text-[var(--color-faint)] opacity-0 transition-opacity hover:bg-[var(--color-panel-2)] hover:text-[var(--color-danger)] focus-visible:opacity-100 group-hover:opacity-100"
                      title="close pane"
                    >
                      <X size={12} />
                    </span>
                  </div>
                  {/* body — big type glyph on a faint gradient "screen" */}
                  <div className="relative flex min-h-0 flex-1 items-center justify-center bg-gradient-to-br from-[var(--color-pane)] to-[var(--color-bg)]">
                    <Glyph size={Math.round(cardW * 0.16)} className="text-[var(--color-faint)] opacity-50 transition-opacity group-hover:opacity-80" />
                    {hidden && (
                      <span className="absolute bottom-2 right-2 rounded bg-[var(--color-panel)]/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-faint)]">minimized</span>
                    )}
                    <span className="absolute left-2 top-2 rounded bg-[var(--color-panel)]/70 px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-faint)]">{chord(String(i + 1))}</span>
                  </div>
                </button>
                <span className={`max-w-full truncate text-[12px] ${isSel ? "text-[var(--color-text)]" : "text-[var(--color-muted)]"}`}>
                  {p.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const DOT: Record<string, string> = {
  oracle: "status-dot--active",
  tmux: "status-dot--dormant",
  shell: "status-dot--idle",
  files: "status-dot--cold",
  browser: "status-dot--cold",
  notes: "status-dot--cold",
  bridges: "status-dot--cold",
  plugins: "status-dot--cold",
  pet: "status-dot--active",
  pulse: "status-dot--active",
  apps: "status-dot--cold",
  chat: "status-dot--active",
  file: "status-dot--cold",
};

function PaneLoading() {
  return (
    <div className="grid h-full place-items-center bg-[var(--color-bg)]">
      <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-faint)]">
        loading pane
      </span>
    </div>
  );
}

function PaneActionItem({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[var(--color-text-2)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
    >
      <span className="text-[var(--color-muted)]">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}

/** The "OPEN" rail section — a live, CRUD-able list of every open pane (replaces
 *  the old floating "hidden" overlay). Click a row to focus it (restoring it from
 *  minimized first); the eye toggles minimize/restore; the X closes it. Minimized
 *  rows render dimmed. This is the window-manager for the deck, in the sidebar. */
function OpenPanesList({
  panes,
  hiddenKeys,
  maximizedKey,
  activeKey,
  iconsOnly = false,
  onSelect,
  onToggleHide,
  onClose,
  onRename,
  onOpenOverview,
}: {
  panes: Pane[];
  hiddenKeys: string[];
  maximizedKey: string | null;
  activeKey: string | null;
  iconsOnly?: boolean;
  onSelect: (key: string) => void;
  onToggleHide: (key: string) => void;
  onClose: (key: string) => void;
  onRename: (key: string, label: string) => void;
  onOpenOverview?: () => void;
}) {
  // double-click a row → inline rename (this key + its draft text).
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const commit = () => {
    if (editKey) onRename(editKey, draft);
    setEditKey(null);
  };
  return (
    <div className="flex flex-col gap-0.5">
      <div
        className={`flex items-center py-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-faint)] ${
          iconsOnly ? "justify-center px-0" : "justify-between gap-1.5 px-1.5"
        }`}
        title={`open panes (${panes.length})`}
      >
        <span className="flex items-center gap-1.5">
          <Layers size={11} />
          {!iconsOnly && <span>open</span>}
          {!iconsOnly && <span className="text-[var(--color-faint)]">({panes.length})</span>}
        </span>
        {/* persistent Mission Control entry — discoverable without the hidden top bar */}
        {!iconsOnly && panes.length >= 2 && onOpenOverview && (
          <button
            type="button"
            onClick={onOpenOverview}
            title={"Mission Control — show all panes (" + chord("`") + ")"}
            className="press rounded-full border border-[var(--color-border)] px-1.5 py-0.5 text-[9px] font-medium normal-case tracking-normal text-[var(--color-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
          >
            {panes.length} panes
          </button>
        )}
      </div>
      {panes.map((p) => {
        const hidden = hiddenKeys.includes(p.key);
        const active = activeKey === p.key && !hidden;
        const maximized = maximizedKey === p.key;
        if (editKey === p.key) {
          return (
            <div key={p.key} className="flex items-center gap-2 rounded-md px-2.5 py-1">
              <span className={`status-dot shrink-0 ${DOT[p.kind.type] ?? "status-dot--cold"}`} />
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  else if (e.key === "Escape") setEditKey(null);
                }}
                spellCheck={false}
                className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-bg)] px-1.5 py-0.5 text-[13px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60"
              />
            </div>
          );
        }
        return (
          <div
            key={p.key}
            className={`group relative flex items-center rounded-md transition-colors ${
              active
                ? "bg-[var(--color-accent-soft)] ring-1 ring-[var(--color-accent)]/40"
                : "hover:bg-[var(--color-panel-2)]"
            }`}
          >
            <button
              onClick={() => onSelect(p.key)}
              onDoubleClick={() => {
                setDraft(p.label);
                setEditKey(p.key);
              }}
              className={`flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                hidden ? "text-[var(--color-faint)]" : "text-[var(--color-text-2)] group-hover:text-[var(--color-text)]"
              } ${iconsOnly ? "justify-center gap-0 px-0 text-center" : ""}`}
              title={hidden ? `restore pane: ${p.label}` : `focus pane: ${p.label} · double-click to rename`}
            >
              <span className={`status-dot shrink-0 ${hidden ? "status-dot--cold" : DOT[p.kind.type] ?? "status-dot--cold"}`} />
              {!iconsOnly && <span className="truncate">{p.label}</span>}
              {!iconsOnly && maximized && <Maximize2 size={10} className="shrink-0 text-[var(--color-accent)]" />}
            </button>
            {!iconsOnly && <div className="flex shrink-0 items-center pr-1 opacity-0 transition-opacity group-hover:opacity-100">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDraft(p.label);
                  setEditKey(p.key);
                }}
                className="grid h-6 w-6 place-items-center rounded text-[var(--color-muted)] hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                title="rename"
              >
                <Pencil size={11} />
              </button>
              <button
                onClick={(e) => (e.stopPropagation(), onToggleHide(p.key))}
                className="grid h-6 w-6 place-items-center rounded text-[var(--color-muted)] hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                title={hidden ? "restore" : "minimize"}
              >
                {hidden ? <Eye size={12} /> : <EyeOff size={12} />}
              </button>
              <button
                onClick={(e) => (e.stopPropagation(), onClose(p.key))}
                className="grid h-6 w-6 place-items-center rounded text-[var(--color-muted)] hover:bg-[var(--color-panel)] hover:text-[var(--color-danger)]"
                title="close"
              >
                <X size={12} />
              </button>
            </div>}
          </div>
        );
      })}
    </div>
  );
}

function PaneCard({
  pane,
  defaultCwd,
  active,
  maximized,
  hidden,
  style,
  dropTarget,
  dropZone,
  onClose,
  onToggleMax,
  onToggleHide,
  onMoveLeft,
  onMoveRight,
  reorderable,
  isDragging,
  dimmed,
  busy,
  closing,
  onPaneDragStart,
  onFocus,
  onAnnotate,
  onSendImage,
  onSendToAi,
  onOpenFile,
  onOpenEditorFile,
  onOpenViewerFile,
  onRevealFile,
  onDuplicate,
  onOpenUrl,
  notifications,
  onMarkNotificationRead,
  onOpenNotificationTarget,
  onMarkAllNotificationsRead,
  onClearNotification,
  onClearAllNotifications,
  onOpenMoneyAgentChat,
  onAttachApp,
  onProfileChange,
  onVideoFullscreen,
}: {
  pane: Pane;
  defaultCwd?: string;
  active: boolean;
  maximized?: boolean;
  hidden?: boolean;
  style?: CSSProperties;
  dropTarget?: boolean;
  /** snap zone under the drag pointer (only meaningful while dropTarget). */
  dropZone?: PaneDropZoneKind | null;
  onClose: () => void;
  onToggleMax?: () => void;
  onToggleHide?: () => void;
  onMoveLeft?: () => void;
  onMoveRight?: () => void;
  reorderable?: boolean;
  isDragging?: boolean;
  /** focus-spotlight: this pane is NOT the focused one — recede. */
  dimmed?: boolean;
  /** activity glow: a live agent run is streaming in this pane. */
  busy?: boolean;
  /** exit beat: pane is closing — play .pane-exit before removal. */
  closing?: boolean;
  onPaneDragStart?: (key: string, e: React.PointerEvent<HTMLElement>) => void;
  onFocus: () => void;
  onAnnotate: (text: string) => void;
  onSendImage: (path: string) => void;
  onSendToAi: (text: string) => void;
  onOpenFile: (path: string, name: string) => void;
  onOpenEditorFile: (path: string, name: string) => void;
  onOpenViewerFile: (path: string, name: string) => void;
  onRevealFile: (path: string, name: string) => void;
  onDuplicate: () => void;
  onOpenUrl?: (url: string) => void;
  notifications: AiosNotification[];
  onMarkNotificationRead: (id: string) => void;
  onOpenNotificationTarget: (item: AiosNotification) => void;
  onMarkAllNotificationsRead: () => void;
  onClearNotification: (id: string) => void;
  onClearAllNotifications: () => void;
  onOpenMoneyAgentChat: (id: string, label: string) => void;
  onAttachApp: (app: { name: string; bundle_id: string | null }) => void;
  onProfileChange: (profile: string) => void;
  onVideoFullscreen?: (on: boolean) => void;
}) {
  const t = pane.kind.type;
  // Register this pane in the canonical rect registry so the OS-drop hit-test can
  // target it without `elementFromPoint` (which fails over native webviews). The
  // wrapper ref gives a live rect; canAccept lets a pane opt a payload out.
  const wrapRef = useRef<HTMLDivElement>(null);

  // ── maximize/restore FLIP morph ──────────────────────────────────────────
  // The class swap (grid cell ↔ fixed inset-0) used to TELEPORT the pane —
  // the most jarring cut in the app. We morph instead: a recorder effect
  // (below, runs last) stores the rect after every render; when `maximized`
  // flips, this effect plays a transform from that pre-flip rect to the new
  // layout. Transform-only (GPU), one-shot, master reduce-motion respected.
  const flipRectRef = useRef<DOMRect | null>(null);
  const flipWasMaxRef = useRef(maximized);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    const was = flipWasMaxRef.current;
    flipWasMaxRef.current = maximized;
    if (!el || was === maximized) return;
    const from = flipRectRef.current;
    if (!from || !from.width || !from.height) return;
    if (
      document.documentElement.dataset.reduceMotion === "true" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    )
      return;
    const to = el.getBoundingClientRect();
    if (!to.width || !to.height) return;
    el.style.zIndex = "60";
    el.style.transformOrigin = "0 0";
    const anim = el.animate(
      [
        {
          transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`,
        },
        { transform: "none" },
      ],
      { duration: 280, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    const done = () => {
      el.style.zIndex = "";
      el.style.transformOrigin = "";
    };
    anim.onfinish = done;
    anim.oncancel = done;
  }, [maximized]);
  // record the post-render rect — the morph source for the NEXT flip. Defined
  // after the FLIP effect so it runs after it on the flip render.
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (el && !hidden) flipRectRef.current = el.getBoundingClientRect();
  });
  useEffect(() => {
    const canAccept = (_kind: PayloadKind): boolean => {
      // pet/clock-style decorative panes accept nothing; everything else does.
      return t !== "pet";
    };
    return registerPane({
      key: pane.key,
      type: t,
      getRect: () => wrapRef.current?.getBoundingClientRect() ?? null,
      canAccept,
    });
  }, [pane.key, t]);
  const canReorder = Boolean(reorderable) && !maximized;
  const chatCwd = pane.kind.type === "chat" ? (pane.kind.cwd ?? defaultCwd) : undefined;
  const label =
    t === "oracle" ? `oracle: ${pane.label}` : t === "tmux" ? `tmux: ${pane.label}` : pane.label;
  // Monitoring works on real tmux sessions (oracle/tmux panes) — the watcher
  // capture-panes them and reports to WhatsApp.
  const monTarget =
    pane.kind.type === "oracle"
      ? { socket: "adletic", session: `aios-${pane.kind.identity}` }
      : pane.kind.type === "tmux"
        ? { socket: pane.kind.socket, session: pane.kind.session }
        : null;
  const [mon, setMon] = useState(false);
  const [openAsOpen, setOpenAsOpen] = useState(false);
  const fileTarget = paneFileTarget(pane.kind);
  const toggleMon = () => {
    if (!monTarget) return;
    if (mon) monitorStop(monTarget.session).catch((e) => reportDiag("app.monitor", e, { action: "stop" }));
    else monitorStart(monTarget.socket, monTarget.session).catch((e) => reportDiag("app.monitor", e, { action: "start" }));
    setMon((v) => !v);
  };
  return (
    <div
      ref={wrapRef}
      data-pane-key={pane.key}
      onMouseDownCapture={onFocus}
      style={hidden ? { display: "none" } : style}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-pane)] transition-[color,background-color,border-color,box-shadow,opacity] duration-200 ${
        dimmed ? "opacity-45" : ""
      } ${closing ? "pane-exit" : ""} ${
        maximized
          ? // truly fullscreen — edge-to-edge over the top bar + sidebar, no chrome
            "fixed inset-0 z-40"
          : // fade-in-up: panes ARRIVE instead of popping in (one-shot on mount)
            `fade-in-up relative rounded-lg border ${
              dropTarget
                ? // the drop destination during a reorder
                  "border-[var(--color-accent)]"
                : isDragging
                  ? // the pane you've picked up — a faint accent ring
                    "border-[var(--color-accent)]/40 ring-2 ring-[var(--color-accent)]/20"
                  : active
                    ? // focused pane — a restrained accent edge so keyboard /
                      // dictation / drops have a visible target (DESIGN.md §6). A
                      // border (not a ring) so native webviews can't occlude it.
                      "border-[var(--color-accent)]/45"
                    : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
            }`
      }`}
    >
      {/* maximize hint — settles in, holds ~2s, fades itself out (pure CSS,
          keyed so it replays per maximize). The 12px restore icon + Esc were
          both invisible affordances on a chrome-covering surface. */}
      {maximized && (
        <div
          key={pane.key + ":maxhint"}
          aria-hidden
          className="maximize-hint absolute bottom-6 left-1/2 z-50 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)]/85 px-3 py-1 font-mono text-[11px] text-[var(--color-muted)] backdrop-blur-sm"
        >
          esc to restore
        </div>
      )}
      <div className="relative flex h-[var(--aios-h-chrome)] shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-panel)] px-2.5">
        {/* activity glow — a quiet breathing seam while an agent run streams
            in this pane: ambient awareness, no dialog (reduce-motion safe). */}
        {busy && (
          <span
            aria-hidden
            className="mascot-idle pointer-events-none absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-[var(--color-accent)]/60 to-transparent"
          />
        )}
        <div
          className={`flex min-w-0 flex-1 items-center gap-1.5 ${canReorder ? "cursor-grab active:cursor-grabbing" : ""}`}
          onPointerDown={(e) => {
            if (canReorder && e.button === 0) onPaneDragStart?.(pane.key, e);
          }}
          title={canReorder ? "drag to rearrange" : undefined}
        >
          <span className={`status-dot ${DOT[t] ?? "status-dot--cold"}`} />
          <span className="truncate font-mono text-[11px] text-[var(--color-muted)]">{label}</span>
        </div>
        <div className="flex items-center gap-0.5">
          {monTarget && (
            <button
              type="button"
              onClick={toggleMon}
              title={mon ? "monitoring → WhatsApp · click to stop" : "monitor this pane → WhatsApp"}
              className={`rounded p-0.5 transition-colors ${
                mon
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              }`}
            >
              <Radio size={12} className={mon ? "animate-pulse" : ""} />
            </button>
          )}
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenAsOpen((v) => !v);
              }}
              className="rounded p-0.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              title="open as"
            >
              <EllipsisVertical size={12} />
            </button>
            {openAsOpen && (
              <div
                className="absolute right-0 top-6 z-30 w-36 overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-panel)] py-1 text-[12px] shadow-2xl"
                onMouseDown={(e) => e.stopPropagation()}
              >
                {fileTarget && (
                  <>
                    <PaneActionItem
                      icon={<Pencil size={13} />}
                      label="open editor"
                      onClick={() => {
                        onOpenEditorFile(fileTarget.path, fileTarget.name);
                        setOpenAsOpen(false);
                      }}
                    />
                    <PaneActionItem
                      icon={<Eye size={13} />}
                      label="open viewer"
                      onClick={() => {
                        onOpenViewerFile(fileTarget.path, fileTarget.name);
                        setOpenAsOpen(false);
                      }}
                    />
                    <PaneActionItem
                      icon={<Folder size={13} />}
                      label="reveal files"
                      onClick={() => {
                        onRevealFile(fileTarget.path, fileTarget.name);
                        setOpenAsOpen(false);
                      }}
                    />
                  </>
                )}
                <PaneActionItem
                  icon={<Layers size={13} />}
                  label="duplicate pane"
                  onClick={() => {
                    onDuplicate();
                    setOpenAsOpen(false);
                  }}
                />
              </div>
            )}
          </div>
          {onToggleHide && (
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), onToggleHide())}
              className="rounded p-0.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              title="Hide pane (keeps running)"
            >
              <EyeOff size={12} />
            </button>
          )}
          {onMoveLeft && (
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), onMoveLeft())}
              className="rounded p-0.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              title="Move pane left"
            >
              <MoveRight size={12} className="rotate-180" />
            </button>
          )}
          {onMoveRight && (
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), onMoveRight())}
              className="rounded p-0.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              title="Move pane right"
            >
              <MoveRight size={12} />
            </button>
          )}
          {onToggleMax && (
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), onToggleMax())}
              className="rounded p-0.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              title={maximized ? "Restore pane (Esc)" : "Maximize pane"}
            >
              {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded p-0.5 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            title="Close pane"
          >
            <X size={12} />
          </button>
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <PaneErrorBoundary
          label={pane.label || pane.kind.type}
          onError={(err, info) =>
            reportDiag(`react.${pane.kind.type}`, err, {
              action: "render",
              info: info.componentStack ?? "",
            })
          }
        >
          <Suspense fallback={<PaneLoading />}>
            {isTerminal(pane.kind) ? (
            <TerminalPane kind={pane.kind} paneKey={pane.key} />
          ) : pane.kind.type === "files" ? (
            <FilesPane initialRoot={pane.kind.root} onOpenFile={onOpenFile} />
          ) : pane.kind.type === "browser" ? (
            <BrowserPane
              label={pane.key}
              active={active}
              initialUrl={pane.kind.url}
              initialProfile={pane.kind.profile}
              memKey={pane.kind.memKey}
              onAnnotate={onAnnotate}
              onSendImage={onSendImage}
              onProfileChange={onProfileChange}
              onVideoFullscreen={onVideoFullscreen}
            />
          ) : pane.kind.type === "appcast" ? (
            <AppCastPane
              label={pane.key}
              active={active}
              initialWindowId={pane.kind.windowId}
            />
          ) : pane.kind.type === "pet" ? (
            <PetPane />
          ) : pane.kind.type === "notes" ? (
            <NotesPane onSend={onSendToAi} />
          ) : pane.kind.type === "bridges" ? (
            <BridgesPane />
          ) : pane.kind.type === "plugins" ? (
            <PluginsPane />
          ) : pane.kind.type === "pulse" ? (
            <PulsePane />
          ) : pane.kind.type === "notifications" ? (
            <NotificationCenter
              notifications={notifications}
              onMarkRead={onMarkNotificationRead}
              onOpenTarget={onOpenNotificationTarget}
              onMarkAllRead={onMarkAllNotificationsRead}
              onClear={onClearNotification}
              onClearAll={onClearAllNotifications}
            />
          ) : pane.kind.type === "money-agents" ? (
            <MoneyAgentsPane onOpenAgentChat={onOpenMoneyAgentChat} />
          ) : pane.kind.type === "apps" ? (
            <AttachAppsPane onAttachApp={onAttachApp} />
          ) : pane.kind.type === "app" ? (
            <AppAttachPane name={pane.kind.name} bundleId={pane.kind.bundleId} />
          ) : pane.kind.type === "file" ? (
            <FileViewerPane path={pane.kind.path} paneKey={pane.key} />
          ) : pane.kind.type === "editor" ? (
            <EditorPane
              path={pane.kind.path}
              name={pane.kind.name}
              paneKey={pane.key}
              line={pane.kind.line}
              col={pane.kind.col}
            />
          ) : !chatCwd ? (
            <PaneLoading />
          ) : (
            <ChatPane
              paneKey={pane.key}
              active={active}
              hidden={hidden}
              cwd={chatCwd}
              seed={pane.kind.type === "chat" ? pane.kind.seed : undefined}
              modelId={pane.kind.type === "chat" ? pane.kind.modelId : undefined}
              agentId={pane.kind.type === "chat" ? pane.kind.agentId : undefined}
              agentLabel={pane.kind.type === "chat" ? pane.kind.agentLabel : undefined}
              resume={pane.kind.type === "chat" ? pane.kind.resume : undefined}
              reattach={pane.kind.type === "chat" ? pane.kind.reattach : undefined}
              onOpenUrl={onOpenUrl}
            />
          )}
          </Suspense>
        </PaneErrorBoundary>
      </div>
      {dropTarget && (
        // pane-REORDER target affordance (path drops have their own PaneDropZone
        // overlays) — zone-aware: edges read as INSERTION (accent bar on the
        // receiving edge + washed half), center keeps the original swap. The
        // label always says exactly what release will do.
        <div className="pointer-events-none absolute inset-0 z-20">
          {dropZone === "before" ? (
            <>
              <div className="absolute inset-y-0 left-0 w-1/3 bg-[var(--color-accent)]/[0.08]" />
              <div className="absolute inset-y-2 left-0 w-[3px] rounded-full bg-[var(--color-accent)]" />
            </>
          ) : dropZone === "after" ? (
            <>
              <div className="absolute inset-y-0 right-0 w-1/3 bg-[var(--color-accent)]/[0.08]" />
              <div className="absolute inset-y-2 right-0 w-[3px] rounded-full bg-[var(--color-accent)]" />
            </>
          ) : (
            <div className="absolute inset-0 bg-[var(--color-accent)]/[0.06]" />
          )}
          <div className="absolute inset-0 grid place-items-center">
            <span className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel)]/95 px-3 py-1.5 font-mono text-[11px] text-[var(--color-text)] shadow-[var(--aios-shadow-pop)]">
              {dropZone === "before"
                ? "release to place before"
                : dropZone === "after"
                  ? "release to place after"
                  : "release to swap panes"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function Splash({ fading = false }: { fading?: boolean }) {
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--color-bg)]"
      style={{
        opacity: fading ? 0 : 1,
        transition: "opacity var(--aios-dur-slow) var(--aios-ease-out)",
      }}
    >
      <span className="brand-logo--splash font-mono text-5xl font-bold tracking-tighter text-[var(--color-accent)] [text-shadow:0_0_32px_color-mix(in_srgb,var(--color-accent)_50%,transparent)]">
        aios
      </span>
    </div>
  );
}

export default App;
