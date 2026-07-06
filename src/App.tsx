import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellRing,
  Bot,
  Camera,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Code2,
  Database,
  EllipsisVertical,
  FileText,
  Folder,
  FolderPlus,
  Gauge,
  Globe,
  Layers,
  LayoutGrid,
  Link2,
  Mic,
  Maximize2,
  Minimize2,
  Minus,
  RotateCw,
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
import {
  browserBack,
  browserCurrentUrl,
  browserForward,
  browserNavigate,
  browserOpenDevtools,
  browserReload,
  setWindowFullscreen,
} from "./lib/browser";
import { PaneMenu, type PaneMenuEntry } from "./components/PaneMenu";
import { PetOverlay } from "./components/pet/PetOverlay";
import type { PetSurface } from "./lib/pet/engine";
import { AccountMenu } from "./components/AccountMenu";
import { ShortcutHud } from "./components/ShortcutHud";
import { Onboarding } from "./components/Onboarding";
import { CommandPalette, loadMru as loadCommandMru, type Command } from "./components/CommandPalette";
import { FileFinder } from "./components/FileFinder";
import { GlobalSearch } from "./components/GlobalSearch";
import { IdleDashboard } from "./components/IdleDashboard";
import { MirrorViewer } from "./components/MirrorViewer";
import { ScheduledAgentsSection, type ScheduledAgentChatState } from "./components/ScheduledAgentsSection";
import { OracleRoster } from "./components/OracleRoster";
import { PaneErrorBoundary } from "./components/PaneErrorBoundary";
import { ResizableGrid } from "./components/ResizableGrid";
import { WindowLayer } from "./components/WindowLayer";
import { ChatTabStrip } from "./components/ChatTabStrip";
import { VoiceButton } from "./components/VoiceButton";
import type { PaneKind } from "./components/TerminalPane";
import { listen, emit } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";

import { appshot, deleteOracle, listOracles, reapTerminals, type OracleInfo } from "./lib/pty";
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
import { initTheme, setTheme } from "./lib/theme";
import { dictateCancel, dictateStart, dictateStop } from "./lib/voice";
import { parseConductor, type ConductorStep } from "./lib/conductor";
import { monitorStart, monitorStop } from "./lib/monitor";
import {
  SCHEDULED_AGENTS,
  buildScheduledAgentChatSeed,
  buildScheduledAgentRunCommand,
  dueScheduledAgents,
  loadConfiguredScheduledAgents,
  loadScheduledAgentChatSession,
  scheduledAgentById,
  saveScheduledAgentLastScheduledRun,
} from "./lib/scheduledAgents";
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
  paneNeedsAttention,
  subscribePaneAttention,
  registerSpawnPane,
  onChatBusy,
  setPaneOverlay,
  paneMenuExtras,
  type SpawnPaneKind,
  type SpawnCtx,
  type PayloadKind,
} from "./lib/paneBus";
import { refreshModelCatalogAtLaunch } from "./lib/modelCatalog";
import { containingDir, paneFileTarget } from "./lib/paneOpenActions";
import { basename as pathBasename } from "./lib/paths.ts";
import { SidebarUsage } from "./components/SidebarUsage";
import { AnimatePresence, m } from "motion/react";

import { BorderBeam } from "./components/fx/BorderBeam";
import { ClickSpark } from "./components/fx/ClickSpark";
import { dockMagnifyMove, dockMagnifyReset } from "./components/fx/dockMagnify";
import { HoverBorderGradient } from "./components/fx/HoverBorderGradient";
import { spotlightMove } from "./components/fx/spotlightGlow";
import { modalPop, overlayFade, paneExit, toastPop } from "./components/fx/motionTokens";
import { trapTab } from "./components/ui";
import { loadSettings, saveSettings, applyFlashLevel, subscribe as subscribeSettings, DEFAULT_SETTINGS, type AppSettings } from "./lib/settings";
import { applyAppearance } from "./lib/appearance";
import { MOD, chord, fmtChord, isApple } from "./lib/platform";
import { homeDir, startupOpenPane } from "./lib/fs";
import { detectProject, scanWorkspaces, type ProjectInfo } from "./lib/run";
import { touchProjectAccess } from "./lib/projectRecents";
import {
  type ProjectWorkspace,
  loadProjectWorkspacesStore,
  mergeProjectWorkspaces,
  flattenProjectWorkspaces,
  getScanRoots,
  subscribeProjectWorkspaces,
  normRoot,
  allComponents,
  projectShapeLabel,
} from "./lib/projectWorkspaces";
import { WorkspaceLaunchPicker } from "./components/WorkspaceLaunchPicker";
import { isHttpPaneTarget, resolvePaneFileTarget, targetLabel } from "./lib/paneRouting";
import { buildAppCommands } from "./lib/appCommands";
import type { AgentAction } from "./lib/agentActions";
import { invoke, isTauriRuntime } from "./lib/tauri";
import { reportDiag, reportUsage } from "./lib/diag";
import { checkForUpdate } from "./lib/updater";
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
import { gridTrackStorageKey, loadGridTracks, saveGridTracks } from "./lib/paneLayout";
import {
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  saveWorkspace,
  subscribeWorkspaces,
  type Workspace,
} from "./lib/workspaces";
import {
  listWorkSessions,
  createWorkSession,
  touchWorkSession,
  removeWorkSession,
  setWorkSessionStatus,
  subscribe as subscribeWorkSessions,
  type WorkSession,
  type WorkSessionPane,
} from "./lib/workSessions";
import { routeControl, type ControlEnvelope, type ControlResult } from "./lib/control";
import {
  appendDoc as sncAppendDoc,
  getDoc as sncGetDoc,
  listDocs as sncListDocs,
  saveToNotes as sncSaveToNotes,
} from "./lib/snc";
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
const ScheduledAgentsPane = lazy(() =>
  import("./components/ScheduledAgentsPane").then((m) => ({ default: m.ScheduledAgentsPane })),
);
const HistoryPane = lazy(() =>
  import("./components/HistoryPane").then((m) => ({ default: m.HistoryPane })),
);
const ProjectsPane = lazy(() =>
  import("./components/ProjectsPane").then((m) => ({ default: m.ProjectsPane })),
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

/** Which pet-affinity surface a pane type counts as (living-cockpit P2) —
 *  the creature's evolution flavor grows from where the owner actually lives. */
function petSurfaceOf(kind: string | undefined): PetSurface | null {
  switch (kind) {
    case "shell":
    case "oracle":
    case "tmux":
      return "terminal";
    case "chat":
      return "chat";
    case "browser":
      return "browser";
    case "files":
      return "files";
    case "notes":
      return "notes";
    default:
      return null;
  }
}

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
// windowed-workspace geometry (PLAN-odysseus-feel.md W1) — one global layout
// keyed by pane key; named-workspace snapshots still only carry grid tracks.
const WINDOW_LAYOUT_KEY = "aios.windows.layout";
// rail items hidden in windowed mode — the chat tab strip owns "new chat".
const WINDOWED_HIDDEN_APPS: ReadonlySet<string> = new Set(["chat"]);
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
  if (kind.type === "chat") {
    // KEEP the conversation's durable identity — `resume` (stamped current by
    // handleSessionRecorded as sessions record/fork) is what makes the next
    // launch reopen this pane with its transcript and --resume continuity;
    // stripping it was why restored chat panes came up blank until reopened
    // from History. One-shot fields still drop: `seed` (would re-fire the
    // launcher prompt), `reattach` (backend ids die with the process),
    // `findText` (a one-time deep-link), `goal` (owned by live pane state).
    return {
      type: "chat",
      cwd: kind.cwd,
      modelId: kind.modelId,
      agentId: kind.agentId,
      agentLabel: kind.agentLabel,
      resume: kind.resume
        ? {
            id: kind.resume.id,
            title: kind.resume.title,
            engine: kind.resume.engine,
            model: kind.resume.model,
          }
        : undefined,
    };
  }
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

/** The model a scheduled-agent chatpane should boot on — the user's base model
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
  // Kill the OS WebView right-click menu (Back/Reload/Save as/Print/Inspect) app-
  // wide so our own pane menus own the gesture — EXCEPT over editable text, where
  // the native copy/paste/spellcheck/undo menu is still the right tool. Panes open
  // their custom menu in PaneCard.onContextMenu (which fires first, at the React
  // root); this window-level net catches everywhere else (sidebar, top bar, idle).
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest('input, textarea, [contenteditable="true"], [contenteditable=""]')) return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Settings is lazy: mount it on FIRST open and keep it mounted after, so its
  // internal AnimatePresence exit can play (the chunk still loads on demand).
  const [settingsEverOpened, setSettingsEverOpened] = useState(false);
  useEffect(() => {
    if (settingsOpen) setSettingsEverOpened(true);
  }, [settingsOpen]);
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
  // The windowed workspace IS the desktop workspace (PLAN-odysseus-feel.md —
  // W5 flipped the default, this removed the toggle). Compact/mobile web is
  // the only surface that still runs the stacked-grid path.
  const windowedWorkspace = !compactWebLayout;
  // mission-control-style pane overview: fan out every open pane to switch.
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // pane key pending a close-confirm (busy chat: keep-running vs kill).
  const [closePrompt, setClosePrompt] = useState<string | null>(null);
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
  // ── windowed-mode chat canvas (PLAN-odysseus-feel.md W1.5) ─────────────────
  // Chat panes render as ONE rearmost canvas (tools float above); this is the
  // conversation currently showing there. Panes stay mounted when toggled away
  // — same state-preserving display:none contract as hiddenKeys.
  const [canvasChatKey, setCanvasChatKey] = useState<string | null>(null);
  // The idle dashboard as a lock-screen-style overlay: auto-shown when nothing
  // is open (not dismissible then), summonable via the chat strip's home button.
  const [homeOverlay, setHomeOverlay] = useState(false);
  // bump → WindowLayer tiles all visible windows into an even grid (W2).
  const [arrangeNonce, setArrangeNonce] = useState(0);
  // docked side panels reserve canvas room (W2) — px insets per side, fed by
  // WindowLayer's dock reservations; the chat canvas + its chrome shift over.
  const [dockInsets, setDockInsets] = useState({ left: 0, right: 0 });
  // usage moved out of the sidebar footer into a POPOVER anchored to its
  // trigger (W1.6) — flies out beside the sidebar instead of stealing focus.
  const [usageOpen, setUsageOpen] = useState<{ left: number; bottom: number } | null>(null);
  const usageBtnRef = useRef<HTMLButtonElement>(null);
  const usagePopRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!usageOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setUsageOpen(null);
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (usagePopRef.current?.contains(t) || usageBtnRef.current?.contains(t)) return;
      setUsageOpen(null);
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onDown);
    };
  }, [usageOpen]);
  // A freshly opened conversation takes the canvas (and any pane spawned from
  // the home overlay dismisses it).
  const prevChatKeysRef = useRef<string[]>([]);
  useEffect(() => {
    const chatKeys = panes.filter((p) => p.kind.type === "chat").map((p) => p.key);
    const added = chatKeys.filter((k) => !prevChatKeysRef.current.includes(k));
    prevChatKeysRef.current = chatKeys;
    if (added.length > 0) setCanvasChatKey(added[added.length - 1]);
  }, [panes]);
  const prevPaneCountRef = useRef(0);
  useEffect(() => {
    if (panes.length > prevPaneCountRef.current) setHomeOverlay(false);
    prevPaneCountRef.current = panes.length;
  }, [panes.length]);
  // Esc dismisses the summoned home overlay before any other Esc behavior
  // (capture phase) — lock-screen semantics.
  useEffect(() => {
    if (!homeOverlay) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      setHomeOverlay(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [homeOverlay]);
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
  // Work Sessions (Tier 1): the "Continue working" units — goal + chat thread +
  // panes + project, bound into one resumable thing. See lib/workSessions.ts +
  // misc/PLAN-work-sessions.md.
  const [workSessions, setWorkSessions] = useState<WorkSession[]>(listWorkSessions);
  useEffect(() => subscribeWorkSessions(() => setWorkSessions(listWorkSessions())), []);
  // chat pane key → its durable session id (reported by ChatPane once recorded) —
  // lets "save work session" bind EVERY open chat, not just the most-recent.
  const chatMetaByPaneKey = useRef<
    Map<string, { id: string; cwd?: string; title: string; engine?: string; model?: string }>
  >(new Map());
  const handleSessionRecorded = useCallback(
    (info: { paneKey?: string; sessionId: string; title: string; cwd?: string; engine?: string; model?: string }) => {
      if (!info.paneKey) return;
      // sessionId "" = the pane dropped its conversation (/clear, cwd switch):
      // forget the binding so a restart doesn't resurrect the dropped thread.
      if (!info.sessionId) {
        chatMetaByPaneKey.current.delete(info.paneKey);
        setPanes((ps) =>
          ps.map((p) =>
            p.key === info.paneKey && p.kind.type === "chat" && p.kind.resume
              ? { ...p, kind: { ...p.kind, resume: undefined } }
              : p,
          ),
        );
        return;
      }
      chatMetaByPaneKey.current.set(info.paneKey, {
        id: info.sessionId,
        cwd: info.cwd,
        title: info.title,
        engine: info.engine,
        model: info.model,
      });
      // Stamp the conversation identity onto the pane itself: layout persistence
      // keeps `resume` (see persistableKind), so the next app launch reopens
      // this exact thread — transcript repaint + --resume — instead of a blank
      // pane. Inert for the live pane (ChatPane reads `resume` only at mount).
      setPanes((ps) =>
        ps.map((p) => {
          if (p.key !== info.paneKey || p.kind.type !== "chat") return p;
          const cur = p.kind.resume;
          if (cur?.id === info.sessionId && (!info.title || cur?.title === info.title)) return p;
          return {
            ...p,
            kind: {
              ...p.kind,
              resume: {
                id: info.sessionId,
                title: info.title || cur?.title || p.label,
                engine: info.engine,
                model: info.model,
              },
            },
          };
        }),
      );
    },
    [],
  );
  const [wsDraft, setWsDraft] = useState<string | null>(null);
  // a workspace opened from the home / projects pane → the component·env launch
  // picker (terminal vs chat). Declared up here so overlayOpen can include it —
  // native webviews paint above html and would otherwise occlude the picker.
  const [launchWs, setLaunchWs] = useState<ProjectWorkspace | null>(null);
  // "save work session" modal draft (title + goal); null = closed.
  const [sessionDraft, setSessionDraft] = useState<{ title: string; goal: string } | null>(null);
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
    launchWs != null ||
    sessionDraft != null ||
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

  // Launch-time model-catalog sweep: ask every connected source (claude OAuth /
  // API keys / local ollama) for its CURRENT model lineup, so a newly-shipped
  // model is pickable without waiting for an app update. Fire-and-forget; an
  // offline launch keeps the static catalog + last good sweep.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    // push the local-endpoint setting to the backend (chat.rs Local provider)
    // and sweep with BOTH local endpoints so their live model lists overlay.
    const localEp = loadSettings().localApiEndpoint;
    void invoke("set_local_api_endpoint", { endpoint: localEp }).catch(() => {});
    refreshModelCatalogAtLaunch(null, localEp);
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
    reapTerminals(keep, loadSettings().terminalSocket || "aios").catch(() => {
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

  // Toast: ONE dismiss timer; AnimatePresence owns the exit beat (the old
  // toastLeaving + second-timer race plumbing died with it). Re-arming on a
  // replacing flash keeps the first flash's timeout from clearing it early.
  const toastTimer = useRef<number | undefined>(undefined);
  const flash = useCallback((msg: string) => {
    clearTimeout(toastTimer.current);
    setToast(msg);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    // macOS ONLY. Windows/Linux close behavior is OWNED BY RUST
    // (on_window_event + the CloseToTray flag in lib.rs) — authoritative and
    // immune to JS event-bridge timing. We don't even REGISTER a JS close
    // handler off-mac, so nothing here can race the Rust handler — that race is
    // exactly what left X doing nothing on the built Windows app.
    if (!isTauriRuntime() || !isApple) return;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    const win = getCurrentWindow();

    win
      .onCloseRequested(async (event) => {
        // macOS apps live in the dock — X backgrounds the window (hide + keep
        // busy chats running, reachable again via the Reopen event). (Per-pane
        // busy-chat prompts still guard closing individual chat panes.)
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

  // Mirror the minimizeToTray setting into the Rust close flag (boot + on every
  // settings change), so the authoritative on_window_event handler knows whether
  // to hide-to-tray or quit. Windows/Linux only matters; harmless elsewhere.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    const sync = () =>
      invoke("set_close_to_tray", { enabled: loadSettings().minimizeToTray }).catch((e) =>
        reportDiag("app.window", e, { action: "setCloseToTray" }),
      );
    sync();
    return subscribeSettings(sync);
  }, []);

  // Quiet boot update check: a few seconds after launch (let the app settle),
  // ask GitHub Releases if a newer signed build exists and, if so, nudge toward
  // Settings › about where the one-click download/install/relaunch lives. Silent
  // on "up to date" and on errors (offline etc.) — it must never interrupt.
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let cancelled = false;
    const t = setTimeout(() => {
      checkForUpdate()
        .then((u) => {
          if (!cancelled && u) flash(`update ${u.version} available — Settings › about`);
        })
        .catch(() => {
          /* offline / transient — the manual check in Settings surfaces real errors */
        });
    }, 6000);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [flash]);

  const spawn = useCallback((kind: PaneContent, label: string): string => {
    const key = nextKey();
    // Light usage event (kind:"usage") — seeds the "what I use" prioritization.
    // Carries only the pane-type enum, never any argument/label content.
    reportUsage("pane.spawn", kind.type);
    // Access recency for the lock screen's "continue" shelf: any pane opened
    // WITH a cwd is a real project touch (terminal-here, chat-here, files).
    if ("cwd" in kind && typeof kind.cwd === "string" && kind.cwd) {
      touchProjectAccess(kind.cwd);
    }
    // EXIT FULLSCREEN ON ANY NEW-PANE SPAWN (R2a FIX 3): if a pane currently owns
    // OS fullscreen / maximize, a freshly-spawned pane would be invisible behind
    // it (the maximized pane fills the window + every other pane deactivates). Drop
    // fullscreen first so the new pane actually appears in the grid and the user SEES
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
  // session — the user's #1 ask. (The OS toast still fires from the backend; this is
  // the in-app bell + record. Wiring the OS-toast CLICK is Phase 2.)
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<{ kind: string; session_id: number; title?: string; claude_id?: string | null }>("aios-notify", ({ payload }) => {
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
          // claudeId = the durable conversation uuid: keeps this notification
          // clickable even after the backend session id dies with the process.
          target: { type: "chat", sessionId: payload.session_id, title, claudeId: payload.claude_id ?? undefined },
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
        case "plugins":
          spawn({ type: "plugins" }, ctx?.label ?? "plugins");
          break;
        case "bridges":
          spawn({ type: "bridges" }, ctx?.label ?? "channels");
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
      return;
    }
    // no context override → the configured default (settings → general →
    // "default pane type"; S3: the picker existed but ⌘T always spawned a
    // terminal regardless).
    const def = loadSettings().defaultPaneType;
    if (def === "browser") spawn({ type: "browser" }, "browser");
    else if (def === "files") spawn({ type: "files" }, "files");
    else addShell();
  }, [activeKey, panes, addShell, spawn]);
  const addOracle = useCallback(
    (identity: string) => spawn({ type: "oracle", identity }, identity),
    [spawn],
  );
  const addTmux = useCallback(
    (socket: string, session: string, label?: string) =>
      spawn({ type: "tmux", socket, session }, label?.trim() || session),
    [spawn],
  );
  const closePane = useCallback((key: string) => {
    // If the pane being closed owns the OS fullscreen (e.g. a maximized browser
    // pane with a video in fullscreen), drop fullscreen first — otherwise the
    // window stays fullscreen with the owning pane gone ("bugs out on close").
    setMaximizedKey((m) => {
      if (m === key) setWindowFullscreen(false).catch((e) => reportDiag("app.window", e, { action: "exitFullscreen" }));
      return m === key ? null : m;
    });
    if (prevMaxRef.current === key) prevMaxRef.current = null;
    if (focusedPane.current === key) focusedPane.current = null;
    // Remove immediately — AnimatePresence (popLayout) around the grid children
    // plays the exit beat on the leaving PaneCard while the grid-reflow
    // transition glides the survivors in. No closing flags, no timers.
    // Drop any session-restore memory for this pane key — a pane closed on
    // purpose shouldn't have its last url linger in the browser-mem map (it
    // also won't be in the next layout, so this just keeps the map from
    // accumulating dead entries). No-op for non-browser keys.
    forgetUrl(key);
    setPanes((p) => p.filter((x) => x.key !== key));
    setHiddenKeys((h) => h.filter((k) => k !== key));
    setActiveKey((a) => (a === key ? null : a));
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
      // settings → general → "confirm closing oracle panes" (S3: the toggle
      // existed but nothing read it). Detach-only in truth — the tmux session
      // survives — so the confirm is native (window.confirm keeps it
      // dependency-free and can't be occluded by native webviews).
      const pane = panes.find((p) => p.key === key);
      if (
        pane?.kind.type === "oracle" &&
        loadSettings().confirmCloseOraclePane &&
        !window.confirm(
          `close the "${pane.label}" pane?\n\nthe oracle session keeps running — reattach any time from the roster.`,
        )
      ) {
        return;
      }
      closePane(key);
    },
    [closePane, panes],
  );
  const resumeChat = useCallback(
    // `findText` (a History-pane search query) makes the resumed pane open its
    // find bar on that text — a deep-link straight to the matched message.
    (s: ChatSessionInfo, findText?: string) =>
      spawn(
        // carry cwd so claude `--resume` runs in the SAME project dir the chat was
        // recorded in — otherwise claude can't find the session ("No conversation
        // found with session ID"). engine+model boot a resumed codex thread on codex.
        {
          type: "chat",
          cwd: s.cwd || undefined,
          resume: { id: s.id, title: s.title, engine: s.engine, model: s.model, findText },
        },
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
  const [scheduledAgentSessionVersion, setScheduledAgentSessionVersion] = useState(0);
  // Structured workspaces (auto-scanned from the configured roots; see
  // lib/projectWorkspaces.ts + PLAN-projects-workspaces.md) merged with the user's
  // store (custom adds / hides / name overrides — CRUD from Settings). Flattened
  // to the legacy `ProjectInfo[]` for the homescreen/palette consumers that still
  // take it (the rich tree drives the Settings editor).
  const [scannedWs, setScannedWs] = useState<ProjectWorkspace[]>([]);
  const [projStore, setProjStore] = useState(loadProjectWorkspacesStore);
  useEffect(() => subscribeProjectWorkspaces(() => setProjStore(loadProjectWorkspacesStore())), []);
  const projectWorkspaces = useMemo(
    () => mergeProjectWorkspaces(scannedWs, projStore),
    [scannedWs, projStore],
  );
  const projects = useMemo(() => flattenProjectWorkspaces(projectWorkspaces), [projectWorkspaces]);
  // root → shape label for structured workspaces — the homescreen shows it as a
  // hint chip (and structured ones open the launch picker).
  const shapeByRoot = useMemo(() => {
    const m: Record<string, string> = {};
    for (const ws of projectWorkspaces) {
      if (allComponents(ws).length > 1) m[normRoot(ws.root)] = projectShapeLabel(ws);
    }
    return m;
  }, [projectWorkspaces]);
  const [home, setHome] = useState<string>("");
  useEffect(() => {
    let alive = true;
    const load = () => {
      listOracles(loadSettings().terminalSocket || "aios").then((v) => alive && setOracles(v)).catch((e) => reportDiag("app.load", e, { action: "oracles" }));
      listChatSessions(12).then((v) => alive && setChats(v)).catch((e) => reportDiag("app.load", e, { action: "chatSessions" }));
      listChatLive().then((v) => alive && setLiveChats(v)).catch((e) => reportDiag("app.load", e, { action: "chatLive" }));
      if (alive) setScheduledAgentSessionVersion(Date.now());
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
    scanWorkspaces(getScanRoots())
      .then((next) => {
        setScannedWs(next);
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

  // Open a project from the homescreen (or the Projects pane). ANY known workspace
  // opens the launch picker so you choose WHERE to land (root or a component) and
  // HOW (terminal or chat agent) — a fullstack one just shows its root row,
  // structured ones add the component/env targets. A path with no backing
  // workspace (rare) falls back to a plain terminal.
  const openProject = useCallback(
    (p: ProjectInfo) => {
      // recency touch here too — the workspace-picker path bypasses spawn's
      // cwd hook until a component actually launches.
      touchProjectAccess(p.root);
      const ws = projectWorkspaces.find((w) => normRoot(w.root) === normRoot(p.root));
      if (ws) {
        setLaunchWs(ws);
        return;
      }
      spawn({ type: "shell", cwd: p.root }, p.name);
    },
    [projectWorkspaces, spawn],
  );

  const fireAppshot = useCallback(async () => {
    try {
      const path = await appshot(undefined, loadSettings().terminalSocket || "aios");
      flash(`appshot → oracle · ${pathBasename(path)}`);
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

  // Targeted variant: route into a SPECIFIC chat pane (the files context menu
  // offers a picker when several conversations are open) and surface it.
  const routeToChatTarget = useCallback(
    (paneKey: string, text: string) => {
      const w = paneWriters.get(paneKey);
      if (!w) {
        routeToChat(text);
        return;
      }
      w(text);
      setCanvasChatKey(paneKey);
      focusedPane.current = paneKey;
      setActiveKey(paneKey);
      flash("→ chat");
    },
    [routeToChat, flash],
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
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "j") {
        // ⌘⇧J — Conductor push-to-talk toggle (start listening / run the plan).
        // Plain ⌘J stays the focused-pane dictation (VoiceButton).
        e.preventDefault();
        void conductorToggleRef.current();
      } else if (e.key === "Escape" && conductorStateRef.current === "listening") {
        // Esc while the conductor listens cancels the recording (before the
        // maximize-restore Esc below can swallow it).
        e.preventDefault();
        conductorCancelRef.current();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "f") {
        // ⌘⇧F — global content search (must come BEFORE the bare ⌘F fullscreen
        // branch below, which also keys on "f").
        e.preventDefault();
        setGlobalSearchOpen((v) => !v);
      } else if (mod && !e.shiftKey && e.key.toLowerCase() === "p") {
        // ⌘P — fuzzy file finder ("go to file"). the user's #1 pain.
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
  // all DIE exactly when a pane is focused (the user got stuck unable to exit a
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
          // find-in-page; else maximize/restore the pane (the path the user hit).
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

  // ── Work Sessions (Tier 1) ──────────────────────────────────────────────────
  // A Work Session = the NON-chat panes (terminals/files/browser/editor) as a
  // layout + the chat you were most recently in (chats[0], bound by id) + a goal —
  // so resume restores the tools, re-threads the conversation, AND re-seeds the
  // goal into the chat's goal box. (Multi-chat binding is a later increment.)
  // "save work session" opens a title+goal modal; the snapshot happens on confirm.
  const saveCurrentSession = useCallback(() => {
    if (panes.length === 0) {
      flash("nothing open to save as a work session");
      return;
    }
    setSessionDraft({ title: chats[0]?.title || "work session", goal: "" });
  }, [panes.length, chats, flash]);

  // confirm the modal → snapshot the live deck (read here, not at open-time).
  const commitSession = useCallback(
    (title: string, goal: string) => {
      const sessionPanes: WorkSessionPane[] = [];
      // bind EVERY open chat that has recorded a durable id (multi-chat); chats are
      // bound by id, not captured as layout panes (resume re-threads them).
      const chatIds: string[] = [];
      let firstChatCwd: string | undefined;
      for (const p of panes) {
        if (p.kind.type === "chat") {
          const meta = chatMetaByPaneKey.current.get(p.key);
          if (meta?.id && !chatIds.includes(meta.id)) {
            chatIds.push(meta.id);
            if (!firstChatCwd) firstChatCwd = meta.cwd;
          }
          continue;
        }
        const kind = persistableKind(p.kind);
        if (kind) sessionPanes.push({ key: p.key, label: p.label, kind });
      }
      // fall back to the most-recent global chat if no open chat reported an id yet.
      const boundChats = chatIds.length ? chatIds : chats[0] ? [chats[0].id] : [];
      const finalTitle = title.trim() || chats[0]?.title || sessionPanes[0]?.label || "work session";
      createWorkSession({
        title: finalTitle,
        goal: goal.trim() || undefined,
        projectRoot: firstChatCwd || chats[0]?.cwd || undefined,
        chatSessionIds: boundChats,
        panes: sessionPanes,
        tracks: loadGridTracks(gridTrackStorageKey(GRID_TRACK_KEY, cols, rows), cols, rows),
      });
      flash(`saved work session “${finalTitle}”`);
    },
    [panes, chats, cols, rows, flash],
  );

  // Resume a Work Session from the home rail: restore its tool panes, re-thread its
  // bound chat (seeding the saved goal into its goal box), bump recency.
  const resumeWorkSession = useCallback(
    (s: WorkSession) => {
      if (s.panes.length > 0) {
        applyWorkspace({
          name: s.title,
          savedAt: s.createdAt,
          panes: s.panes.map((p) => ({ key: p.key ?? "", label: p.label, kind: p.kind })),
          tracks: s.tracks ?? null,
        });
      }
      // re-thread every bound chat (seeding the session goal into each).
      for (const chatId of s.chatSessionIds) {
        const c = chats.find((x) => x.id === chatId);
        spawn(
          {
            type: "chat",
            cwd: c?.cwd || s.projectRoot,
            resume: c
              ? { id: c.id, title: c.title, engine: c.engine, model: c.model }
              : { id: chatId, title: s.title },
            goal: s.goal,
          },
          c?.title || s.title,
        );
      }
      touchWorkSession(s.id);
    },
    [applyWorkspace, chats, spawn],
  );

  // ── Control plane (Tier 2) ───────────────────────────────────────────────────
  // ONE dispatcher mapping control commands → the SAME closures the UI calls, so an
  // external agent (via the aios-control MCP → a localhost HTTP server in Rust →
  // emit/listen, landing in the next batch) drives the app identically to a human.
  // The command vocabulary + pure routing live in lib/control.ts; here we supply
  // the handlers. The listener below is INERT until the Rust transport emits.
  const dispatchControl = useCallback(
    (env: ControlEnvelope): ControlResult | Promise<ControlResult> =>
      routeControl(env, {
        paneOpen: (content, label) => {
          const kind = content as PaneContent;
          spawn(kind, label ?? kind.type);
        },
        paneOpenFile: (path) => openFile(path, pathBasename(path) || path),
        paneClose: (key, force) => (force ? closePane(key) : requestClose(key)),
        paneMaximize: (key, on) => setMaximizedKey(on ? key : null),
        paneHide: (key, on) =>
          setHiddenKeys((cur) =>
            on ? (cur.includes(key) ? cur : [...cur, key]) : cur.filter((k) => k !== key),
          ),
        paneResumeChat: (chatId) => {
          const c = chats.find((x) => x.id === chatId);
          if (c) resumeChat(c);
          else spawn({ type: "chat", resume: { id: chatId, title: "chat" } }, "chat");
        },
        sidebarToggle: (on) => setSidebarOpen((v) => on ?? !v),
        terminalSend: (key, text) => {
          const w = paneWriters.get(key);
          if (!w) return false;
          w(text);
          return true;
        },
        browserOpen: (url, label) => spawn({ type: "browser", url }, label ?? "browser"),
        // browser.* drive an EXISTING pane by key (= its webview label). Verify the
        // pane is a live browser first, else the native call is a silent no-op.
        browserNavigate: (key, url) => {
          if (!panes.some((x) => x.key === key && x.kind.type === "browser")) return false;
          void browserNavigate(key, url).catch((e) => reportDiag("browser.nav", e, { action: "navigate" }));
          return true;
        },
        browserBack: (key) => {
          if (!panes.some((x) => x.key === key && x.kind.type === "browser")) return false;
          void browserBack(key).catch((e) => reportDiag("browser.nav", e, { action: "back" }));
          return true;
        },
        browserForward: (key) => {
          if (!panes.some((x) => x.key === key && x.kind.type === "browser")) return false;
          void browserForward(key).catch((e) => reportDiag("browser.nav", e, { action: "forward" }));
          return true;
        },
        browserReload: (key) => {
          if (!panes.some((x) => x.key === key && x.kind.type === "browser")) return false;
          void browserReload(key).catch((e) => reportDiag("browser.nav", e, { action: "reload" }));
          return true;
        },
        layoutList: () =>
          listWorkspaces().map((w) => ({ name: w.name, panes: w.panes.length, savedAt: w.savedAt })),
        layoutSave: (name) => saveCurrentWorkspace(name),
        layoutApply: (name) => {
          const ws = getWorkspace(name);
          if (!ws) return false;
          applyWorkspace(ws);
          return true;
        },
        settingsGet: (key) => {
          const all = loadSettings();
          return key ? (all as unknown as Record<string, unknown>)[key] : all;
        },
        settingsSet: (key, value) => {
          const defs = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
          if (!(key in defs)) return { ok: false, error: `unknown setting "${key}"` };
          const def = defs[key];
          // enforce the primitive type when both sides are non-null; nullable
          // settings (e.g. chatModel) accept a string or null.
          if (def !== null && value !== null && typeof value !== typeof def)
            return { ok: false, error: `setting "${key}" expects ${typeof def}` };
          const next = saveSettings({ [key]: value } as Partial<AppSettings>);
          return { ok: true, value: (next as unknown as Record<string, unknown>)[key] };
        },
        // Oracles — the cockpit's current roster (refreshed on an interval), open
        // one as a pane, or kill its tmux session. Kill checks the live roster so
        // a wrong id reports "no oracle" instead of silently doing nothing.
        oracleList: () => oracles,
        oracleSpawn: (id) => addOracle(id),
        oracleKill: (id, force) => {
          if (!oracles.some((o) => o.identity === id)) return false;
          void deleteOracle(id, force, loadSettings().terminalSocket || "aios").catch((e) =>
            reportDiag("oracle.delete", e, { action: "kill" }),
          );
          return true;
        },
        // Notes — the owner's Stone & Chisel notebook (Notes × S&C epic, N3).
        // The agent writes to the SAME cloud library the pane and his phone
        // read; list returns trimmed metas so replies stay small.
        notesList: async (opts) => {
          const rows = await sncListDocs({ q: opts.q, tag: opts.tag });
          return rows.map((r) => ({
            id: r.id,
            title: r.title,
            tags: r.tags,
            pinned: r.pinned,
            updatedAt: r.updatedAt,
          }));
        },
        notesRead: async (id) => {
          const d = await sncGetDoc(id);
          return { id: d.id, title: d.title, content: d.content, tags: d.tags, updatedAt: d.updatedAt };
        },
        notesCreate: async (seed) => {
          const d = await sncSaveToNotes(seed.content, {
            title: seed.title,
            tags: seed.tags ?? ["from-aios", "agent"],
          });
          return { id: d.id, title: d.title, updatedAt: d.updatedAt };
        },
        notesAppend: (id, text) => sncAppendDoc(id, text),
        paneList: () =>
          panes.map((p) => ({
            key: p.key,
            label: p.label,
            kind: p.kind.type,
            hidden: hiddenKeys.includes(p.key),
            maximized: maximizedKey === p.key,
          })),
        stateGet: () => ({
          panes: panes.map((p) => ({ key: p.key, label: p.label, kind: p.kind.type })),
          hiddenKeys,
          maximizedKey,
          sidebarOpen,
          counts: { panes: panes.length },
        }),
      }),
    [spawn, openFile, closePane, requestClose, chats, resumeChat, panes, hiddenKeys, maximizedKey, sidebarOpen, saveCurrentWorkspace, applyWorkspace, oracles, addOracle],
  );
  // Keep a fresh ref so the listener can register ONCE yet always run the latest
  // dispatchControl (which closes over changing pane/state) — no re-listen churn.
  const dispatchControlRef = useRef(dispatchControl);
  dispatchControlRef.current = dispatchControl;
  useEffect(() => {
    if (!isTauriRuntime()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<ControlEnvelope>("aios://control", ({ payload }) => {
      // notes verbs resolve async (network) — await before replying so the
      // agent gets data, not a race. routeControl promises never reject.
      void Promise.resolve(dispatchControlRef.current(payload)).then((res) =>
        emit("aios://control-reply", { id: payload?.id, ...res }).catch(() => {}),
      );
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((e) => reportDiag("app.listen", e, { action: "control" }));
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

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
      projectWorkspaces,
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
      saveWorkSession: saveCurrentSession,
      workSessions,
      resumeWorkSession,
    });
  }, [spawn, fireAppshot, chats, oracles, resumeChat, addOracle, runF5, loadProjects, projects, projectWorkspaces, home, runProject, panes.length, activeKey, workspaces, applyWorkspace, removeWorkspace, saveCurrentSession, workSessions, resumeWorkSession]);
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
      const wsUrl = mirrorWebSocketUrl(mirrorPairing);
      if (!wsUrl) {
        // No mirror endpoint configured (VITE_AIOS_MIRROR_URL unset) — the
        // feature is opt-in, so stay dormant instead of crashing on mount.
        setMirrorStatus("off");
        return;
      }
      setMirrorStatus("connecting");
      const ws = new WebSocket(wsUrl);
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
        // replays its buffer and goes live, so the user lands back in the exact
        // chat. `resume` rides along as the fallback: if the backend session is
        // gone (app restarted since the notification fired), the pane degrades
        // to reopening the conversation from history instead of dead-ending.
        const boundKey = paneKeyForChatSession(t.sessionId);
        const open = boundKey ? panes.find((p) => p.key === boundKey) : undefined;
        if (open) focusPane(open.key);
        else
          spawn(
            {
              type: "chat",
              reattach: t.sessionId,
              resume: t.claudeId ? { id: t.claudeId, title: t.title ?? "chat" } : undefined,
            },
            t.title ?? "chat",
          );
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
  const openScheduledAgentChat = useCallback(
    // Returns the pane key it landed in (null if the agent is unknown) so the
    // scheduler can deep-link its notification at the background pane.
    (id: string, label: string, command?: string): string | null => {
      const agent = scheduledAgentById(id);
      if (!agent) return null;
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
        return existingPane.key;
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
        return key;
      }
      const saved = loadScheduledAgentChatSession(agent.id);
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
        return key;
      }
      const key = spawn(
        {
          type: "chat",
          seed: command ? `${buildScheduledAgentChatSeed(agent)}\n\noperator command:\n${command}` : buildScheduledAgentChatSeed(agent),
          modelId: agentChatModelId(),
          agentId: agent.id,
          agentLabel: agent.label,
        },
        label,
      );
      if (command) {
        setHiddenKeys((current) => (current.includes(key) ? current : [...current, key]));
      }
      return key;
    },
    [focusPane, liveChats, panes, spawn],
  );

  // (the agent scheduler lives below, beside the agent bootstrap — upgraded
  //  in W4-7 with deep-linked notifications + the lib cadence parser)
  const openScheduledAgentChatRef = useRef(openScheduledAgentChat);
  useEffect(() => {
    openScheduledAgentChatRef.current = openScheduledAgentChat;
  }, [openScheduledAgentChat]);

  // ── W4-8: Conductor — speak a workspace into existence ─────────────────
  // mod+shift+J toggles push-to-talk (whisper pre-flight from W4-1 means a
  // dead server fails BEFORE recording). The transcript routes through the
  // pure parser in lib/conductor.ts into existing primitives — spawns cascade
  // 160ms apart so you watch your words build the layout. Nothing touches the
  // model's context (guardrail 3); a plan that parses to nothing falls back
  // to seeding a chat with the whole transcript (the most useful catch-all).
  const [conductorState, setConductorState] = useState<"idle" | "listening" | "working">("idle");
  const conductorStateRef = useRef(conductorState);
  conductorStateRef.current = conductorState;
  const executeConductorPlan = useCallback(
    (steps: ConductorStep[], transcript: string) => {
      let delay = 0;
      let done = 0;
      const unclear: string[] = [];
      const fire = (fn: () => void) => {
        setTimeout(fn, delay);
        delay += 160;
        done += 1;
      };
      for (const s of steps) {
        switch (s.kind) {
          case "spawn":
            fire(() =>
              spawn(
                s.pane === "terminal"
                  ? { type: "shell" }
                  : s.pane === "browser"
                    ? { type: "browser", url: s.url }
                    : s.pane === "chat"
                      ? { type: "chat" }
                      : s.pane === "agents"
                        ? { type: "scheduled-agents" }
                        : { type: s.pane },
                s.pane,
              ),
            );
            break;
          case "run":
            fire(() => spawn({ type: "shell", cmd: s.cmd }, s.cmd.slice(0, 28)));
            break;
          case "ask":
            fire(() => spawn({ type: "chat", seed: s.text }, "chat"));
            break;
          case "workspace": {
            const ws = workspaces.find((w) => w.name === s.name);
            if (ws) fire(() => applyWorkspace(ws));
            else unclear.push(s.name);
            break;
          }
          case "theme":
            fire(() => setTheme(s.theme));
            break;
          case "home":
            fire(() => {
              setMaximizedKey((m) => {
                if (m) setWindowFullscreen(false).catch((e) => reportDiag("app.window", e, { action: "exitFullscreen" }));
                return null;
              });
              setHiddenKeys(panesRef.current.map((p) => p.key));
            });
            break;
          case "unknown":
            if (s.text) unclear.push(s.text);
            break;
        }
      }
      if (done === 0 && transcript.trim()) {
        // nothing orchestratable — hand the words to a chat instead of dying
        spawn({ type: "chat", seed: transcript.trim() }, "chat");
        flash("conductor: sent to a chat");
        return;
      }
      flash(
        `conductor: ${done} step${done === 1 ? "" : "s"}${
          unclear.length ? ` · ${unclear.length} unclear` : ""
        }`,
      );
    },
    [spawn, workspaces, applyWorkspace, flash],
  );
  const conductorToggle = useCallback(async () => {
    if (conductorStateRef.current === "listening") {
      setConductorState("working");
      try {
        const text = await dictateStop();
        const steps = parseConductor(text, { workspaces: workspaces.map((w) => w.name) });
        executeConductorPlan(steps, text);
      } catch (e) {
        flash(`conductor: ${String((e as Error)?.message ?? e)}`);
      } finally {
        setConductorState("idle");
      }
      return;
    }
    if (conductorStateRef.current !== "idle") return;
    try {
      await dictateStart(); // pre-flights whisper BEFORE the mic arms
      setConductorState("listening");
    } catch (e) {
      flash(String((e as Error)?.message ?? e));
    }
  }, [workspaces, executeConductorPlan, flash]);
  const conductorToggleRef = useRef(conductorToggle);
  useEffect(() => {
    conductorToggleRef.current = conductorToggle;
  }, [conductorToggle]);
  const conductorCancel = useCallback(() => {
    if (conductorStateRef.current !== "listening") return;
    void dictateCancel();
    setConductorState("idle");
    flash("conductor: cancelled");
  }, [flash]);
  const conductorCancelRef = useRef(conductorCancel);
  useEffect(() => {
    conductorCancelRef.current = conductorCancel;
  }, [conductorCancel]);
  const scheduledAgentChatStates = useMemo(() => {
    const out: Partial<Record<(typeof SCHEDULED_AGENTS)[number]["id"], ScheduledAgentChatState>> = {};
    for (const agent of loadConfiguredScheduledAgents()) {
      const open = panes.some((pane) => pane.kind.type === "chat" && pane.kind.agentId === agent.id);
      const live = liveChats.some(
        (chat) => chat.title === agent.label || chat.title === agent.shortLabel,
      );
      const saved = loadScheduledAgentChatSession(agent.id);
      out[agent.id] = open ? "open" : live ? "running" : saved ? "saved" : "none";
    }
    return out;
  }, [liveChats, scheduledAgentSessionVersion, panes]);
  const scheduledAgentBootstrapRef = useRef(false);
  useEffect(() => {
    if (scheduledAgentBootstrapRef.current || !nativeRuntime) return;
    scheduledAgentBootstrapRef.current = true;
    for (const agent of loadConfiguredScheduledAgents()) {
      if (panes.some((pane) => pane.kind.type === "chat" && pane.kind.agentId === agent.id)) continue;
      const saved = loadScheduledAgentChatSession(agent.id);
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
              seed: buildScheduledAgentChatSeed(agent),
              modelId: agentChatModelId(),
              agentId: agent.id,
              agentLabel: agent.label,
            },
        agent.label,
      );
      setHiddenKeys((current) => (current.includes(key) ? current : [...current, key]));
    }
  }, [nativeRuntime, panes, spawn]);
  // The agent scheduler (W4-7 upgrade). Each due agent fires its pulse into a
  // BACKGROUND chat (openScheduledAgentChat hides command-spawned panes — no focus
  // stealing; its existing-pane path submits without reveal), then a
  // high-priority notification deep-links at that pane (focusPane un-hides).
  // The stamp writes BEFORE the fire so a slow spawn can never double-pulse.
  // Cadences parse via scheduleIntervalMs (hourly/daily/weekly/"every N m|h|d"
  // + the legacy "always"/"work block" phrasings, 5-min floor). Previously the
  // tick re-implemented the open-agent-chat dance inline and fired SILENTLY —
  // autonomy without receipts.
  useEffect(() => {
    if (!nativeRuntime) return;
    const tick = () => {
      for (const agent of dueScheduledAgents()) {
        saveScheduledAgentLastScheduledRun(agent.id, Date.now());
        const key = openScheduledAgentChatRef.current(
          agent.id,
          agent.label,
          buildScheduledAgentRunCommand(agent, "scheduled"),
        );
        pushNotification({
          kind: "agent.scheduled",
          level: "info",
          priority: "high",
          sourceLabel: "agents",
          title: `scheduled pulse: ${agent.label}`,
          body: `${agent.schedule || "scheduled"} cadence — running in a background chat. click to watch.`,
          target: key ? { type: "pane", key } : undefined,
        });
      }
    };
    const start = setTimeout(tick, 5_000);
    const interval = setInterval(tick, 60_000);
    return () => {
      clearTimeout(start);
      clearInterval(interval);
    };
  }, [nativeRuntime]);
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
        <Search size={iconsOnly ? 18 : 15} />
      </IconBtn>
      <IconBtn
        title={"Mission Control — show all panes (" + chord("`") + ")"}
        onClick={() => setOverviewOpen(true)}
        active={overviewOpen}
        disabled={panes.length === 0}
      >
        <Layers size={iconsOnly ? 18 : 15} />
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
          <Camera size={iconsOnly ? 18 : 15} />
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
    <div
      className={`flex items-center gap-0.5 ${
        iconsOnly
          ? "flex-col"
          : "rounded-2xl border border-[var(--color-border)] bg-[color-mix(in_srgb,white_3.5%,transparent)] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)] backdrop-blur-md"
      }`}
    >
      <IconBtn title={`Command palette (${chord("K")})`} onClick={() => setPaletteOpen(true)}>
        <Search size={iconsOnly ? 18 : 15} />
      </IconBtn>
      <IconBtn
        title={"Mission Control — show all panes (" + chord("`") + ")"}
        onClick={() => setOverviewOpen(true)}
        active={overviewOpen}
        disabled={panes.length === 0}
      >
        <Layers size={iconsOnly ? 18 : 15} />
      </IconBtn>
      <VoiceButton onTranscript={handleTranscript} />
      {isApple && (
        <IconBtn title={`Appshot — screenshot to oracle (${MOD} double-tap)`} onClick={fireAppshot}>
          <Camera size={iconsOnly ? 18 : 15} />
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
          <Bell size={iconsOnly ? 18 : 15} />
          {unreadNotifications > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-[var(--color-danger)] px-1 text-[8px] font-bold leading-none text-[var(--color-bg)]">
              {unreadNotifications > 9 ? "9+" : unreadNotifications}
            </span>
          )}
        </button>
      </div>
    </div>
  );

  // The idle home — grid mode mounts it as the empty state, windowed mode as
  // the slide-down lock screen. One element, both surfaces.
  const idleDash = (
    <IdleDashboard
      apps={SPAWN}
      oracles={oracles}
      projects={projects}
      sidebar={sidebar}
      onApplyWorkspace={applyWorkspace}
      onSpawn={spawn}
      onAttachOracle={addOracle}
      onOpenProject={openProject}
      shapeByRoot={shapeByRoot}
      onOpenSidebarItem={spawnSidebarItem}
      onRevealSidebar={() => setSidebarOpen(true)}
      onOpenScheduledAgents={() => spawn({ type: "scheduled-agents" }, "agents")}
      onOpenPet={() => spawn({ type: "pet" }, "pet")}
      onOpenScheduledAgentChat={openScheduledAgentChat}
      onOpenPalette={() => setPaletteOpen(true)}
      onResumeLast={chats.length ? () => resumeChat(chats[0]) : undefined}
      resumeLabel={chats[0]?.title}
      resumeLayout={resumeLayoutInfo}
      onResumeLayout={onResumeLayout}
      // "continue working" removed from the home surface (owner: it dragged the
      // open animation; the section itself was the suspected culprit). Work
      // sessions stay resumable via the command palette.
      workSessions={[]}
      onResumeSession={resumeWorkSession}
      onRemoveSession={removeWorkSession}
      onDoneSession={(id) => setWorkSessionStatus(id, "done")}
      notifications={notifications}
      onTalkToJarvis={talkToJarvis}
      onOpenNotificationTarget={openNotificationTarget}
      onClearNotification={clearNotification}
    />
  );

  return (
    <div className="aios-stage relative flex h-screen w-screen flex-col overflow-hidden text-[var(--color-text)]">
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
      <div className="relative flex min-h-0 flex-1">
        {/* hidden-sidebar opener — only when the sidebar is fully hidden (⌘B);
            while the sidebar is visible its OWN edge handle rides the width
            animation (owner: the lip must move WITH the sidebar). */}
        {!compactWebLayout && !webMirrorMode && !sidebarOpen && (
          <button
            type="button"
            data-no-window-drag
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
            className="group/lip absolute top-1/2 left-0 z-50 grid h-20 w-4 -translate-y-1/2 cursor-pointer place-items-center"
          >
            <span className="h-10 w-[3px] rounded-full bg-[var(--color-border)] opacity-50 transition-all duration-200 group-hover/lip:h-16 group-hover/lip:bg-[var(--color-accent)] group-hover/lip:opacity-90" />
            <span className="absolute grid place-items-center text-[var(--color-text)] opacity-0 transition-opacity duration-200 group-hover/lip:opacity-100">
              <ChevronRight size={12} />
            </span>
          </button>
        )}
        {/* inset-shell sidebar (W1.6): no border, no panel — it sits directly
            on the app canvas while the workspace floats as an inset card to
            its right (the shadcn "inset" recipe, Neon-Glass flavored). */}
        {sidebarOpen && !compactWebLayout && (
          <aside
            className={`relative flex shrink-0 flex-col transition-[width] duration-200 ${
              iconsOnly ? "w-16" : "w-60"
            }`}
          >
            {/* fold handle — a quiet gutter PIP on the sidebar's own edge
                (same visual language as the grid gutters): a slim bar that
                warms + grows on hover, chevron fading in over it. Rides the
                width transition since it lives inside the aside. */}
            <button
              type="button"
              data-no-window-drag
              onClick={() => saveSettings({ sidebarMode: iconsOnly ? "full" : "icons" })}
              title={iconsOnly ? "Expand sidebar" : `Collapse sidebar (hide fully: ${chord("B")})`}
              className="group/lip absolute top-1/2 -right-2 z-50 grid h-20 w-4 -translate-y-1/2 cursor-pointer place-items-center"
            >
              <span className="h-10 w-[3px] rounded-full bg-[var(--color-border)] opacity-50 transition-all duration-200 group-hover/lip:h-16 group-hover/lip:bg-[var(--color-accent)] group-hover/lip:opacity-90" />
              <span className="absolute grid place-items-center text-[var(--color-text)] opacity-0 transition-opacity duration-200 group-hover/lip:opacity-100">
                {iconsOnly ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
              </span>
            </button>
            {/* ── header: brand (home) + fold toggle — FIXED above the scroll
                column, always present. The brand diamond is the way home: lock
                screen in windowed mode, rest-all-panes in grid mode. */}
            <div
              className={`flex shrink-0 items-center ${
                iconsOnly ? "flex-col gap-1 px-1 py-2" : "justify-between py-2 pr-1.5 pl-2.5"
              } ${topBarHidden ? "pt-7" : ""}`}
            >
              <button
                type="button"
                onClick={() => {
                  // windowed mode: the home lock screen slides down OVER the
                  // workspace — nothing needs hiding, nothing to restore.
                  if (windowedWorkspace) {
                    setHomeOverlay(true);
                    return;
                  }
                  setMaximizedKey((m) => {
                    if (m) setWindowFullscreen(false).catch((e) => reportDiag("app.window", e, { action: "exitFullscreen" }));
                    return null;
                  });
                  setHiddenKeys(panes.map((p) => p.key));
                }}
                title={
                  windowedWorkspace
                    ? "home"
                    : "back to the idle home (panes stay restorable)"
                }
                className={`group flex shrink-0 items-center rounded-md px-1.5 py-1 text-left transition-colors hover:bg-[var(--color-panel-2)] ${
                  iconsOnly ? "justify-center" : "gap-2"
                }`}
              >
                {/* glowing brand diamond — also the way home */}
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_34%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] shadow-[var(--aios-glow-soft)] transition-transform group-hover:scale-105">
                  <span className="h-2.5 w-2.5 rotate-45 rounded-[3px] bg-[linear-gradient(135deg,var(--color-accent),var(--aios-accent-2))] shadow-[0_0_7px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]" />
                </span>
                {!iconsOnly && (
                  <span className="font-mono text-[11px] tracking-[0.16em] text-[var(--color-text-2)] transition-colors group-hover:text-[var(--color-text)]">
                    osai
                  </span>
                )}
              </button>
            </div>
            <div
              className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              {...(iconsOnly
                ? { onPointerMove: dockMagnifyMove, onPointerLeave: dockMagnifyReset }
                : {})}
            >
              {/* OPEN list retired in windowed mode — the chat strip covers
                  conversations and the canvas tray covers minimized windows. */}
              {panes.length > 0 && !(windowedWorkspace) && (
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
                hideAppIds={windowedWorkspace ? WINDOWED_HIDDEN_APPS : undefined}
                onSpawn={spawnSidebarItem}
                onPinSite={(spaceId) => setPinSiteSpace(spaceId)}
              />
              <OracleRoster
                iconsOnly={iconsOnly}
                onAttachOracle={addOracle}
                onAttachTmux={addTmux}
                chatpaneAgentsOnly
                scheduledAgentsSlot={
                  <ScheduledAgentsSection
                    iconsOnly={iconsOnly}
                    embedded={!iconsOnly}
                    agentChatStates={scheduledAgentChatStates}
                    onOpenOverview={() => spawn({ type: "scheduled-agents" }, "agents")}
                    onOpenAgentChat={openScheduledAgentChat}
                  />
                }
              />
            </div>
            <div className="flex flex-col gap-1 p-2">
              {/* soft hairline instead of a hard border — inset-shell language */}
              <div className="pointer-events-none mx-1 mb-1 h-px bg-gradient-to-r from-transparent via-[var(--color-border)] to-transparent" />
              {/* usage lives in a dialog now (W1.6) — one calm trigger instead
                  of a permanently pinned block. */}
              <button
                ref={usageBtnRef}
                type="button"
                onClick={(e) => {
                  if (usageOpen) {
                    setUsageOpen(null);
                    return;
                  }
                  const r = e.currentTarget.getBoundingClientRect();
                  setUsageOpen({ left: r.right + 12, bottom: Math.max(8, window.innerHeight - r.bottom) });
                }}
                title="usage — 5h/7d windows"
                className={`press group flex items-center rounded-lg py-1.5 text-[13px] text-[var(--color-text-2)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-panel-2)_80%,transparent)] hover:text-[var(--color-text)] ${
                  iconsOnly ? "justify-center px-0" : "gap-2 px-1.5 text-left"
                }`}
              >
                <span
                  className={`grid shrink-0 place-items-center transition-colors ${
                    iconsOnly
                      ? ""
                      : "h-8 w-8 rounded-lg bg-[color-mix(in_srgb,var(--color-panel-2)_70%,transparent)] group-hover:bg-[var(--color-accent-soft)]"
                  }`}
                >
                  <Gauge
                    size={18}
                    className="text-[var(--color-muted)] transition-colors group-hover:text-[var(--color-accent)]"
                  />
                </span>
                {!iconsOnly && <span className="truncate">usage</span>}
              </button>
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
        {/* the workspace floats as an INSET CARD on the app canvas (W1.6) —
            rounded, bordered, elevated; the sidebar sits flush beside it. */}
        <main
          className={`relative min-h-0 flex-1 ${
            compactWebLayout
              ? ""
              : `my-2 mr-2 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-pane)_92%,transparent)] shadow-[0_18px_50px_-24px_rgba(0,0,0,0.55)] ${
                  sidebarOpen ? "" : "ml-2"
                }`
          }`}
        >
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
            // No panes at all → idle. If panes exist but ALL are hidden, keep them
            // mounted (state-preserving) in the grid and overlay idle on top — else
            // the grid is all-`display:none` and the screen goes blank.
            // Open conversations — the files menu's "open in chat" picker.
            const chatPaneTargets = panes
              .filter((p) => p.kind.type === "chat")
              .map((p) => ({
                key: p.key,
                label:
                  p.label && p.label !== "chat"
                    ? p.label
                    : chatMetaByPaneKey.current.get(p.key)?.title || p.label,
              }));
            // One PaneCard builder for BOTH workspace modes — the grid adds its
            // reorder-drag extras, the window layer swaps the header drag for a
            // window move and stretches the card to fill its FloatingWindow.
            const renderPaneCard = (
              pane: Pane,
              over: {
                style?: CSSProperties;
                reorderable?: boolean;
                isDragging?: boolean;
                dropTarget?: boolean;
                dropZone?: PaneDropZoneKind | null;
                onPaneDragStart?: (key: string, e: React.PointerEvent<HTMLElement>) => void;
                /** explicit undefined suppresses the hide/minimize menu item
                 *  (canvas chats: the tab strip IS their toggle). */
                onToggleHide?: (() => void) | undefined;
                hideLabel?: string;
                frameless?: boolean;
                onMinimize?: () => void;
              },
            ) => (
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
                  onClose={() => requestClose(pane.key)}
                  onToggleMax={() => toggleMax(pane.key)}
                  onToggleHide={() => toggleHide(pane.key)}
                  busy={busyChatKeys.has(pane.key)}
                  dimmed={
                    focusSpotlight &&
                    panes.length > 1 &&
                    maximizedKey === null &&
                    (activeKey ?? focusedPane.current) !== pane.key
                  }
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
                  onOpenScheduledAgentChat={openScheduledAgentChat}
                  onResumeChat={resumeChat}
                  onLaunchProject={setLaunchWs}
                  onSessionRecorded={handleSessionRecorded}
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
                  onChangeCwd={(dir) =>
                    setPanes((ps) =>
                      ps.map((p) =>
                        p.key === pane.key && p.kind.type === "chat"
                          ? { ...p, kind: { ...p.kind, cwd: dir } }
                          : p,
                      ),
                    )
                  }
                  onVideoFullscreen={(on) => onVideoFullscreen(pane.key, on)}
                  chatTargets={chatPaneTargets}
                  onAnnotateTo={routeToChatTarget}
                  {...over}
                />
            );
            // ── windowed workspace (beta, PLAN-odysseus-feel.md W1 + W1.5):
            // chat panes form ONE rearmost canvas (flipped via the tab strip),
            // every other pane floats above as a draggable/resizable window,
            // and the idle dashboard is a lock-screen-style overlay. Compact/
            // mobile keeps the grid.
            if (windowedWorkspace) {
              const chatPanes = panes.filter((p) => p.kind.type === "chat");
              const floatPanes = panes.filter((p) => p.kind.type !== "chat");
              const usableChats = chatPanes.filter((p) => !hiddenKeys.includes(p.key));
              const canvasKey = usableChats.some((p) => p.key === canvasChatKey)
                ? canvasChatKey
                : (usableChats[usableChats.length - 1]?.key ?? null);
              return (
                <>
                  {/* chat canvas — every conversation stays mounted; toggled-away
                      ones are display:none (state preserved, same contract as
                      hiddenKeys). */}
                  <div
                    className="absolute inset-y-0 transition-[left,right] duration-200"
                    style={{ left: dockInsets.left, right: dockInsets.right }}
                  >
                    {chatPanes.map((pane) => (
                      <div
                        key={pane.key}
                        className="absolute inset-0"
                        style={pane.key === canvasKey ? undefined : { display: "none" }}
                      >
                        {renderPaneCard(pane, {
                          style: { width: "100%", height: "100%" },
                          // full-bleed, shell-less: the strip carries identity
                          // and controls. Chats also can't hide — the strip is
                          // their only toggle (hiding orphaned them from it).
                          frameless: true,
                          onToggleHide: undefined,
                        })}
                      </div>
                    ))}
                  </div>
                  <WindowLayer
                    paneKeys={floatPanes.map((p) => p.key)}
                    hiddenKeys={hiddenKeys}
                    activeKey={activeKey}
                    storageKey={WINDOW_LAYOUT_KEY}
                    arrangeNonce={arrangeNonce}
                    onActivate={(key) => {
                      focusedPane.current = key;
                      setActiveKey(key);
                    }}
                    onDockChange={(res) =>
                      setDockInsets((cur) =>
                        cur.left === res.left && cur.right === res.right ? cur : res,
                      )
                    }
                    renderPane={(key, startMove) => {
                      const pane = panes.find((p) => p.key === key);
                      if (!pane) return null;
                      return renderPaneCard(pane, {
                        style: { width: "100%", height: "100%" },
                        reorderable: true,
                        onPaneDragStart: (_key, e) => startMove(e),
                        hideLabel: "Minimize window",
                        onMinimize: () => toggleHide(pane.key),
                      });
                    }}
                  />
                  {/* the glass-spirit desk creature (living-cockpit P2+P4).
                      Hidden while the home overlay covers the workspace — its
                      fixed z sits above the overlay, and the lock screen has
                      its own resident (HorizonPet); two pets is one too many. */}
                  {!homeOverlay && panes.length > 0 && (
                    <PetOverlay
                      activeSurface={petSurfaceOf(
                        panes.find((p) => p.key === activeKey)?.kind.type,
                      )}
                      onOpenRoom={() => spawn({ type: "pet" }, "pet")}
                      onOpenTarget={openNotificationTarget}
                    />
                  )}
                  {/* minimized-windows tray — minimized tools collect on the
                      right edge of the canvas; click restores + raises. */}
                  {maximizedKey === null && floatPanes.some((p) => hiddenKeys.includes(p.key)) && (
                    <div
                      className="absolute bottom-2 z-30 flex max-h-[60%] flex-col items-end gap-1 overflow-y-auto transition-[right] duration-200"
                      style={{ right: 8 + dockInsets.right }}
                    >
                      {floatPanes
                        .filter((p) => hiddenKeys.includes(p.key))
                        .map((pane) => (
                          <button
                            key={pane.key}
                            type="button"
                            onClick={() => {
                              toggleHide(pane.key);
                              focusedPane.current = pane.key;
                              setActiveKey(pane.key);
                            }}
                            title={`Restore ${pane.label}`}
                            className="press flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel)]/90 px-2.5 py-1 font-mono text-[11px] text-[var(--color-muted)] shadow-[var(--aios-shadow-pop)] backdrop-blur transition-colors hover:text-[var(--color-text)]"
                          >
                            <span className={`status-dot ${DOT[pane.kind.type] ?? "status-dot--cold"}`} />
                            <span className="max-w-36 truncate">{pane.label}</span>
                          </button>
                        ))}
                    </div>
                  )}
                  {/* one-click ARRANGE — untangle the pile: tiles every visible
                      window into an even grid (they glide into place). */}
                  {maximizedKey === null &&
                    floatPanes.filter((p) => !hiddenKeys.includes(p.key)).length >= 2 && (
                      <button
                        type="button"
                        data-no-window-drag
                        onClick={() => setArrangeNonce((n) => n + 1)}
                        title="Arrange windows into a grid"
                        style={{ right: 8 + dockInsets.right }}
                        className="press absolute top-2 z-30 grid h-8 w-8 place-items-center rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel)]/90 text-[var(--color-muted)] shadow-[var(--aios-shadow-pop)] backdrop-blur transition-[color,right] duration-200 hover:text-[var(--color-accent)]"
                      >
                        <LayoutGrid size={16} />
                      </button>
                    )}
                  {maximizedKey === null && (
                  <ChatTabStrip
                    // archived (hiddenKeys) conversations leave the strip into
                    // the dropdown; selecting one there un-archives it.
                    tabs={usableChats.map((p) => ({
                      key: p.key,
                      // a user-renamed pane label wins; the generic default
                      // defers to the recorded session title.
                      label:
                        p.label && p.label !== "chat"
                          ? p.label
                          : chatMetaByPaneKey.current.get(p.key)?.title || p.label,
                      busy: busyChatKeys.has(p.key),
                    }))}
                    archived={chatPanes
                      .filter((p) => hiddenKeys.includes(p.key))
                      .map((p) => ({
                        key: p.key,
                        label:
                          p.label && p.label !== "chat"
                            ? p.label
                            : chatMetaByPaneKey.current.get(p.key)?.title || p.label,
                        busy: busyChatKeys.has(p.key),
                      }))}
                    activeKey={canvasKey}
                    onSelect={(key) => {
                      setCanvasChatKey(key);
                      setHiddenKeys((cur) => cur.filter((k) => k !== key));
                      focusedPane.current = key;
                      setActiveKey(key);
                    }}
                    onClose={requestClose}
                    onRename={renamePane}
                    onArchive={(key) =>
                      setHiddenKeys((cur) => (cur.includes(key) ? cur : [...cur, key]))
                    }
                    onNew={() => spawn({ type: "chat" }, "chat")}
                    onHome={() => setHomeOverlay(true)}
                  />
                  )}
                </>
              );
            }
            if (panes.length === 0) return idleDash;
            return (
              <>
                {visibleCount === 0 && <div className="absolute inset-0 z-10">{idleDash}</div>}
            <ResizableGrid cols={cols} rows={rows} gap={8} storageKey={gridTrackStorageKey(GRID_TRACK_KEY, cols, rows)}>
              {/* popLayout: a closing pane pops OUT of the grid flow (absolute at
                  its measured rect) and plays the fx exit while the survivors'
                  track transition glides them into the gap. initial=false keeps
                  entrances on the CSS fade-in-up (mount-time). */}
              <AnimatePresence initial={false} mode="popLayout">
              {panes.map((pane) => {
                const visibleIndex = panes
                  .filter((p) => !hiddenKeys.includes(p.key))
                  .findIndex((p) => p.key === pane.key);
                const paneStyle =
                  visibleCount === 3 && visibleIndex === 2
                    ? ({ gridColumn: "2", gridRow: "1 / span 2" } satisfies CSSProperties)
                    : undefined;
                return renderPaneCard(pane, {
                  style: paneStyle,
                  dropTarget: dropTargetKey === pane.key,
                  dropZone: dropTargetKey === pane.key ? dropZone : null,
                  reorderable: panes.length > 1,
                  isDragging: dragActiveKey === pane.key,
                  onPaneDragStart,
                });
              })}
              </AnimatePresence>
            </ResizableGrid>
              </>
            );
          })()}
        </main>
      </div>

      {/* windowed-mode home LOCK SCREEN — the idle dashboard slides down over
          the whole app (sidebar included) and slides back up when you enter
          the workspace (Esc, the pill, or opening anything). Auto-shown when
          no panes are open; summoned via the chat strip's house button.
          ALWAYS MOUNTED: opening must be a pure GPU transform — a fresh mount
          of the dashboard mid-slide is exactly the jank the owner reported. */}
      {windowedWorkspace && !webMirrorMode && (
        <div
          inert={!(homeOverlay || panes.length === 0)}
          aria-hidden={!(homeOverlay || panes.length === 0)}
          // lock-screen DRAG: grab any empty spot and fling the home upward to
          // enter the workspace (complements scroll-up / Esc / the pill). The
          // sheet follows the pointer live via inline transform; on release it
          // either commits (state flips, inline cleared next frame so the CSS
          // transition finishes the slide) or springs back.
          onPointerDown={(e) => {
            if (panes.length === 0 || e.button !== 0) return;
            if ((e.target as HTMLElement).closest("button, a, input, textarea, select, [role='button']")) return;
            const wrap = e.currentTarget as HTMLDivElement;
            const startY = e.clientY;
            let armed = false;
            const onMove = (ev: PointerEvent) => {
              const dy = Math.min(0, ev.clientY - startY);
              if (!armed && dy < -8) {
                armed = true;
                document.body.style.userSelect = "none";
              }
              if (armed) {
                wrap.style.transition = "none";
                wrap.style.transform = `translateY(${dy}px)`;
              }
            };
            const finish = (commit: boolean) => (ev: PointerEvent) => {
              window.removeEventListener("pointermove", onMove);
              window.removeEventListener("pointerup", onUp);
              window.removeEventListener("pointercancel", onCancel);
              document.body.style.userSelect = "";
              wrap.style.transition = "";
              if (commit && armed && ev.clientY - startY < -110) {
                setHomeOverlay(false);
                // keep the inline offset for one frame so the transition runs
                // from the dragged position instead of snapping back first.
                requestAnimationFrame(() => {
                  wrap.style.transform = "";
                });
              } else {
                wrap.style.transform = "";
              }
            };
            const onUp = finish(true);
            const onCancel = finish(false);
            window.addEventListener("pointermove", onMove);
            window.addEventListener("pointerup", onUp);
            window.addEventListener("pointercancel", onCancel);
          }}
          className={`fixed inset-0 z-50 flex flex-col overflow-hidden bg-[var(--color-bg)] transition-transform duration-[440ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform ${
            homeOverlay || panes.length === 0
              ? "translate-y-0 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]"
              : "pointer-events-none -translate-y-full"
          }`}
        >
          <div
            className="min-h-0 flex-1 overflow-y-auto"
            // lock-screen gesture: a firm scroll-UP while already at the top
            // slides the home away into the workspace (mirrors the entrance).
            onWheel={(e) => {
              if (panes.length === 0) return;
              if (e.currentTarget.scrollTop <= 0 && e.deltaY < -24) setHomeOverlay(false);
            }}
          >
            {idleDash}
          </div>
          {panes.length > 0 && (
            <button
              type="button"
              onClick={() => setHomeOverlay(false)}
              title="Enter workspace (Esc)"
              className="press absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel)]/90 px-3 py-1.5 font-mono text-[11px] text-[var(--color-muted)] shadow-[var(--aios-shadow-pop)] backdrop-blur transition-colors hover:text-[var(--color-text)]"
            >
              <ChevronUp size={13} />
              enter workspace
            </button>
          )}
        </div>
      )}

      {/* usage popover (W1.6) — flies out beside the sidebar, anchored to its
          trigger; Esc / click-away / ✕ dismiss. No backdrop, no focus theft. */}
      {usageOpen && (
        <div
          ref={usagePopRef}
          style={{ left: usageOpen.left, bottom: usageOpen.bottom }}
          className="fade-in-up fixed z-[70] w-[360px] max-w-[85vw] rounded-xl border border-[var(--color-border-strong)] bg-[var(--aios-glass-bg-strong)] p-4 shadow-[var(--aios-shadow-pop)] backdrop-blur-xl"
        >
          <div className="mb-3 flex items-center justify-between">
            <span className="flex items-center gap-2 font-mono text-[11px] tracking-[0.18em] text-[var(--color-muted)] uppercase">
              <Gauge size={13} />
              usage
            </span>
            <button
              type="button"
              onClick={() => setUsageOpen(null)}
              title="Close (Esc)"
              className="press grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            >
              <X size={13} />
            </button>
          </div>
          <SidebarUsage bare />
        </div>
      )}

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

      {/* global click sparks (W5-5) — pooled canvas, fires on .press controls;
          self-gates on funFx + reduce-motion. */}
      <ClickSpark />

      {/* conductor pill — listening / executing state, top-center */}
      <AnimatePresence>
      {conductorState !== "idle" && (
        <m.div {...toastPop()} className="absolute left-1/2 top-4 z-50 flex items-center gap-2 overflow-hidden rounded-full border border-[var(--color-accent)]/40 bg-[var(--color-panel)]/95 px-3.5 py-1.5 shadow-[var(--aios-shadow-pop)] backdrop-blur">
          {/* the beam laps the pill while the conductor listens/executes */}
          <BorderBeam duration={4} size={40} />
          <Mic
            size={13}
            className={
              conductorState === "listening"
                ? "animate-pulse text-[var(--color-accent)]"
                : "text-[var(--color-muted)]"
            }
          />
          <span className="text-[12px] text-[var(--color-text)]">
            {conductorState === "listening" ? "conductor listening…" : "conducting…"}
          </span>
          <span className="font-mono text-[10px] text-[var(--color-faint)]">
            {fmtChord(["mod", "shift", "J"])} run · esc cancel
          </span>
        </m.div>
      )}
      </AnimatePresence>
      {/* toastPop owns the -50% X across every state (so no -translate-x-1/2
          class here); keyed by message so a replacing flash re-plays the
          entrance while AnimatePresence exits the old one. */}
      <AnimatePresence>
      {toast && (
        <m.div
          key={toast}
          {...toastPop()}
          className="glass absolute bottom-4 left-1/2 z-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/90 px-3 py-2 text-[12px] text-[var(--color-text)] shadow-[var(--aios-shadow-pop)]"
        >
          {toast}
        </m.div>
      )}
      </AnimatePresence>

      {/* minimized panes now live in the sidebar "OPEN" list (OpenPanesList) —
          no floating overlay. Restore / hide / close all happen from the rail. */}

      {/* close a busy chat: keep running in background, or kill */}
      <AnimatePresence>
      {closePrompt && (
        <m.div {...overlayFade()} className="absolute inset-0 z-50 grid place-items-center bg-black/50" onClick={() => setClosePrompt(null)}>
          <m.div
            {...modalPop()}
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
            className="w-[400px] rounded-lg border border-[var(--color-border-strong)] bg-[var(--aios-glass-bg-strong)] p-4 shadow-[var(--aios-shadow-pop)] backdrop-blur-md"
          >
            <div className="text-[13px] font-medium text-[var(--color-text)]">this chat is still working</div>
            <p className="mt-1 text-[12px] leading-relaxed text-[var(--color-muted)]">
              keep it running in the background so it finishes the task, or stop it?
            </p>
            {(() => {
              // queued follow-ups live in the pane and die with it either way —
              // losing typed work silently is worse than one extra line here.
              const n = chatHandles.get(closePrompt)?.queued?.() ?? 0;
              return n > 0 ? (
                <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-danger)]">
                  {n} queued follow-up{n === 1 ? "" : "s"} you typed will be discarded when this pane closes.
                </p>
              ) : null;
            })()}
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
          </m.div>
        </m.div>
      )}
      </AnimatePresence>

      {/* Settings mounts on first open and STAYS mounted (its own
          AnimatePresence needs to outlive `open` to play the exit); the lazy
          chunk still only loads on that first open. */}
      {settingsEverOpened && (
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
      )}
      {launchWs && (
        <WorkspaceLaunchPicker
          ws={launchWs}
          onClose={() => setLaunchWs(null)}
          onOpen={(cwd, mode, label) => {
            spawn(mode === "chat" ? { type: "chat", cwd } : { type: "shell", cwd }, label);
            // auto-capture (Tier 1): launching a project AS A CHAT seeds a Work
            // Session (dedup by workspace root) so it appears in "Continue working".
            // Terminal launches don't, to keep the rail signal-not-noise.
            if (mode === "chat" && launchWs) {
              const root = launchWs.root;
              const existing = listWorkSessions().find((s) => s.projectRoot === root);
              if (existing) touchWorkSession(existing.id);
              else
                createWorkSession({
                  title: label,
                  projectRoot: root,
                  panes: [{ label, kind: { type: "chat", cwd } }],
                });
            }
            setLaunchWs(null);
          }}
        />
      )}
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
      <SaveSessionModal
        draft={sessionDraft}
        onChange={setSessionDraft}
        onSave={commitSession}
        onClose={() => setSessionDraft(null)}
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
      <div className="relative flex items-center justify-between border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel)_55%,transparent)] px-3 py-2 backdrop-blur-md">
        <div>
          <div className="text-[12px] font-medium">notifications</div>
          <div className={`font-mono text-[10px] ${unread > 0 ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"}`}>
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
      {/* AnimatedList (W5-3): new items spring in at the top and the stack
          settles via `layout` (activates once W5-4 swaps to domMax); exits
          slide out. Replaces the capped CSS .stagger. */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {notifications.length === 0 ? (
          <div className="flex h-full min-h-[10rem] flex-col items-center justify-center gap-2 text-center">
            <span className="relative grid h-12 w-12 place-items-center rounded-2xl border border-[var(--color-border)] bg-[var(--color-panel-2)]/50">
              <BellRing size={20} className="text-[var(--color-faint)]" />
              <span
                aria-hidden
                className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--color-bg)]"
                style={{ background: "var(--aios-accent-2)" }}
              />
            </span>
            <span className="text-[12.5px] text-[var(--color-muted)]">all quiet</span>
            <span className="max-w-[240px] text-[11px] leading-relaxed text-[var(--color-faint)]">
              finished agent runs, questions waiting on you, and long-task
              alerts land here — click one to jump to its pane
            </span>
          </div>
        ) : (
          <AnimatePresence initial={false}>
          {notifications.map((item) => (
            <m.div
              key={item.id}
              layout
              initial={{ opacity: 0, y: -12, scale: 0.97 }}
              animate={{ opacity: item.read ? 0.65 : 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 14, transition: { duration: 0.16 } }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}
              className={`group relative flex gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-[var(--color-panel-2)] ${
                item.read ? "" : "bg-[color-mix(in_srgb,var(--color-accent)_8%,transparent)]"
              }`}
            >
              {!item.read && (
                <span
                  aria-hidden
                  className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-[linear-gradient(180deg,var(--color-accent),var(--aios-accent-2))] shadow-[var(--aios-glow-soft)]"
                />
              )}
              <span
                className={`mt-1 h-2 w-2 shrink-0 rounded-full ${
                  item.level === "error"
                    ? "bg-[var(--color-danger)] shadow-[0_0_7px_var(--color-danger)]"
                    : item.level === "warning"
                      ? "bg-[var(--color-warning)] shadow-[0_0_7px_var(--color-warning)]"
                      : item.level === "success"
                        ? "bg-[var(--color-success)] shadow-[0_0_7px_var(--color-success-glow)]"
                        : "bg-[var(--color-accent)] shadow-[var(--aios-glow-soft)]"
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
            </m.div>
          ))}
          </AnimatePresence>
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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // (space rename removed — owner never used it; headers are fold toggles.)

  // icon rail: a section header shrinks to a slim hairline — still clickable
  // to fold/unfold, but no floating chevron cluttering the rail (W1.6).
  if (iconsOnly) {
    return (
      <button
        type="button"
        onClick={() => toggleSpaceCollapsed(space.id)}
        title={`${space.name} · ${space.collapsed ? "expand" : "collapse"}`}
        className="group/sh mx-2 my-1 h-1 rounded-full"
      >
        <span
          className={`block h-px w-full transition-colors ${
            space.collapsed
              ? "bg-[var(--color-accent)]/50"
              : "bg-[var(--color-border)] group-hover/sh:bg-[var(--color-border-strong)]"
          }`}
        />
      </button>
    );
  }

  return (
    <div className={`group/sh relative flex items-center ${iconsOnly ? "justify-center px-0" : "pl-1.5 pr-1"}`}>
      <button
        onClick={() => toggleSpaceCollapsed(space.id)}
        className={`flex min-w-0 items-center gap-1.5 py-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)] ${
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
      {/* space menu: delete only, custom spaces only — rename retired. */}
      {!iconsOnly && !space.system && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="grid h-5 w-5 place-items-center rounded text-[var(--color-faint)] opacity-0 transition-opacity hover:bg-[var(--color-panel)] hover:text-[var(--color-text)] group-hover/sh:opacity-100"
            title="space options"
          >
            <EllipsisVertical size={12} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-36 overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-panel)] py-1 text-[12px] text-[var(--color-text)] shadow-[var(--aios-shadow-pop)]">
              <RowMenuItem
                icon={<Trash2 size={13} />}
                label="delete space"
                onClick={() => {
                  removeSpace(space.id);
                  setMenuOpen(false);
                }}
              />
            </div>
          )}
        </div>
      )}
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
  hideAppIds,
  onSpawn,
  onPinSite,
}: {
  state: SidebarState;
  iconsOnly?: boolean;
  /** built-in app ids to omit (windowed mode drops "chat" — the strip owns it). */
  hideAppIds?: ReadonlySet<string>;
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
        const rows = items.filter(
          (it) =>
            it.group === space.id &&
            !it.hidden &&
            !(it.kind.type === "app" && hideAppIds?.has(it.kind.appId)),
        );
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
                    className={`group flex w-full items-center rounded-lg py-1 text-[13px] text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-panel-2)_80%,transparent)] hover:text-[var(--color-text)] ${
                      iconsOnly ? "justify-center px-0 py-1.5" : "gap-2 pl-1.5 text-left"
                    }`}
                    title="pin a website to the sidebar"
                  >
                    {iconsOnly ? (
                      <Plus size={18} className="shrink-0" />
                    ) : (
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--color-panel-2)_70%,transparent)] transition-colors group-hover:bg-[var(--color-accent-soft)]">
                        <Plus size={18} className="text-[var(--color-muted)] transition-colors group-hover:text-[var(--color-accent)]" />
                      </span>
                    )}
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
        className={`group mt-1 flex w-full items-center rounded-lg py-1 text-[13px] text-[var(--color-faint)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-panel-2)_80%,transparent)] hover:text-[var(--color-text)] ${
          iconsOnly ? "justify-center px-0 py-1.5" : "gap-2 pl-1.5 text-left"
        }`}
        title="create a new space"
      >
        {iconsOnly ? (
          <FolderPlus size={18} className="shrink-0" />
        ) : (
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[color-mix(in_srgb,var(--color-panel-2)_70%,transparent)] transition-colors group-hover:bg-[var(--color-accent-soft)]">
            <FolderPlus size={18} className="text-[var(--color-muted)] transition-colors group-hover:text-[var(--color-accent)]" />
          </span>
        )}
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
      // tools are fixed rows now (owner never reordered them); only pinned
      // links stay draggable (into spaces / to reorder).
      draggable={isLink}
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
      className={`group relative flex items-center rounded-lg border border-transparent transition-all duration-150 ${
        dragging ? "opacity-40" : ""
      } ${
        over
          ? "border-[color-mix(in_srgb,var(--color-accent)_32%,transparent)] bg-[var(--color-accent-soft)] shadow-[var(--aios-glow-soft)]"
          : "hover:translate-x-0.5 hover:bg-[color-mix(in_srgb,var(--color-panel-2)_80%,transparent)]"
      }`}
    >
      {/* the grip handle is gone (tools are fixed; links drag by the row) so
          every row shares the same left inset. */}
      <button
        onClick={onSpawn}
        className={`flex min-w-0 flex-1 items-center text-[13px] text-[var(--color-text-2)] transition-colors group-hover:text-[var(--color-text)] ${
          iconsOnly ? "aios-dock-icon min-h-11 justify-center px-0 py-2" : "gap-2 py-1 pr-1 pl-1.5 text-left"
        }`}
      >
        {/* icon chip — the row's anchor; warms to the accent on hover */}
        <span
          className={`grid shrink-0 place-items-center transition-colors ${
            iconsOnly
              ? ""
              : "h-8 w-8 rounded-lg bg-[color-mix(in_srgb,var(--color-panel-2)_70%,transparent)] group-hover:bg-[var(--color-accent-soft)]"
          }`}
        >
          {isLink && item.iconName === "favicon" && item.faviconUrl && !favBroken ? (
            <img
              src={item.faviconUrl}
              alt=""
              onError={() => setFavBroken(true)}
              className={`${iconsOnly ? "h-[22px] w-[22px]" : "h-[18px] w-[18px]"} shrink-0 rounded-sm`}
            />
          ) : (
            <Icon
              size={iconsOnly ? 23 : 18}
              className="shrink-0 text-[var(--color-muted)] transition-colors group-hover:text-[var(--color-accent)]"
            />
          )}
        </span>
        {!iconsOnly && <span className="truncate text-[13px]">{item.label}</span>}
      </button>
      {/* ⋯ menu: pinned links only (unpin/rename/icon/move) — tool rows carry
          no controls at all (owner never used them). */}
      {!iconsOnly && isLink && (
      <div ref={menuRef} className="relative shrink-0">
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
          <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-[var(--color-border-strong)] bg-[var(--color-panel)] py-1 text-[12px] text-[var(--color-text)] shadow-[var(--aios-shadow-pop)]">
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
      )}
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
  const submit = () => {
    const u = url.trim();
    if (!u) return;
    addLink(u, label.trim() || undefined, undefined, spaceId ?? "pinned");
    onClose();
  };
  return (
    <AnimatePresence>
      {open && (
    <m.div
      {...overlayFade()}
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <m.div
        {...modalPop()}
        role="dialog"
        aria-modal="true"
        aria-label="pin a site"
        className="glass w-[380px] rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-panel)]/95 p-4 shadow-[var(--aios-shadow-pop)]"
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
      </m.div>
    </m.div>
      )}
    </AnimatePresence>
  );
}

/** Inline modal naming the current layout as a workspace ("save workspace…"
 *  in the palette). Existing names render as one-click pills; reusing a name
 *  overwrites that workspace (the button says so). */
/** Name + (optional) goal a Work Session at save time. The goal re-seeds the
 *  chat's goal box when you resume the session, so the agent carries the standing
 *  intent across the resume. */
function SaveSessionModal({
  draft,
  onChange,
  onSave,
  onClose,
}: {
  draft: { title: string; goal: string } | null;
  onChange: (v: { title: string; goal: string }) => void;
  onSave: (title: string, goal: string) => void;
  onClose: () => void;
}) {
  const title = draft?.title ?? "";
  const goal = draft?.goal ?? "";
  const submit = () => {
    onSave(title, goal);
    onClose();
  };
  return (
    <AnimatePresence>
      {draft != null && (
        <m.div
          {...overlayFade()}
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-sm"
          onMouseDown={onClose}
        >
          <m.div
            {...modalPop()}
            role="dialog"
            aria-modal="true"
            aria-label="save work session"
            className="glass w-[420px] rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-panel)]/95 p-4 shadow-[var(--aios-shadow-pop)]"
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => trapTab(e, e.currentTarget)}
          >
            <div className="mb-3 flex items-center gap-2 text-[13px] font-medium text-[var(--color-text)]">
              <Layers size={14} className="text-[var(--color-accent)]" />
              save work session
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
                value={title}
                onChange={(e) => onChange({ title: e.target.value, goal })}
                onKeyDown={(e) => e.key === "Escape" && onClose()}
                placeholder="name this session"
                spellCheck={false}
                className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60"
              />
              <textarea
                value={goal}
                onChange={(e) => onChange({ title, goal: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === "Escape") onClose();
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    submit();
                  }
                }}
                rows={2}
                placeholder="goal (optional) — re-seeded into the chat when you resume"
                spellCheck={false}
                className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-1.5 text-[12px] leading-relaxed text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]/60"
              />
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="font-mono text-[10px] text-[var(--color-faint)]">
                  keeps panes + the current chat thread
                </span>
                <div className="flex shrink-0 gap-2">
                  <button type="button" onClick={onClose} className="pill press text-[11px]">
                    cancel
                  </button>
                  <button
                    type="submit"
                    className="press rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)] px-3 py-1 text-[11px] font-medium text-[var(--color-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_28%,transparent)]"
                  >
                    save
                  </button>
                </div>
              </div>
            </form>
          </m.div>
        </m.div>
      )}
    </AnimatePresence>
  );
}

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
  // No sticky-draft ref needed: AnimatePresence replays the LAST open render
  // during the exit, so the input can't blank mid-exit by construction.
  const value = draft ?? "";
  const clean = value.trim();
  const overwrites = existing.some((n) => n.toLowerCase() === clean.toLowerCase());
  const submit = () => {
    if (!clean) return;
    onSave(clean);
    onClose();
  };
  return (
    <AnimatePresence>
      {draft != null && (
    <m.div
      {...overlayFade()}
      className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-6 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <m.div
        {...modalPop()}
        role="dialog"
        aria-modal="true"
        aria-label="save workspace"
        className="glass w-[380px] rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-panel)]/95 p-4 shadow-[var(--aios-shadow-pop)]"
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
              <HoverBorderGradient radius="rounded-lg">
                <button
                  type="submit"
                  disabled={!clean}
                  className="rounded-lg bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-accent-fg)] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {overwrites ? "overwrite" : "save"}
                </button>
              </HoverBorderGradient>
            </div>
          </div>
        </form>
      </m.div>
    </m.div>
      )}
    </AnimatePresence>
  );
}

/** One scannable meta line per overview card — WHAT the pane is on (model,
 *  folder, url, file), not just its kind. Discriminated on PaneContent.type;
 *  unknown kinds return null and the card just shows its glyph. */
function paneCardMeta(kind: PaneContent): string | null {
  switch (kind.type) {
    case "browser":
      return kind.url?.replace(/^https?:\/\//, "").replace(/\/$/, "") || null;
    case "files":
      return kind.root ?? null;
    case "editor":
    case "file":
      return kind.path?.split(/[\\/]/).pop() ?? null;
    case "chat":
      return kind.modelId ?? kind.resume?.title ?? null;
    case "tmux":
      return kind.session;
    case "oracle":
      return kind.identity;
    default:
      return "cwd" in kind && typeof kind.cwd === "string" ? kind.cwd : null;
  }
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

  // Card width adapts so 1-2 panes sit big + centered (not stretched), many panes
  // wrap into a tidy gallery — the Mission-Control feel at any count.
  const n = panes.length;
  const cardW = n <= 1 ? 460 : n <= 2 ? 400 : n <= 6 ? 340 : 280;

  // Exit motion — AnimatePresence + fx/motionTokens (one surface: the scrim
  // carries the modal pop itself, same as the old `.modal-in` root).
  return (
    <AnimatePresence>
      {open && (
    <m.div
      {...modalPop()}
      role="dialog"
      aria-modal="true"
      aria-label="mission control — open panes"
      className="fixed inset-0 z-[60] flex flex-col bg-black/55 backdrop-blur-2xl"
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
        {/* variants stagger (W5-4): cards fan in on each open (the overview
            fully unmounts on close, so the cascade replays per open) — no
            nth-child cap, plays nice with the modal's own AnimatePresence. */}
        <m.div
          className="flex flex-wrap items-center justify-center gap-6"
          variants={{ show: { transition: { staggerChildren: 0.028 } } }}
          initial="hidden"
          animate="show"
        >
          {panes.map((p, i) => {
            const hidden = hiddenKeys.includes(p.key);
            const isSel = i === sel;
            const Glyph = PANE_GLYPH[p.kind.type] ?? Layers;
            return (
              <m.div
                key={p.key}
                className="flex flex-col items-center gap-2"
                style={{ width: cardW }}
                variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
              >
                <button
                  onMouseEnter={() => setSel(i)}
                  onMouseMove={spotlightMove}
                  onMouseDown={(e) => { e.stopPropagation(); onPick(p.key); }}
                  style={{ width: cardW }}
                  className={`aios-spotlight group relative flex aspect-[16/10] flex-col overflow-hidden rounded-xl border bg-[color-mix(in_srgb,var(--color-pane)_62%,transparent)] text-left shadow-[var(--aios-shadow-pop)] backdrop-blur-md transition-all duration-150 hover:-translate-y-1 ${
                    isSel
                      ? "border-[var(--color-accent)] ring-2 ring-[var(--color-accent)]/60 scale-[1.02] shadow-[0_26px_60px_-22px_color-mix(in_srgb,var(--color-accent)_60%,transparent)]"
                      : "border-[var(--color-border-strong)] hover:border-[var(--color-accent)]/40"
                  } ${hidden ? "opacity-60" : ""}`}
                >
                  {/* window chrome strip */}
                  <div className="flex h-8 shrink-0 items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel)_55%,transparent)] px-3 backdrop-blur">
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
                    <div className="flex max-w-[88%] flex-col items-center gap-2.5">
                      <span className="grid h-14 w-14 place-items-center rounded-2xl border border-[color-mix(in_srgb,var(--color-accent)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-accent)] shadow-[var(--aios-glow-soft)] transition-transform group-hover:scale-105">
                        <Glyph size={26} />
                      </span>
                      <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-[var(--color-faint)]">
                        {p.kind.type}
                      </span>
                      {paneCardMeta(p.kind) && (
                        <span className="max-w-full truncate font-mono text-[10.5px] text-[var(--color-muted)]">
                          {paneCardMeta(p.kind)}
                        </span>
                      )}
                    </div>
                    {hidden && (
                      <span className="absolute bottom-2 right-2 rounded bg-[var(--color-panel)]/80 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-[var(--color-faint)]">minimized</span>
                    )}
                    <span className="absolute left-2 top-2 rounded bg-[var(--color-panel)]/70 px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-faint)]">{chord(String(i + 1))}</span>
                  </div>
                </button>
                <span className={`max-w-full truncate text-[12px] ${isSel ? "text-[var(--color-text)]" : "text-[var(--color-muted)]"}`}>
                  {p.label}
                </span>
              </m.div>
            );
          })}
        </m.div>
      </div>
    </m.div>
      )}
    </AnimatePresence>
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
  // re-render when any chat's needs-you flag flips (unanswered approval /
  // question / plan) — the amber dot below is how a parallel-pane user notices
  // which chat is blocked on them.
  const [, bumpAttention] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribePaneAttention(bumpAttention), []);
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
            className={`group relative flex items-center rounded-md border transition-all ${
              active
                ? "border-[color-mix(in_srgb,var(--color-accent)_32%,transparent)] bg-[var(--color-accent-soft)] shadow-[var(--aios-glow-soft)]"
                : "border-transparent hover:border-[var(--color-border)] hover:bg-[var(--color-panel-2)]"
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
              {/* needs-you: this chat is waiting on an answer/approval from you */}
              {paneNeedsAttention(p.key) && (
                <span
                  className="h-[7px] w-[7px] shrink-0 animate-pulse rounded-full bg-[var(--color-warning,#f0b429)] shadow-[0_0_6px_rgba(240,180,41,0.8)]"
                  title="waiting for your answer"
                />
              )}
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
  ref,
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
  hideLabel,
  frameless,
  onMinimize,
  reorderable,
  isDragging,
  dimmed,
  busy,
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
  onOpenScheduledAgentChat,
  onResumeChat,
  onLaunchProject,
  onSessionRecorded,
  onAttachApp,
  onProfileChange,
  onChangeCwd,
  onVideoFullscreen,
  chatTargets,
  onAnnotateTo,
}: {
  /** Forwarded by AnimatePresence popLayout (React 19 ref-as-prop): the exit
   *  pop measures the root element through it. Merged with wrapRef below. */
  ref?: React.Ref<HTMLDivElement>;
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
  /** menu wording for the hide action ("Minimize window" in windowed mode). */
  hideLabel?: string;
  /** canvas mode: no chrome at all — no header strip, border, or rounding.
   *  The windowed workspace's rearmost chat renders this way; identity and
   *  controls live in the ChatTabStrip instead. Right-click menu still works. */
  frameless?: boolean;
  /** windowed mode: a dedicated header minimize button (— to the tray),
   *  one click instead of digging through the ⋯ menu. */
  onMinimize?: () => void;
  reorderable?: boolean;
  isDragging?: boolean;
  /** focus-spotlight: this pane is NOT the focused one — recede. */
  dimmed?: boolean;
  /** activity glow: a live agent run is streaming in this pane. */
  busy?: boolean;
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
  onOpenScheduledAgentChat: (id: string, label: string) => void;
  onResumeChat: (s: ChatSessionInfo, findText?: string) => void;
  onLaunchProject: (ws: ProjectWorkspace) => void;
  onSessionRecorded: (info: {
    paneKey?: string;
    sessionId: string;
    title: string;
    cwd?: string;
    engine?: string;
    model?: string;
  }) => void;
  onAttachApp: (app: { name: string; bundle_id: string | null }) => void;
  onProfileChange: (profile: string) => void;
  onChangeCwd: (dir: string) => void;
  onVideoFullscreen?: (on: boolean) => void;
  /** open conversations (key+label) — files "open in chat" picker targets. */
  chatTargets?: { key: string; label: string }[];
  onAnnotateTo?: (paneKey: string, text: string) => void;
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
  // Monitoring works on real multiplexer sessions (oracle/tmux panes) — the
  // watcher capture-panes them and reports out.
  const monTarget =
    pane.kind.type === "oracle"
      ? { socket: loadSettings().terminalSocket || "aios", session: `aios-${pane.kind.identity}` }
      : pane.kind.type === "tmux"
        ? { socket: pane.kind.socket, session: pane.kind.session }
        : null;
  const [mon, setMon] = useState(false);
  const fileTarget = paneFileTarget(pane.kind);
  // ── pane menu (⋯ overflow + right-click context menu, one and the same) ──────
  // Replaces the old per-icon header cluster AND the OS WebView2 right-click menu
  // with one Neon-Glass menu whose items vary by pane type. `anchor`/`align` let
  // the ⋯ button hang the menu leftward under itself; right-click opens at cursor.
  const [menu, setMenu] = useState<
    { x: number; y: number; anchor?: HTMLElement | null; align?: "left" | "right" } | null
  >(null);
  const overflowBtnRef = useRef<HTMLButtonElement>(null);
  // While the menu is open, tell native-webview panes (browser/appcast) to hide
  // their always-on-top native layer so this HTML menu isn't painted behind it.
  useEffect(() => {
    setPaneOverlay(pane.key, menu != null);
    return () => setPaneOverlay(pane.key, false);
  }, [pane.key, menu]);
  const openMenuFromButton = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (menu) {
      setMenu(null);
      return;
    }
    const r = overflowBtnRef.current?.getBoundingClientRect();
    if (!r) return;
    setMenu({ x: r.right, y: r.bottom + 6, anchor: overflowBtnRef.current, align: "right" });
  };
  const onPaneContextMenu = (e: React.MouseEvent) => {
    // Don't hijack surfaces that own their right-click: editable text (native
    // copy/paste/spellcheck), Monaco (its rich code menu), and xterm (right-click
    // selects-word + copy). Those reach the pane menu via the ⋯ button instead.
    const el = e.target as HTMLElement;
    if (el.closest('input, textarea, [contenteditable="true"], [contenteditable=""], .monaco-editor, .xterm')) return;
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY, align: "left" });
  };
  const buildMenuItems = (): PaneMenuEntry[] => {
    const items: PaneMenuEntry[] = [];
    const k = pane.key;
    if (pane.kind.type === "browser") {
      items.push(
        { key: "back", icon: <ArrowLeft size={14} />, label: "Back", onSelect: () => void browserBack(k).catch((e) => reportDiag("browser.nav", e, { action: "back" })) },
        { key: "fwd", icon: <ArrowRight size={14} />, label: "Forward", onSelect: () => void browserForward(k).catch((e) => reportDiag("browser.nav", e, { action: "forward" })) },
        { key: "reload", icon: <RotateCw size={14} />, label: "Reload", onSelect: () => void browserReload(k).catch((e) => reportDiag("browser.nav", e, { action: "reload" })) },
        {
          key: "copyurl",
          icon: <Link2 size={14} />,
          label: "Copy page URL",
          onSelect: () =>
            void browserCurrentUrl(k).then((u) => {
              if (u) navigator.clipboard?.writeText(u).catch((e) => reportDiag("app.clipboard", e, { action: "copyUrl" }));
            }),
        },
        { key: "devtools", icon: <Code2 size={14} />, label: "Open DevTools", onSelect: () => void browserOpenDevtools(k).catch((e) => reportDiag("browser.devtools", e, { action: "open" })) },
        { key: "sep-browser", separator: true },
      );
    }
    if (fileTarget) {
      items.push(
        { key: "edit", icon: <Pencil size={14} />, label: "Open in editor", onSelect: () => onOpenEditorFile(fileTarget.path, fileTarget.name) },
        { key: "view", icon: <Eye size={14} />, label: "Open in viewer", onSelect: () => onOpenViewerFile(fileTarget.path, fileTarget.name) },
        { key: "reveal", icon: <Folder size={14} />, label: "Reveal in files", onSelect: () => onRevealFile(fileTarget.path, fileTarget.name) },
        { key: "sep-file", separator: true },
      );
    }
    // content-contributed entries (paneMenuExtras) — e.g. the terminal's
    // copy/paste/clear, whose in-pane right-click is PASTE now (W7 pane 1).
    const extras = paneMenuExtras.get(pane.key)?.() ?? [];
    if (extras.length) {
      items.push(...(extras as PaneMenuEntry[]), { key: "sep-extras", separator: true });
    }
    items.push({ key: "dup", icon: <Layers size={14} />, label: "Duplicate pane", onSelect: onDuplicate });
    // header chrome already carries minimize/maximize/close — the menu only
    // repeats hide when there is NO header minimize button (grid mode).
    if (onToggleHide && !onMinimize)
      items.push({ key: "hide", icon: <EyeOff size={14} />, label: hideLabel ?? "Hide pane", hint: "keeps running", onSelect: onToggleHide });
    return items;
  };
  const toggleMon = () => {
    if (!monTarget) return;
    if (mon) monitorStop(monTarget.session).catch((e) => reportDiag("app.monitor", e, { action: "stop" }));
    else monitorStart(monTarget.socket, monTarget.session).catch((e) => reportDiag("app.monitor", e, { action: "start" }));
    setMon((v) => !v);
  };
  return (
    <m.div
      {...paneExit()}
      ref={(el: HTMLDivElement | null) => {
        // merge: wrapRef (rect registry + FLIP morph) + the popLayout ref
        // AnimatePresence forwards so the exit pop can measure this element.
        wrapRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      data-pane-key={pane.key}
      onMouseDownCapture={onFocus}
      onContextMenu={onPaneContextMenu}
      style={hidden ? { display: "none" } : style}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden bg-[var(--color-pane)] transition-[color,background-color,border-color,box-shadow,opacity] duration-200 ${
        dimmed ? "opacity-45" : ""
      } ${
        maximized
          ? // truly fullscreen — edge-to-edge over the top bar + sidebar, no chrome
            "fixed inset-0 z-40"
          : frameless
            ? // canvas mode — the pane IS the surface; no card chrome at all
              "fade-in-up relative"
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
      {/* activity glow (W5-3 BorderBeam): an accent light laps the pane border
          while an agent run streams here — the upgrade of the old breathing
          seam. z-30 so it reads above the chrome edge; reduce-motion → a static
          accent ring (handled inside BorderBeam). Skipped while maximized (no
          rounded border to ride). */}
      {busy && !maximized && !frameless && <BorderBeam className="z-30" duration={7} />}
      {!frameless && (
      <div className="relative flex h-[var(--aios-h-chrome)] shrink-0 items-center justify-between border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel)_55%,transparent)] px-2.5 backdrop-blur-md">
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
        {/* chrome controls — drag-to-reorder replaced the old ◀▶ move arrows; the
            ⋯ overflow opens the SAME menu as right-clicking the pane body, with
            hide / duplicate / open-as / per-type actions folded inside. */}
        <div className="flex items-center gap-0.5">
          {monTarget && (
            <button
              type="button"
              onClick={toggleMon}
              title={mon ? "monitoring → WhatsApp · click to stop" : "monitor this pane → WhatsApp"}
              className={`press grid h-6 w-6 place-items-center rounded-md transition-colors ${
                mon
                  ? "text-[var(--color-accent)]"
                  : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              }`}
            >
              <Radio size={13} className={mon ? "animate-pulse" : ""} />
            </button>
          )}
          <button
            ref={overflowBtnRef}
            type="button"
            onClick={openMenuFromButton}
            title="Pane menu — or right-click the pane"
            aria-haspopup="menu"
            aria-expanded={menu != null}
            className={`press grid h-6 w-6 place-items-center rounded-md transition-colors ${
              menu != null
                ? "bg-[var(--color-accent-soft)] text-[var(--color-accent)]"
                : "text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
            }`}
          >
            <EllipsisVertical size={13} />
          </button>
          {onMinimize && (
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), onMinimize())}
              className="press grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              title="Minimize to tray"
            >
              <Minus size={13} />
            </button>
          )}
          {onToggleMax && (
            <button
              type="button"
              onClick={(e) => (e.stopPropagation(), onToggleMax())}
              className="press grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
              title={maximized ? "Restore pane (Esc)" : "Maximize pane"}
            >
              {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="press grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-danger)_18%,transparent)] hover:text-[var(--color-danger)]"
            title="Close pane"
          >
            <X size={13} />
          </button>
        </div>
      </div>
      )}
      {menu && (
        <PaneMenu
          x={menu.x}
          y={menu.y}
          align={menu.align}
          anchorEl={menu.anchor}
          items={buildMenuItems()}
          onClose={() => setMenu(null)}
        />
      )}
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
            <FilesPane
              initialRoot={pane.kind.root}
              onOpenFile={onOpenFile}
              onAnnotate={onAnnotate}
              chatTargets={chatTargets}
              onAnnotateTo={onAnnotateTo}
            />
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
            <NotesPane paneKey={pane.key} onSend={onSendToAi} />
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
          ) : pane.kind.type === "history" ? (
            <HistoryPane onOpenChat={onResumeChat} />
          ) : pane.kind.type === "projects" ? (
            <ProjectsPane onLaunch={onLaunchProject} />
          ) : pane.kind.type === "scheduled-agents" ? (
            <ScheduledAgentsPane onOpenAgentChat={onOpenScheduledAgentChat} />
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
              initialGoal={pane.kind.type === "chat" ? pane.kind.goal : undefined}
              resume={pane.kind.type === "chat" ? pane.kind.resume : undefined}
              reattach={pane.kind.type === "chat" ? pane.kind.reattach : undefined}
              onOpenUrl={onOpenUrl}
              onChangeCwd={onChangeCwd}
              onSessionRecorded={onSessionRecorded}
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
    </m.div>
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
      {/* the brand DIAMOND is the mascot now (OSAI rebrand) — the same mark
          as the sidebar tile + the app icon, breathing its glow. */}
      <div className="brand-logo--splash flex flex-col items-center gap-5">
        <span
          className="block h-14 w-14 rotate-45 rounded-[14px] bg-[linear-gradient(135deg,var(--color-accent),var(--aios-accent-2))]"
          style={{
            boxShadow:
              "0 0 34px color-mix(in srgb, var(--color-accent) 65%, transparent), 0 0 90px color-mix(in srgb, var(--color-accent) 35%, transparent)",
          }}
        />
        <span className="font-mono text-[15px] font-semibold tracking-[0.5em] text-[var(--color-text-2)] [text-shadow:0_0_24px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]">
          OSAI
        </span>
      </div>
    </div>
  );
}

export default App;
