/**
 * Codex-style chat surface for the OSAI cockpit.
 *
 * Looks like OpenAI Codex's chat — centered "do anything" composer when empty,
 * clean transcript with text bubbles + tool-call cards after the first send —
 * but under the hood drives the local `claude` binary in headless streaming-JSON
 * mode (see `lib/chat.ts` / `chat.rs`). The backend is a dumb pipe: it forwards
 * raw newline-delimited claude JSON events over a per-session `Channel<string>`;
 * ALL parsing + rendering happens here.
 *
 * Lifecycle: one Channel + one chat session per mount. `chatStart` on mount with
 * the selected model/permission, `chatSend` on submit, `chatStop` on unmount.
 *
 * Best-in-class layer (Codex / Claude-Desktop grade) added on top of the working
 * stream-json core — without disturbing it:
 *   1. voice dictation lands in the composer (paneWriters registry)
 *   2. dependency-free markdown renderer for assistant bubbles (partial-safe)
 *   3. per-message hover actions: copy / regenerate / faint cost+token line
 *   4. stop-while-streaming (true interrupt, process survives)
 *   5. inline approval cards for `can_use_tool` control requests
 *   6. plan-mode toggle + persistent "pursue goal" pill
 *   7. `/` slash menu (clear / plan / model / help)
 *   8. `@` file-mention picker sourced from cwd
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { Channel } from "@tauri-apps/api/core";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  AlertTriangle,
  ArrowUp,
  ArrowDown,
  Bell,
  PackageOpen,
  Brain,
  Check,
  Share2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Clock,
  Copy,
  CornerDownLeft,
  FileCode,
  FileText,
  FileType,
  Folder,
  Globe,
  HelpCircle,
  History,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  Mic,
  Minimize2,
  Pencil,
  Pin,
  RefreshCw,
  Search,
  Shield,
  ShieldCheck,
  ShieldHalf,
  Sparkles,
  Quote,
  Square,
  Target,
  Terminal,
  Waypoints,
  Wrench,
  X,
  Zap,
  Map as MapIcon,
} from "lucide-react";
import {
  buildApprovalLine,
  chatInterrupt,
  chatDetach,
  chatReattach,
  chatSend,
  chatSteer,
  chatSendRaw,
  chatSetTitle,
  chatStart,
  chatStop,
  webChatSend,
  cleanSessionLabel,
  listChatSessions,
  readChatTranscript,
  recordChatSession,
  CHAT_MODELS,
  resolveChatModel,
  baseModelId,
  defaultAiForProvider,
  EFFORTS,
  PERMISSION_MODES,
  type ApprovalDecision,
  type ChatEvent,
  type ChatModel,
  type ChatSessionInfo,
  type ChatTurnInfo,
  type WebChatTurn,
} from "../lib/chat";
import { buildHandoffPrompt, contextWindowFor, engineGroupLabel, type HandoffDelivery } from "../lib/handoff";
import { mcpToolParts, toolIconKey, toolVerb, type ToolIconKey } from "../lib/toolInfo";
import { detectAvailableEngines } from "../lib/providerDetect";
import {
  availableApiModels,
  dynamicModelsFor,
  isApiProviderId,
  subscribeModelCatalog,
} from "../lib/providers";
import { listConfiguredProviders } from "../lib/apiKeys";
import { activePath, siblingPosition, stepBranch, type Selection, type TreeNode } from "../lib/chatTree";
import { turnsToApiMessages, messagesUpToLastUser, type ApiMessage } from "../lib/apiMessages";
import { createScheduledAgent, saveScheduledAgentChatSession } from "../lib/scheduledAgents";
import { fileSrc, readDir, saveImageTemp, type DirEntry } from "../lib/fs";
import { displayName, loadSettings, saveSettings } from "../lib/settings";
import { ALT, SHIFT, chord } from "../lib/platform";
import { claudeRate, codexRate, resetIn, type ModelRate } from "../lib/dashboard";
import {
  composerContextChips,
  contextLedger,
  cycleQueueSelection,
  effortChipLabel,
  moveQueuedMessage,
  queueMessage,
  removeQueuedMessage,
  resumeTitle,
  sendContract,
  stopStrategy,
  updateQueuedMessage,
  type ContextBudgetMode,
  type QueuedMessage,
} from "../lib/chatPaneState";
import {
  computeResponseVariants,
  activeVariantIndex,
  hiddenVariantTurnIds,
} from "../lib/chatBranching";
import { dictateCancel, dictateStart, dictateStop } from "../lib/voice";
import {
  chatHandles,
  chatSessions,
  paneWriters,
  paneSubmitters,
  paneImageDrop,
  openEditorFileInPane,
  openFileInPane,
  openViewerFileInPane,
  revealFileInPane,
  setChatBusy,
  setPaneAttention,
} from "../lib/paneBus";
import { resolvePaneFileTarget, targetLabel } from "../lib/paneRouting";
import { isAbsolutePath } from "../lib/paths.ts";
import {
  emptyRunEventState,
  parseRunEventState,
  reduceRunEvents,
  serializeRunEventState,
  type RunEventState,
  type RunPhase,
} from "../lib/runEvents";
import {
  compactionSummary,
  detectCompaction,
  finalizeStreamingTurns,
  reduceChatStreamEvent,
  replayHistoryToTurns,
  type ChatTurn,
} from "../lib/chatStream";
import { readChatHistory, saveChatTree, loadChatTree } from "../lib/chatHistory";
import { deriveFleet, isAgentTurn } from "../lib/subagentFleet";
import { useFleet } from "../lib/useFleet";
import { FleetView } from "./chat/FleetView";
import { FleetDock } from "./chat/FleetDock";
import { CadencedShimmer, ThinkingBlock } from "./chat/ThinkingBlock";
import { baseName, ellipsizeMid, fmtClock, fmtDuration } from "./chat/format";
import {
  AskQuestionCard,
  ApprovalCard,
  PlanProposalCard,
  parseAskQuestions,
  parsePlanProposal,
  type AskQuestion,
} from "./chat/InteractionCards";
import {
  CwdPicker,
  Dropdown,
  GoalEditorOverlay,
  ImagePreview,
  MenuItem,
  OverlayPanel,
  OverlayRow,
  ResumePicker,
  ResumedNote,
  type ImageChip,
  type SlashCommand,
} from "./chat/overlays";
import { ArmedStrip, EffortTicks, Filament, SendOrb, engineDotColor } from "./chat/composer/deck";
import { ModelMenu, modelKey } from "./chat/composer/ModelMenu";
import {
  AssistantBubble,
  DaySeparator,
  ResultFooter,
  TurnFrame,
  UserBubble,
  WorkingLine,
} from "./chat/Bubbles";
import {
  ChatCwdContext,
  ChatFileOpenContext,
  ChatSubmitContext,
  useChatFileOpener,
  type ChatFileOpener,
} from "./chat/context";
import { AgentStep } from "./chat/AgentStep";
import { serializeTree, deserializeTree } from "../lib/chatTreePersist";
import { sessionUsage, formatTokens, formatAge } from "../lib/sessionUsage";
import { lineDiff, diffStat, refineDiff, type DiffLine } from "../lib/textDiff";
import { memorySearch, type MemoryHit } from "../lib/memory";
import {
  onPetResult,
  onPetError,
  onPetUsage,
  onPetUserMessage,
} from "../lib/pet";
import { atBottom, distanceFromBottom } from "../lib/chatScroll";
import { dayBoundaries, fmtTickTime, markerStyle, nearestTick } from "../lib/chatTimeline";
import { invoke, isTauriRuntime } from "../lib/tauri";
import { playCue } from "../lib/sound";
import { PaneDropZone } from "./PaneDropZone";
import { CopyButton } from "./ui";
import { RunCinema } from "./RunCinema";
import { reportDiag } from "../lib/diag";
import { pushNotification, resolveNeedsInputNotification } from "../lib/notifications";
import { BlurFade } from "./fx/BlurFade";
import { spotlightMove } from "./fx/spotlightGlow";
import { SplitText } from "./fx/SplitText";
import { TiltCard } from "./fx/TiltCard";
import { DotPattern } from "./fx/DotPattern";
import { NumberTicker } from "./fx/NumberTicker";

// ── transcript model ──────────────────────────────────────────────────────

type Turn = ChatTurn;

/**
 * A display block — the rendered grouping of `Turn`s. Runs of consecutive tool
 * turns collapse into a single `activity` block (the Codex "Worked for Xs" line);
 * everything else passes through. Computed from `turns` purely for render — the
 * ingestion model (`Turn`) is untouched.
 */
type RenderBlock =
  | { kind: "user"; id: string; turn: Extract<Turn, { kind: "user" }> }
  | { kind: "assistant"; id: string; turn: Extract<Turn, { kind: "assistant" }> }
  | { kind: "thinking"; id: string; turn: Extract<Turn, { kind: "thinking" }> }
  | { kind: "approval"; id: string; turn: Extract<Turn, { kind: "approval" }> }
  | { kind: "result"; id: string; turn: Extract<Turn, { kind: "result" }> }
  | { kind: "compaction"; id: string; turn: Extract<Turn, { kind: "compaction" }> }
  | { kind: "change"; id: string; turn: ToolTurn }
  | { kind: "ask"; id: string; turn: ToolTurn }
  | { kind: "plan"; id: string; turn: ToolTurn }
  | { kind: "activity"; id: string; tools: ToolTurn[]; durationMs?: number };

/** Searchable text for find-in-chat — one string per block, covering what the
 *  eye could find by expanding everything (incl. collapsed thinking + tool
 *  args/output, which native browser find can never reach once collapsed). */
function blockSearchText(b: RenderBlock): string {
  switch (b.kind) {
    case "user":
    case "assistant":
    case "thinking":
      return b.turn.text;
    case "result":
      return b.turn.text ?? "";
    case "compaction":
      return b.turn.summary ?? "context compacted";
    case "approval":
      return `${b.turn.toolName} ${JSON.stringify(b.turn.input ?? {})}`;
    case "ask":
    case "change":
    case "plan":
      return `${b.turn.name} ${JSON.stringify(b.turn.input ?? {})}`;
    case "activity":
      return b.tools
        .map((t) => `${t.name} ${JSON.stringify(t.input ?? {})} ${t.result ?? ""}`)
        .join("\n");
  }
}

/** djb2 — stable tiny hash for pin identity across reloads (turn ids are
 *  minted per mount, so they can't key persistence; the answer TEXT can). */
function hashText(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** First non-blank line of a string, capped — the scrubber's hover snippet. */
function firstLine(s: string): string {
  const l = (s.split("\n").find((x) => x.trim()) ?? "").trim();
  return l.length > 80 ? `${l.slice(0, 80)}…` : l;
}

/** A short label for a block on the scrubber's hover/drag bubble. */
function tickLabel(b: RenderBlock): string {
  switch (b.kind) {
    case "user":
    case "assistant":
    case "thinking":
      return firstLine(b.turn.text);
    case "result":
      return b.turn.text ? firstLine(b.turn.text) : b.turn.ok === false ? "error" : "done";
    case "compaction":
      return "context compacted";
    case "approval":
      return `approve ${b.turn.toolName}`;
    case "ask":
      return "a question";
    case "plan":
      return "a plan to review";
    case "change": {
      const inp = b.turn.input ?? {};
      const p =
        (typeof inp.file_path === "string" && inp.file_path) ||
        (typeof inp.path === "string" && inp.path) ||
        "";
      const name = p ? p.split(/[\\/]/).filter(Boolean).pop() : "";
      return name ? `edited ${name}` : "file change";
    }
    case "activity":
      return `${b.tools.length} step${b.tools.length === 1 ? "" : "s"}`;
  }
}

let _uid = 0;
const uid = () => `t${++_uid}`;
type ChatUsageRate = Awaited<ReturnType<typeof codexRate>>;
type UsageWin = { pct: number | null; resetsAt: number | null };
type UsageSnapshot = { fiveHour: UsageWin; sevenDay: UsageWin };

function isSparkModel(modelId: string): boolean {
  return /^gpt-5\.3-codex-spark$/i.test(modelId);
}

function codexUsageForModel(r: ChatUsageRate, model: ChatModel): UsageSnapshot | null {
  if ((model.engine ?? "claude") !== "codex") return null;
  if (!isSparkModel(model.id)) {
    return { fiveHour: r.fiveHour, sevenDay: r.sevenDay };
  }
  const sparkEntry =
    r.models[model.id] ??
    Object.entries(r.models).find(([id]) => /^gpt-5\.3-codex-spark$/i.test(id))?.[1];
  return sparkEntry ?? { fiveHour: r.fiveHour, sevenDay: r.sevenDay };
}

function hasUsageData(snapshot: UsageSnapshot | null): snapshot is UsageSnapshot {
  if (!snapshot) return false;
  return snapshot.fiveHour.pct != null || snapshot.sevenDay.pct != null;
}

/** Per-engine maps of model-specific rate windows for the picker rows. */
type PickerWindows = {
  claude: Record<string, ModelRate>;
  codex: Record<string, ModelRate>;
};

/**
 * The model-specific window to chip onto a picker row, if its provider reports
 * one. Claude carve-outs are bare names ("sonnet" matches claude-sonnet-4-6),
 * codex entries are full ids; longest matching key wins so "…codex" can never
 * shadow "…codex-spark". Weekly window preferred (that's what the carve-outs
 * are); 5h only when it's all a model has.
 */
function modelWindowFor(
  model: ChatModel,
  windows: PickerWindows,
): { tag: "5h" | "7d"; pct: number; resetsAt: number | null } | null {
  const engine = model.engine ?? "claude";
  if (engine !== "claude" && engine !== "codex") return null;
  const map = windows[engine];
  const id = model.id.toLowerCase();
  const key = Object.keys(map)
    .filter((k) => id.includes(k.toLowerCase()))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return null;
  const m = map[key];
  if (m.sevenDay.pct != null) {
    return { tag: "7d", pct: m.sevenDay.pct, resetsAt: m.sevenDay.resetsAt };
  }
  if (m.fiveHour.pct != null) {
    return { tag: "5h", pct: m.fiveHour.pct, resetsAt: m.fiveHour.resetsAt };
  }
  return null;
}

let _imgSeq = 0;
/** "0:05" from elapsed seconds (dictation timer). */
function fmtElapsed(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
/** Precomputed equalizer bars for the inline dictation waveform (time-keyed). */
const WAVEFORM_BARS: { h: number; delay: number }[] = Array.from(
  { length: 40 },
  (_, i) => ({ h: 28 + ((i * 37) % 60), delay: (i * 70) % 900 }),
);
// (the osai-wave keyframe lives in App.css now — one definition app-wide.)

/** File extension for a clipboard/file image mime. */
function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("gif")) return "gif";
  if (m.includes("webp")) return "webp";
  return "png";
}

// instruction prefixes for the composer modes
const PLAN_PREFIX =
  "Plan first: lay out a concise step-by-step plan and wait for my go-ahead before writing any code or running mutating commands.\n\n";

// Steered (silent) into the running turn the moment an AskUserQuestion /
// ExitPlanMode tool call arrives. Headless claude auto-dismisses both tools
// instantly (no TTY for its native picker), so without this the model reads the
// dismissal as "no answer" and barrels ahead on assumptions before the user has
// touched the card (user-reported). Silent = kept out of history/replay.
const HOLD_ASK =
  "[OSAI shell] Your AskUserQuestion call was auto-dismissed by the headless harness, but the user IS being shown your questions in an interactive picker right now. Do not proceed on assumptions or pick defaults yourself. Wrap up cleanly and STOP — the user's actual selections will arrive as the next user message.";
const HOLD_PLAN =
  "[OSAI shell] Your ExitPlanMode call was auto-dismissed by the headless harness, but the user IS reviewing your plan in an interactive approval card right now. Do not start implementing and do not re-plan. Wrap up cleanly and STOP — their approve/revise decision will arrive as the next user message.";
const GOAL_PREFIX = (goal: string) =>
  `Ongoing goal (keep pursuing this across turns until I say it's done): ${goal}\n\n`;
// ultracode = xhigh effort + workflows. Headless `claude -p` has no ultracode
// flag, so we run xhigh and replicate the "workflows" half with this directive:
// orchestrate, fan out, verify — be maximally thorough.
const ULTRA_PREFIX =
  "Ultracode mode is ON. Maximize thoroughness and correctness — token cost is not a constraint. For any substantial task, decompose it and fan out parallel sub-agents (Task tool) to cover it, then adversarially verify findings before concluding. Prefer orchestrated multi-agent execution over a single pass; only handle trivially small tasks inline.\n\n";

/** One-line consequences for the access modes — visible in the wrench menu
 *  rows (a permission choice shouldn't need a hover to understand). */
const PERMISSION_SUBS: Record<string, string> = {
  bypassPermissions: "runs everything without asking — trusted repos only",
  acceptEdits: "file edits auto-approved, commands still ask",
  default: "every tool call asks first",
  plan: "read-only: plans, never executes",
};

const CONTEXT_BUDGETS: Array<{ id: ContextBudgetMode; label: string; sub: string }> = [
  { id: "lean", label: "lean", sub: "minimal startup context, explicit only" },
  { id: "agent", label: "agent", sub: "terminal-grade tools and instructions" },
  { id: "ultracode", label: "ultracode", sub: "xhigh + fanout, expensive by design" },
];

/** Shared trigger styling for the composer's control pills (access · context ·
 *  effort · model). Quiet by default; the OPEN variant lights the accent ring so
 *  the live menu reads at a glance. The hover lift is the small tactile "quirk" —
 *  reduce-motion neutralizes the transform via the master guard in App.css. */
const CTRL_PILL =
  "flex shrink-0 items-center gap-1 rounded-full border border-transparent bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] px-2 py-[3px] font-sans text-[11px] text-[var(--color-muted)] backdrop-blur-md transition-all duration-150 hover:border-[var(--color-border)] hover:text-[var(--color-text)]";
const CTRL_PILL_OPEN =
  "flex shrink-0 items-center gap-1 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_55%,transparent)] bg-[var(--color-accent-soft)] px-2 py-[3px] font-sans text-[11px] text-[var(--color-text)] shadow-[var(--osai-glow-soft)] backdrop-blur-md transition-all duration-150";
/** The model pill leads the action group (nearest send — the most-changed
 *  control), so it reads accent-tinted at rest (mockup 02's `.pill.model`):
 *  a faint accent wash + edge, lifting on hover. Distinct from the neutral
 *  CTRL_PILL without shouting like CTRL_PILL_OPEN. */
const CTRL_PILL_MODEL =
  "flex items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_38%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] px-2.5 py-1 font-sans text-[11.5px] text-[var(--color-text)] backdrop-blur-md transition-all duration-150 hover:-translate-y-px hover:border-[color-mix(in_srgb,var(--color-accent)_55%,transparent)] hover:shadow-[var(--osai-glow-soft)]";

/** Chip ids that are now interactive control PILLS in the composer's action row,
 *  so the passive summary-chips row drops them (no duplicate readout). */
const CONTROL_CHIP_IDS = new Set(["model", "effort", "permission", "budget", "cwd"]);

function memoryContextBlock(memories: MemoryHit[]): string {
  if (memories.length === 0) return "";
  return `Relevant OSAI memory context:\n${memories
    .map((m, i) => {
      const reasons = m.reasons.length ? ` reasons: ${m.reasons.join("; ")}` : "";
      return `${i + 1}. ${m.title} [${m.type}] — ${m.description || m.preview}${reasons}`;
    })
    .join("\n")}\n\n`;
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Renders tool input as a compact `key: value` preview (first few keys). */
function previewArgs(input: Record<string, unknown>): string {
  const entries = Object.entries(input ?? {});
  if (entries.length === 0) return "";
  return entries
    .slice(0, 3)
    .map(([k, v]) => {
      let s = typeof v === "string" ? v : JSON.stringify(v);
      if (s.length > 80) s = s.slice(0, 80) + "…";
      return `${k}: ${s}`;
    })
    .join("  ");
}

/** Pulls a total token count out of the loose result `usage` object. */
function tokensFromUsage(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  const inT = typeof u.input_tokens === "number" ? u.input_tokens : 0;
  const outT = typeof u.output_tokens === "number" ? u.output_tokens : 0;
  const cacheRead =
    typeof u.cache_read_input_tokens === "number"
      ? u.cache_read_input_tokens
      : 0;
  const cacheCreate =
    typeof u.cache_creation_input_tokens === "number"
      ? u.cache_creation_input_tokens
      : 0;
  const total = inT + outT + cacheRead + cacheCreate;
  return total > 0 ? total : undefined;
}

/** OUTPUT tokens from a result `usage` — the honest per-turn "what it wrote".
 *  The in+cache sum re-counts the whole context once per STEP of the turn
 *  (verified from captured logs: a tool-heavy turn "weighed" 2.5M), so as a
 *  per-turn stat it's noise; output is the signal. */
function outputTokensFromUsage(usage: unknown): number | undefined {
  if (!usage || typeof usage !== "object") return undefined;
  const u = usage as Record<string, unknown>;
  return typeof u.output_tokens === "number" && u.output_tokens > 0
    ? u.output_tokens
    : undefined;
}

/** Context size (prompt the model saw) from a PER-CALL usage object:
 *  input + cache-read + cache-write. Only meaningful on per-call usage
 *  (assistant message events); a result event's usage sums every call in the
 *  turn — reading it as context is what produced the "492% ctx" readout. */
function contextFromUsage(usage: unknown): number {
  if (!usage || typeof usage !== "object") return 0;
  const u = usage as Record<string, unknown>;
  const num = (k: string) => (typeof u[k] === "number" ? (u[k] as number) : 0);
  return (
    num("input_tokens") + num("cache_read_input_tokens") + num("cache_creation_input_tokens")
  );
}

/** Time-of-day kicker for the empty hero ("good evening, jullien"). */
function timeGreeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "up late";
  if (h < 12) return "good morning";
  if (h < 17) return "good afternoon";
  return "good evening";
}

// (the empty hero's starter deck was removed with the hero cards — the home
// lock screen owns discovery now. Owner request, W1.6b.)

// ── tool presentation (Codex-style activity steps) ───────────────────────────

type ToolTurn = Extract<Turn, { kind: "tool" }>;

/** True when a tool turn is an AskUserQuestion we can render interactively. */
function isAskQuestionTool(t: ToolTurn): boolean {
  return t.name === "AskUserQuestion" && parseAskQuestions(t.input) != null;
}

/** True when a tool turn is an ExitPlanMode proposal we can render interactively.
 *  In headless stream-json mode there's no TTY for claude's native plan-approval
 *  prompt, so the tool auto-dismisses (tool_result `"Exit plan mode?"`) and the
 *  model stalls — exactly like AskUserQuestion. We render our own approve/refine
 *  card and feed the verdict back as the next user turn. */
function isPlanProposalTool(t: ToolTurn): boolean {
  return t.name === "ExitPlanMode" && parsePlanProposal(t.input) != null;
}

// resolvePlan's verdict sentences — fixed sentinels so a REPLAYED transcript can
// recover the decision (the in-memory verdict map dies with the pane, and
// ExitPlanMode's recorded tool_result is always the meaningless auto-dismiss).
const PLAN_APPROVE_SENTINEL = "I approve this plan";
const PLAN_REJECT_SENTINEL = "Don't start building yet";

/** Recover a plan card's verdict from the conversation itself: the first user
 *  turn after the plan tool either starts with one of the fixed verdict
 *  sentinels (→ resolved) or went another way (→ leave the card open). Without
 *  this, reopening a chat re-armed already-approved plans — one more click
 *  double-sent "go ahead and implement it now". */
function inferPlanVerdict(turns: Turn[], toolId: string): "approved" | "rejected" | undefined {
  const idx = turns.findIndex((t) => t.id === toolId);
  if (idx < 0) return undefined;
  for (let i = idx + 1; i < turns.length; i++) {
    const t = turns[i];
    if (t.kind !== "user") continue;
    if (t.text.startsWith(PLAN_APPROVE_SENTINEL)) return "approved";
    if (t.text.startsWith(PLAN_REJECT_SENTINEL)) return "rejected";
    return undefined;
  }
  return undefined;
}

/** Edit / Write / MultiEdit / NotebookEdit — file-mutating tools that get a
 *  prominent, always-visible change card (with the diff inline) instead of being
 *  folded into the collapsed "N steps" activity group. (codex apply_patch is
 *  normalized to `edit` upstream.) */
function isFileEditTool(t: ToolTurn): boolean {
  const n = t.name.toLowerCase();
  return n === "edit" || n === "multiedit" || n === "write" || n === "notebookedit";
}

/** Total +adds / -dels for a file-edit tool, for the change-card header. */
function editStat(turn: ToolTurn): { adds: number; dels: number } {
  const name = turn.name.toLowerCase();
  const inp = turn.input ?? {};
  if (name === "write") {
    const content = typeof inp.content === "string" ? inp.content : "";
    return { adds: content ? content.split("\n").length : 0, dels: 0 };
  }
  const pairs =
    name === "multiedit" && Array.isArray(inp.edits)
      ? (inp.edits as Array<Record<string, unknown>>)
      : [{ old_string: inp.old_string, new_string: inp.new_string }];
  let adds = 0;
  let dels = 0;
  for (const e of pairs) {
    const s = diffStat(
      lineDiff(
        typeof e.old_string === "string" ? e.old_string : "",
        typeof e.new_string === "string" ? e.new_string : "",
      ),
    );
    adds += s.adds;
    dels += s.dels;
  }
  return { adds, dels };
}

/** Pull the most relevant target arg out of a tool's input. Mirrors the verbs
 *  below: a path basename for file tools, the command for Bash, the pattern for
 *  search, the URL for fetches, else a compact key:value preview. */
function toolTarget(turn: ToolTurn): { label: string; full: string } {
  const inp = turn.input ?? {};
  const name = turn.name.toLowerCase();
  const str = (k: string) =>
    typeof inp[k] === "string" ? (inp[k] as string) : undefined;

  // file tools → basename (full path on hover)
  const path = str("file_path") ?? str("path") ?? str("notebook_path");
  if (path) return { label: ellipsizeMid(baseName(path)), full: path };

  // shell → the command (first line)
  if (
    name === "bash" ||
    name === "powershell" ||
    name === "bashoutput" ||
    name === "exec_command" ||
    name === "write_stdin"
  ) {
    const cmd = str("command") ?? str("cmd") ?? str("chars") ?? "";
    const firstLine = cmd.split("\n")[0] ?? cmd;
    return { label: ellipsizeMid(firstLine, 60), full: cmd };
  }

  // MCP tools → "server · tool" (args on hover), instead of the raw
  // mcp__server__toolName identifier flooding the row.
  const mcp = mcpToolParts(turn.name);
  if (mcp) {
    const label = mcp.tool ? `${mcp.server} · ${mcp.tool}` : mcp.server;
    const args = previewArgs(inp);
    return { label: ellipsizeMid(label, 56), full: args ? `${label}\n${args}` : label };
  }

  // skills → "/name args", the way the user would have typed it
  if (name === "skill" || name === "slashcommand") {
    const skill = str("skill") ?? str("command") ?? "";
    const args = str("args") ?? "";
    const label = skill ? `/${skill}${args ? ` ${args}` : ""}` : args;
    return { label: ellipsizeMid(label, 56), full: label };
  }

  // workflows → the script's name (deterministic multi-agent runs)
  if (name === "workflow") {
    const label = str("name") ?? str("scriptPath") ?? "script";
    return { label: ellipsizeMid(label, 56), full: label };
  }

  if (name === "toolsearch") {
    const q = str("query") ?? "";
    return { label: ellipsizeMid(q, 56), full: q };
  }

  if (name === "pushnotification") {
    const label = str("title") ?? str("body") ?? "";
    return { label: ellipsizeMid(label, 56), full: label };
  }

  if (name === "sendmessage") {
    const label = str("to") ?? "";
    return { label: ellipsizeMid(label, 56), full: label };
  }

  if (name === "taskcreate" || name === "taskupdate") {
    const label = str("subject") ?? str("description") ?? str("taskId") ?? "";
    return { label: ellipsizeMid(label, 56), full: label };
  }

  // search / grep / glob → pattern (+ optional path)
  if (name === "grep" || name === "glob" || name === "search") {
    const pat = str("pattern") ?? str("query") ?? "";
    const where = str("path");
    const full = where ? `${pat}  in ${where}` : pat;
    return { label: ellipsizeMid(pat || full, 56), full };
  }

  // web → url / query / domains
  if (name === "webfetch" || name === "webfetch_tool") {
    const url = str("url") ?? "";
    return { label: ellipsizeMid(url, 56), full: url };
  }
  if (name === "websearch" || name === "web_search") {
    const q = str("query") ?? "";
    return { label: ellipsizeMid(q, 56), full: q };
  }

  // task / sub-agent → description
  if (name === "task" || name === "agent" || name === "subagent" || name === "sub-agent") {
    const d = str("description") ?? str("subagent_type") ?? "";
    return { label: ellipsizeMid(d, 56), full: d };
  }

  // ask-the-user → the (first) question header, so the row says WHAT was asked
  if (name === "askuserquestion") {
    const qs = inp.questions;
    const first = Array.isArray(qs) && qs[0] && typeof qs[0] === "object"
      ? ((qs[0] as Record<string, unknown>).header ?? (qs[0] as Record<string, unknown>).question)
      : undefined;
    const label = typeof first === "string" ? first : "a question";
    return { label: ellipsizeMid(label, 56), full: label };
  }

  // artifact / shared guide → its title/description
  if (name === "artifact" || name === "shareonboardingguide") {
    const label = str("title") ?? str("description") ?? str("file_path") ?? "";
    return { label: ellipsizeMid(label, 56), full: label };
  }

  // schedules / monitors → the human reason/condition they carry
  if (name === "schedulewakeup" || name === "monitor" || name === "reportfindings") {
    const label = str("reason") ?? str("until") ?? str("condition") ?? "";
    return { label: ellipsizeMid(label, 56), full: label };
  }

  // background-task control → the task id it acts on
  if (name === "taskoutput" || name === "taskstop") {
    const label = str("task_id") ?? str("taskId") ?? "";
    return { label: ellipsizeMid(label, 56), full: label };
  }

  // fall back to the generic key:value preview
  const preview = previewArgs(inp);
  return { label: ellipsizeMid(preview, 56), full: preview };
}

/** Extract the file path a tool acted on, from its model-emitted input — the
 *  gold source for "open in pane". Covers claude Read/Edit/Write/MultiEdit/
 *  NotebookEdit (`file_path`/`notebook_path`) and codex apply_patch/exec
 *  (`path`/`file`). Bash file args are intentionally NOT guessed here (too
 *  ambiguous); a real file there shows up as a separate Read/Edit tool anyway.
 *  Returns null when the tool isn't file-shaped. */
function toolFilePath(turn: ToolTurn): string | null {
  const name = turn.name.toLowerCase();
  const inp = turn.input ?? {};
  const str = (k: string) => (typeof inp[k] === "string" ? (inp[k] as string) : undefined);
  switch (name) {
    case "read":
    case "write":
    case "edit":
    case "multiedit":
      return str("file_path") ?? str("path") ?? null;
    case "notebookedit":
      return str("notebook_path") ?? str("file_path") ?? null;
    // tools whose `path`/args are NOT a single file to open (a search dir, a
    // shell command, a URL) — never offer "open in pane".
    case "bash":
    case "bashoutput":
    case "exec_command":
    case "write_stdin":
    case "grep":
    case "glob":
    case "search":
    case "webfetch":
    case "webfetch_tool":
    case "websearch":
    case "task":
    case "todowrite":
      return null;
    // codex maps apply_patch/fileChange → "edit" (handled above); a bare codex
    // file action may still carry path/file.
    default:
      return str("file_path") ?? str("notebook_path") ?? str("path") ?? str("file") ?? null;
  }
}

// tool verb + name-parsing (mcpToolParts, toolVerb) now live in ../lib/toolInfo
// — one pure, tested registry shared with the sub-agent fleet rows.

/** Bind each pure icon GROUP (lib/toolInfo `toolIconKey`) to a lucide component.
 *  The classification lives in the shared registry; only the component binding
 *  is here (icons can't live in a React-free lib). Every current Claude Code
 *  tool maps to a real icon — the "tool" fallback is for genuinely unknown names. */
const TOOL_ICONS: Record<ToolIconKey, typeof Wrench> = {
  file: FileText,
  edit: Pencil,
  shell: Terminal,
  search: Search,
  web: Globe,
  plan: MapIcon,
  list: ListChecks,
  agent: Waypoints,
  skill: Zap,
  clock: Clock,
  notify: Bell,
  ask: HelpCircle,
  worktree: Folder,
  publish: Share2,
  report: ShieldCheck,
  mcp: Wrench,
  tool: Wrench,
};

/** Pick the lucide icon component for a tool's activity row. */
function toolIcon(name: string): typeof Wrench {
  return TOOL_ICONS[toolIconKey(name)];
}

// ── file artifacts (Write / Edit / NotebookEdit targets) ─────────────────────

interface Artifact {
  path: string;
  name: string;
  kind: "img" | "pdf" | "doc" | "code" | "file";
}

const IMG_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp"]);
const DOC_EXT = new Set(["doc", "docx", "md", "txt", "rtf", "csv", "xlsx", "xls", "ppt", "pptx", "key"]);
const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "rb", "php", "c", "cc", "cpp",
  "h", "hpp", "cs", "swift", "kt", "sh", "zsh", "bash", "json", "yaml", "yml", "toml",
  "html", "css", "scss", "sql", "lua", "dart", "vue", "svelte",
]);

function artifactKind(path: string): Artifact["kind"] {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (IMG_EXT.has(ext)) return "img";
  if (CODE_EXT.has(ext)) return "code";
  if (DOC_EXT.has(ext)) return "doc";
  return "file";
}

/** Detect the file an artifact-producing tool wrote to (Write/Edit/NotebookEdit). */
function artifactFromTool(turn: ToolTurn): Artifact | null {
  const name = turn.name.toLowerCase();
  if (
    name !== "write" &&
    name !== "edit" &&
    name !== "multiedit" &&
    name !== "notebookedit"
  ) {
    return null;
  }
  const inp = turn.input ?? {};
  const path =
    (typeof inp.file_path === "string" && inp.file_path) ||
    (typeof inp.path === "string" && inp.path) ||
    (typeof inp.notebook_path === "string" && inp.notebook_path) ||
    "";
  if (!path) return null;
  return { path, name: baseName(path), kind: artifactKind(path) };
}

// ── deterministic in-chat file open ──────────────────────────────────────────
//
// Opening a file the model mentioned must NOT rely on the model or on a
// name-search-and-hope. Two reliable sources:
//   1. ABSOLUTE paths harvested from tool_use inputs (Read/Edit/Write/… file_path,
//      codex apply_patch path) — already model-verified, opened directly.
//   2. text/code-fence mentions → resolved against the session cwd by the backend
//      (`resolve_in_cwd`), which returns a real absolute path ONLY if the file
//      exists. A bounded fuzzy `find_files` is the LAST resort (exact-join first).
// Everything routes through `openFileInPane` (paneBus) → identical to FilesPane.
//
// `cwd` is provided once at the ChatPane root via this context so the deep
// markdown/inline/tool renderers don't each need it threaded through.

/** Resolve a file reference against `cwd` (backend existence check) and open it
 *  in a pane. Absolute/`~` paths skip resolution. Falls back to a BOUNDED fuzzy
 *  basename match via `find_files` only when an exact join fails — never a blind
 *  name search. A reference that resolves to nothing raises a toast naming the
 *  ref + cwd (it used to fail dead-silent, which read as a broken click). */
async function openChatFileReference(ref: string, cwd?: string | null): Promise<void> {
  const normalized = resolvePaneFileTarget(ref);
  // Absolute (incl. Windows `C:\…`) or home paths are already concrete — open
  // directly (paneForFile handles the existence/decoding). Matches harvested
  // tool paths too.
  if (isAbsolutePath(normalized) || normalized.startsWith("~")) {
    openFileInPane(normalized, targetLabel(normalized));
    return;
  }
  if (!isTauriRuntime() || !cwd) {
    // can't existence-check without a backend/cwd → best-effort as-is.
    openFileInPane(normalized, targetLabel(normalized));
    return;
  }
  const notFound = () =>
    pushNotification({
      kind: "chat.file_missing",
      title: `couldn't open ${targetLabel(normalized)}`,
      body: `"${normalized}" wasn't found under ${cwd}`,
      level: "warning",
      priority: "high",
      sourceLabel: "chat",
    });
  try {
    const resolved = await invoke<string | null>("resolve_in_cwd", {
      cwd,
      reference: normalized,
    });
    if (resolved) {
      openFileInPane(resolved, targetLabel(resolved));
      return;
    }
    // last resort: bounded fuzzy basename match (exact join already failed).
    // find_files emits `/`-separated rel paths on every OS; normalize the ref
    // side too so a `docs\x.md` mention still matches.
    const base = targetLabel(normalized).toLowerCase().replace(/\\/g, "/");
    if (base.includes(".")) {
      const files = await invoke<string[]>("find_files", { root: cwd, max: 20000 });
      const hit =
        files.find((f) => f.toLowerCase().replace(/\\/g, "/").endsWith(`/${base}`)) ??
        files.find((f) => f.toLowerCase().replace(/\\/g, "/") === base);
      if (hit) {
        const abs = isAbsolutePath(hit) ? hit : `${cwd.replace(/[\\/]+$/, "")}/${hit}`;
        openFileInPane(abs, targetLabel(abs));
        return;
      }
    }
    notFound();
  } catch (e) {
    // resolution failed → don't open a broken pane, but say so.
    reportDiag("chat.openFile", e, { action: "resolve", ref: normalized });
    notFound();
  }
}

// ── component ────────────────────────────────────────────────────────────────

const runEventsStorageKey = (sessionId: string) => `osai.chat.run-events:${sessionId}`;

export function ChatPane({
  cwd,
  paneKey,
  active,
  hidden,
  seed,
  resume,
  reattach,
  modelId,
  agentId,
  agentLabel,
  initialGoal,
  onOpenUrl,
  onChangeCwd,
  onSessionRecorded,
}: {
  cwd?: string;
  paneKey?: string;
  /** True when this is the focused/active pane. Drives composer auto-focus on
   *  becoming active (and on mount) — but never steals focus mid-action. */
  active?: boolean;
  /** True when the pane is minimized out of the grid (display:none). A hidden
   *  chat that hits a tool-approval prompt is invisible — so we fire a
   *  high-priority `chat.needs_input` notification that reattaches on click. */
  hidden?: boolean;
  seed?: string;
  modelId?: string;
  agentId?: string;
  agentLabel?: string;
  /** Standing goal to seed the goal box on mount (re-seeded from a resumed Work Session). */
  initialGoal?: string;
  /** Resume a prior chat session on mount (from the idle "continue" rail).
   *  engine/model carry the saved session's backend so a resumed codex thread
   *  boots on codex (not the default claude) — otherwise --resume sends a codex
   *  thread-id to the claude binary and the pane comes up blank. */
  resume?: { id: string; title: string; engine?: string; model?: string; findText?: string };
  /** Reattach to a still-live backgrounded session by its backend id (from the
   *  "running" tray) — replays its buffer and continues live instead of spawning. */
  reattach?: number;
  /** Open an http(s) link from rendered markdown in an in-app browser pane. */
  onOpenUrl?: (url: string) => void;
  /** Change the working directory this chat operates in. Persisted on the pane
   *  by App; the new cwd flows back as the `cwd` prop and restarts the session
   *  rooted there (claude/codex can only set cwd at process start). */
  onChangeCwd?: (dir: string) => void;
  /** Report this chat's durable session id once recorded, so App can bind it to a
   *  Work Session (multi-chat capture). Fires on first record (+ codex promote). */
  onSessionRecorded?: (info: {
    paneKey?: string;
    sessionId: string;
    title: string;
    cwd?: string;
    engine?: string;
    model?: string;
  }) => void;
}) {
  const nativeRuntime = useMemo(() => isTauriRuntime(), []);
  const webChatRuntime = !nativeRuntime;
  const [turns, setTurns] = useState<Turn[]>([]);
  // Conversation tree (Tier-3 P2 branching, API-tier only). Step (a): a LINEAR
  // mirror of `turns` — nodes carry only structure (id + parentId), values resolve
  // from `turns` by id (so a streaming text delta never rebuilds it). `treeTurns`
  // below projects the active path and equals `turns` until a fork exists, so this
  // is a no-op for every current flow. Forking + the switcher + active-path send
  // land in the next steps.
  const [treeNodes, setTreeNodes] = useState<TreeNode<string>[]>([]);
  // selection (which child is active at each branch point); the ‹N/M› switcher
  // writes it. pendingForkParentRef carries the fork point from a regenerate/edit
  // to the mirror effect, which links the next new turn there (a sibling branch).
  const [treeSel, setTreeSel] = useState<Selection>({});
  const pendingForkParentRef = useRef<string | null>(null);
  // the user turn being edited (API edit-fork): the next send forks a sibling
  // branch from its parent, so editing a message branches instead of overwriting.
  const pendingEditRef = useRef<string | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  turnsRef.current = turns;
  const [runEventState, setRunEventState] = useState<RunEventState>(() =>
    emptyRunEventState(),
  );
  const [runEventsKey, setRunEventsKey] = useState<string | null>(() =>
    resume?.id ? runEventsStorageKey(resume.id) : null,
  );
  useEffect(() => {
    if (!runEventsKey) return;
    try {
      const restored = parseRunEventState(localStorage.getItem(runEventsKey));
      if (!restored) return;
      setRunEventState((current) =>
        current.events.length > 0 ? current : restored,
      );
    } catch {
      /* ignore */
    }
  }, [runEventsKey]);
  useEffect(() => {
    if (!runEventsKey) return;
    try {
      if (runEventState.events.length > 0) {
        localStorage.setItem(runEventsKey, serializeRunEventState(runEventState));
      } else {
        localStorage.removeItem(runEventsKey);
      }
    } catch {
      /* ignore */
    }
  }, [runEventsKey, runEventState]);
  // composer draft persists per pane so /clear, a restart, or a remount never
  // loses what you were typing. Keyed by paneKey; seed (e.g. notes "send to AI")
  // still wins on first mount.
  const draftKey = paneKey ? `osai-chat-draft:${paneKey}` : null;
  const [input, setInput] = useState<string>(() => {
    if (seed) return seed;
    if (draftKey) {
      try {
        return localStorage.getItem(draftKey) ?? "";
      } catch {
        /* ignore */
      }
    }
    return "";
  });
  // persist the draft as it changes (cleared on send).
  useEffect(() => {
    if (!draftKey) return;
    try {
      if (input) localStorage.setItem(draftKey, input);
      else localStorage.removeItem(draftKey);
    } catch {
      /* ignore */
    }
  }, [input, draftKey]);
  const [isComposerCollapsed, setComposerCollapsed] = useState(false);

  const [streaming, setStreaming] = useState(false);
  const [backendBusy, setBackendBusy] = useState(false);
  const [started, setStarted] = useState(false);
  // Background sub-agents still working AFTER the main turn ended (run_in_background
  // agents keep going once the model's turn closes). Tracked from the engine's
  // `system/task_*` lifecycle events so the pane can show "still running" even
  // though `streaming`/`backendBusy` are false. Keyed by task_id; a task is
  // dropped when its completion/cancel notification arrives. Reattach replays the
  // same events through this handler, so the set self-corrects.
  const [bgTasks, setBgTasks] = useState<
    { id: string; toolUseId?: string; description: string; subagentType?: string; lastLine?: string }[]
  >([]);
  // transient pre-session status shown inline in the hero (queued-send notice,
  // startup failure) — never a transcript turn, so the empty state stays calm.
  const [startupNote, setStartupNote] = useState<string | null>(null);
  // activity glow: report this pane's live run to the shell (chrome breathes).
  // Background sub-agents count as "busy" too — so the tab dot stays lit while a
  // run_in_background fan-out keeps working after the main turn closed.
  const bgActive = bgTasks.length > 0;
  useEffect(() => {
    if (!paneKey) return;
    setChatBusy(paneKey, streaming || bgActive);
    return () => setChatBusy(paneKey, false);
  }, [paneKey, streaming, bgActive]);
  // Unified fleet model — the single source of truth for sub-agent rendering
  // (transcript nesting + composer dock). Computed over the FULL `turns` (a safe
  // superset of the tree-filtered visibleTurns) and declared HIGH in the body so
  // the composer dock (built before visibleTurns) can read it without a TDZ.
  //   · childrenByAgent/childIds — global parent→children map so a sub-agent's
  //     children nest under its Agent row wherever they landed (no detached block).
  //   · dock — currently-running background agents (run_in_background).
  //   · backgroundMemberIds — tool ids kept OUT of the transcript while their
  //     background agent runs (re-enter, collapsed, when it finishes).
  const fleet = useFleet(turns, bgTasks);
  // claude's init event arrived (session_id known) — gates the seed auto-send
  const [claudeReady, setClaudeReady] = useState(false);

  // composer settings — boot from the saved default (settings.chatModel).
  // The model the user last picked in the composer IS their default; persisted
  // so codex / opus / whatever sticks across panes + restarts.
  const [model, setModel] = useState<ChatModel>(() => {
    // Resuming a prior chat: honor its saved model/engine FIRST so a codex thread
    // doesn't boot on claude (which would mis-route --resume to the wrong binary).
    if (resume?.model || resume?.engine) {
      // resolveChatModel covers BOTH the CLI catalog AND BYO-key API providers, so
      // a resumed API chat (e.g. openrouter/deepseek) keeps its model instead of
      // reverting to a CLI default (which would also mis-route the turn).
      const m = resolveChatModel(resume.model, resume.engine);
      if (m) return m;
    }
    // base = explicit prop → else the user's chosen-provider base (NOT a
    // hardcoded codex default; see baseModelId / PLAN §13). A stale saved id
    // falls back to the provider's own first model, never CHAT_MODELS[0]
    // (which is codex) — a claude user must not silently boot into codex.
    const s = loadSettings();
    // Sticky API default: if the last pick was a BYO-key provider, boot a new chat
    // on that model (resolveChatModel handles the API catalog; the CLI helpers
    // below only run for CLI providers).
    if (isApiProviderId(s.chatProvider)) {
      const apiM = resolveChatModel(s.chatModel, s.chatProvider);
      if (apiM) return apiM;
    }
    const preferred = modelId ?? baseModelId(s.chatProvider, s.chatModel);
    return (
      CHAT_MODELS.find((m) => m.id === preferred) ??
      CHAT_MODELS.find((m) => m.id === baseModelId(s.chatProvider, null)) ??
      CHAT_MODELS[0]
    );
  });
  // Whether this chat runs on a BYO-key API provider (vs a CLI engine). Declared
  // HERE — right after `model` — because it's read far up in the render (the
  // composer's compact-context chip) as well as down in the branching memos; a
  // late `const` would TDZ-crash the whole pane (a composer subtree is built
  // before the old declaration site). Pure derivation, safe to hoist.
  const isApiChat = isApiProviderId(model.engine);
  // detect installed engine CLIs → gray out models whose engine isn't present
  // (so a user can't pick a CLI they don't have). null = not yet probed.
  const [availEngines, setAvailEngines] = useState<Set<string> | null>(null);
  useEffect(() => {
    let alive = true;
    detectAvailableEngines().then((s) => {
      if (alive) setAvailEngines(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  // Only gray when detection actually returned something; null/empty = unknown
  // (off-Tauri / failed) → don't disable anything.
  // re-render the pickers when the launch-time catalog sweep lands (new models
  // become pickable without an app update — see model_catalog.rs).
  const [catalogRev, bumpCatalogRev] = useReducer((x: number) => x + 1, 0);
  useEffect(() => subscribeModelCatalog(bumpCatalogRev), []);
  const pickerModels = useMemo<ChatModel[]>(() => {
    // CLI claude picker gains the LIVE anthropic lineup (the CLI takes full
    // model ids via --model): current-generation ids not already curated,
    // capped so the menu stays a menu. Legacy families are filtered out —
    // "new models show up" shouldn't mean "museum catalog".
    void catalogRev;
    const dynClaude: ChatModel[] = dynamicModelsFor("anthropic")
      .filter(
        (m) =>
          !CHAT_MODELS.some((c) => c.id === m.id) &&
          !/^claude-(instant|[123])/.test(m.id),
      )
      .slice(0, 8)
      .map((m) => ({ id: m.id, label: m.label.toLowerCase(), engine: "claude" }));
    const base = [...CHAT_MODELS, ...dynClaude];
    if (!availEngines || availEngines.size === 0) return base;
    // "not installed" alone was a dead end (audit: disabled rows never said
    // WHY) — the tooltip now names the missing CLI + the one-liner to get it.
    const hint: Record<string, string> = {
      claude: "not installed — needs the claude CLI: npm i -g @anthropic-ai/claude-code",
      codex: "not installed — needs the codex CLI: npm i -g @openai/codex",
      opencode: "not installed — needs the opencode CLI: npm i -g opencode-ai",
    };
    return base.map((m) =>
      m.disabled || availEngines.has(m.engine ?? "claude")
        ? m
        : { ...m, disabled: true, note: m.note ?? hint[m.engine ?? "claude"] ?? "not installed" },
    );
  }, [availEngines, catalogRev]);

  // BYO-key API tier (Tier 4): which providers have a key configured (keychain or
  // env). Drives which API models the picker offers — ollama (keyless) always shows.
  const [configuredApi, setConfiguredApi] = useState<Set<string>>(new Set());
  useEffect(() => {
    let alive = true;
    listConfiguredProviders().then((s) => {
      if (alive) setConfiguredApi(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  // The API catalog as picker rows (id = native model id, engine = provider id →
  // chat_start maps it to the API engine). Never disabled (gated on configured).
  // catalogRev: availableApiModels reads the live-catalog overlay internally.
  const apiModels = useMemo<ChatModel[]>(
    () =>
      availableApiModels(configuredApi).map((q) => ({
        id: q.model.id,
        label: q.model.label,
        engine: q.providerId,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configuredApi, catalogRev],
  );
  // Resolve a raw engine model id (as it rode on an assistant event's
  // `message.model`) to a friendly label for the turn-frame header. Covers the
  // CLI catalog + live anthropic lineup + configured API models; the current
  // composer model is folded in too (a just-picked model may not be in a picker
  // yet). Falls back to a de-slugged id so an unknown model still reads cleanly.
  const modelLabelFor = useCallback(
    (id: string): string => {
      if (!id) return model.label;
      const hit =
        pickerModels.find((m) => m.id === id) ??
        apiModels.find((m) => m.id === id) ??
        (model.id === id ? model : undefined);
      if (hit) return hit.label;
      // "claude-sonnet-5" → "claude sonnet 5"; keep it lowercase (the header
      // uppercases it) and drop a date-stamp suffix if present.
      return id.replace(/-\d{8}$/, "").replace(/[-_]/g, " ");
    },
    [pickerModels, apiModels, model],
  );

  // The "retry with ▾" menu list: installed CLI models + the configured API models
  // (so it isn't just the static CLI catalog — the reported "can't see the models"
  // was partly the menu omitting API models too). CLI entries are limited to the
  // CURRENT engine family: retry resumes this conversation's id, and a claude
  // uuid handed to codex (or vice versa) can't resolve — the "retry" silently
  // became a contextless new session. API-tier targets stay allowed for every
  // engine: they rebuild context from OUR durable store, not the CLI's.
  // model visibility + recency (model menu M1+M3): hiddenModels drops a model
  // from EVERY picker (this menu + retry menus); recentModels feeds the menu's
  // short-by-default "recent" group. Both persisted in settings.
  const [hiddenModels, setHiddenModels] = useState<string[]>(() => loadSettings().hiddenModels);
  const [recentModels, setRecentModels] = useState<string[]>(() => loadSettings().recentModels);
  const toggleHiddenModel = useCallback((key: string, hide: boolean) => {
    setHiddenModels((prev) => {
      const next = hide ? [...new Set([...prev, key])] : prev.filter((k) => k !== key);
      saveSettings({ hiddenModels: next });
      return next;
    });
  }, []);
  const pushRecentModel = useCallback((key: string) => {
    setRecentModels((prev) => {
      const next = [key, ...prev.filter((k) => k !== key)].slice(0, 6);
      saveSettings({ recentModels: next });
      return next;
    });
  }, []);
  const hiddenModelSet = useMemo(() => new Set(hiddenModels), [hiddenModels]);

  const retryMenuModels = useMemo<ChatModel[]>(() => {
    const curEngine = model.engine ?? "claude";
    const cli = pickerModels.filter(
      (m) => !m.disabled && (m.engine ?? "claude") === curEngine,
    );
    return [...cli, ...apiModels].filter((m) => !hiddenModelSet.has(modelKey(m)));
  }, [pickerModels, apiModels, model.engine, hiddenModelSet]);

  // Sticky controls: seed from the last-picked values (settings) so the composer
  // pills persist across panes + restarts, like the model does. null/unknown →
  // the built-in default.
  const [permission, setPermission] = useState(
    () => PERMISSION_MODES.find((p) => p.id === loadSettings().chatAccess) ?? PERMISSION_MODES[0],
  );
  const [effort, setEffort] = useState<(typeof EFFORTS)[number]>(
    () => EFFORTS.find((e) => e.id === loadSettings().chatEffort) ?? EFFORTS[1],
  );
  const [contextBudget, setContextBudget] = useState<ContextBudgetMode>(() => {
    const saved = loadSettings().chatContextBudget;
    return CONTEXT_BUDGETS.some((b) => b.id === saved) ? (saved as ContextBudgetMode) : "agent";
  });
  const effectiveBudget: ContextBudgetMode =
    contextBudget === "ultracode" || effort.ultra ? "ultracode" : contextBudget;
  // running context size (prompt tokens of the latest turn) → composer indicator
  const [ctxTokens, setCtxTokens] = useState<number | null>(null);
  const activeModelRef = useRef(model);
  useEffect(() => {
    activeModelRef.current = model;
  }, [model.id, model.engine]);
  // one interactive-tool hold (AskUserQuestion/ExitPlanMode) per turn — reset on
  // each result + each fresh dispatch (see the hold block in handleEvent).
  const holdSentRef = useRef(false);
  // true once this engine's assistant events carried per-call usage (claude
  // does) — the ctx readout then ignores the result event's summed usage.
  const sawCallUsageRef = useRef(false);
  // per-turn 5h-window burn: last tick's pct + a rolling window of positive
  // deltas → the "≈N%/turn" readout in the composer stats row.
  const lastUsagePctRef = useRef<number | null>(null);
  const turnBurnRef = useRef<number[]>([]);
  const [turnBurnPct, setTurnBurnPct] = useState<number | null>(null);

  // Live usage still flows to the parent (the pet + the sidebar usage panel) via
  // onPetUsage in the `usage` event handler below; the composer no longer paints
  // its own strip — the sidebar reading is the canonical one.
  // cumulative $ spent this chat session (summed across result events).

  // ── message queue / steering (Phase 2) ─────────────────────────────────────
  // Type-ahead while a turn is in flight: submitting queues the message instead
  // of dropping it; queued messages fire one-by-one as each turn completes
  // (codex-style). Held in a ref too so the flush effect reads the latest list.
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const [queuedIdx, setQueuedIdx] = useState(0);
  const [editingQueuedId, setEditingQueuedId] = useState<string | null>(null);
  const [editingQueuedText, setEditingQueuedText] = useState("");
  const queuedRef = useRef<QueuedMessage[]>([]);
  queuedRef.current = queued;

  // mode chips
  const [planMode, setPlanMode] = useState(false);
  const [goal, setGoal] = useState<string>(initialGoal ?? "");
  // inline /goal editor (replaces the off-brand native window.prompt). null = closed.
  const [goalDraft, setGoalDraft] = useState<string | null>(null);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);
  const [handoffPanelOpen, setHandoffPanelOpen] = useState(false);
  // How a handoff is delivered: generated into THIS chat, or written to a file.
  const [handoffDelivery, setHandoffDelivery] = useState<HandoffDelivery>("chat");
  // transient "copied ✓" flash on a handoff row's copy button (by model key).
  const [handoffCopied, setHandoffCopied] = useState<string | null>(null);
  const [memoryHits, setMemoryHits] = useState<MemoryHit[]>([]);
  const [attachedMemoryIds, setAttachedMemoryIds] = useState<string[]>([]);
  const attachedMemories = useMemo(
    () => attachedMemoryIds
      .map((id) => memoryHits.find((hit) => hit.id === id))
      .filter((hit): hit is MemoryHit => Boolean(hit)),
    [attachedMemoryIds, memoryHits],
  );

  useEffect(() => {
    if (!memoryPanelOpen) {
      setMemoryHits([]);
      return;
    }
    const q = input.trim();
    if (q.length < 2) {
      setMemoryHits([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      memorySearch(q, cwd ?? null, 5)
        .then((hits) => {
          if (cancelled) return;
          setMemoryHits(hits);
          setAttachedMemoryIds((ids) => ids.filter((id) => hits.some((h) => h.id === id)));
        })
        .catch(() => {
          if (!cancelled) setMemoryHits([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [input, cwd, memoryPanelOpen]);

  // open-dropdown tracking (single source so only one is open)
  const [openMenu, setOpenMenu] = useState<null | "model" | "perm" | "effort" | "advanced" | "context" | "cwd">(
    null,
  );

  // per-model rate windows for the picker rows (claude's sonnet/opus weekly
  // carve-outs, codex spark) — refreshed when the menu opens. Both commands
  // are 60s-cached backend-side, so opening the menu repeatedly is free.
  const [pickerWindows, setPickerWindows] = useState<PickerWindows>({ claude: {}, codex: {} });
  useEffect(() => {
    if (openMenu !== "model") return;
    let alive = true;
    void Promise.allSettled([claudeRate(), codexRate()]).then(([c, x]) => {
      if (!alive) return;
      setPickerWindows({
        claude: c.status === "fulfilled" ? c.value.models : {},
        codex: x.status === "fulfilled" ? x.value.models : {},
      });
    });
    return () => {
      alive = false;
    };
  }, [openMenu]);

  // overlay popovers anchored to the composer (slash menu / @-files / resume)
  const [overlay, setOverlay] = useState<null | "slash" | "mention" | "resume">(
    null,
  );
  const [overlayIdx, setOverlayIdx] = useState(0);
  const [mentionItems, setMentionItems] = useState<DirEntry[]>([]);
  const [mentionQuery, setMentionQuery] = useState("");

  // /resume picker: past chat sessions, a typed filter, and a loading flag
  const [resumeSessions, setResumeSessions] = useState<ChatSessionInfo[]>([]);
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeQuery, setResumeQuery] = useState("");
  const resumeSearchRef = useRef<HTMLInputElement>(null);

  // the claude session id to resume on (re)start; null = fresh conversation.
  // set by the /resume picker, cleared by a fresh chat / /clear. Seeded from
  // the `resume` prop so the idle "continue" rail lands straight in a session.
  const [resumeId, setResumeId] = useState<string | null>(resume?.id ?? null);
  // the title of the resumed session, shown as a note once after resuming
  const [resumedTitle, setResumedTitle] = useState<string | null>(resume?.title ?? null);
  // best-known human label for THIS chat, mirrored into a ref so the stable-deps
  // handleEvent closure can name it in a notification without going stale.
  const chatTitleRef = useRef<string>("");
  chatTitleRef.current = agentLabel ?? resumedTitle ?? "";
  // reactive mirror of claudeSessionIdRef — the engine session id currently open
  // in THIS pane, so the /resume picker can highlight "the one you're in".
  const [openSessionId, setOpenSessionId] = useState<string | null>(resume?.id ?? null);

  const sessionIdRef = useRef<number | null>(null);
  const webAbortRef = useRef<AbortController | null>(null);
  // live mirror of `streaming` for the close-handle closure (a turn in flight).
  const activeRunRef = useRef(false);
  activeRunRef.current = streaming || backendBusy;
  // set true when the pane is intentionally detached (kept running) — tells the
  // unmount cleanup NOT to kill the claude process.
  const detachedRef = useRef(false);
  // live mirror of "this chat is out of sight" for the (stable-deps) handleEvent
  // closure — so a tool-approval landing on a minimized OR detached pane can fire
  // a notification without re-creating handleEvent. Declared AFTER detachedRef so
  // it can read it (no TDZ).
  const hiddenRef = useRef(false);
  hiddenRef.current = (hidden ?? false) || detachedRef.current;
  // the `reattach` id whose background session this pane is currently bound to
  // AND whose engine/model we auto-synced into `model` state. While set, a
  // session-effect re-fire CAUSED by that auto-resync is a no-op (don't
  // re-replay the buffer or kill the externally-owned session). A MANUAL model
  // switch clears it (see below) so the pane re-spins on the new engine.
  const reattachBoundRef = useRef<number | null>(null);
  // armed right before the resync setModel; the very next session-effect cleanup
  // consumes it to SKIP teardown (that re-run is the benign resync, not a real
  // model change or unmount). Closure-independent, so no stale-model.id race.
  const skipResyncTeardownRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── snippet context: select reply text → attach it as a one-shot context ──
  // Each snippet rides the NEXT send as its own [context snippet] block (an
  // explicit user attachment — not per-turn auto-injection, per guardrail 3).
  const [snippets, setSnippets] = useState<{ id: string; text: string }[]>([]);
  const snippetsRef = useRef(snippets);
  snippetsRef.current = snippets;
  const [snipTip, setSnipTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const onTranscriptMouseUp = useCallback(() => {
    // rAF: the selection finalizes after mouseup.
    requestAnimationFrame(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      const root = scrollRef.current;
      if (!sel || sel.isCollapsed || text.length < 4 || !root) {
        setSnipTip(null);
        return;
      }
      const { anchorNode, focusNode } = sel;
      if (!anchorNode || !focusNode || !root.contains(anchorNode) || !root.contains(focusNode)) {
        setSnipTip(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const host = root.getBoundingClientRect();
      setSnipTip({
        x: Math.min(Math.max(rect.left - host.left + rect.width / 2, 70), host.width - 70),
        y: rect.top - host.top + root.scrollTop,
        text: text.slice(0, 4000),
      });
    });
  }, []);
  // the tip follows the selection's life: collapse anywhere → gone.
  useEffect(() => {
    if (!snipTip) return;
    const onSel = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed) setSnipTip(null);
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [snipTip]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  // index into `turns` of the assistant bubble currently being streamed
  const streamingTurnId = useRef<string | null>(null);
  // id of the thinking block currently being streamed (own block, precedes text)
  const thinkingTurnId = useRef<string | null>(null);
  // last user prompt text actually sent to claude (for regenerate)
  const lastSentRef = useRef<string | null>(null);
  // true between a user stop() and the backend's synthetic stop result — used
  // to keep an intentional stop from rendering as a failure card.
  const stoppingRef = useRef(false);
  const stopChatRef = useRef<() => void>(() => {});
  // ── composer autocomplete (copilot-style) ──────────────────────────────────
  // Past sent messages, newest first — the source for inline ghost completion.
  // Persisted across sessions so the suggestions are useful from the first keypress.
  const HISTORY_KEY = "osai.chat.history";
  const historyRef = useRef<string[]>([]);
  useEffect(() => {
    try {
      const h = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
      if (Array.isArray(h)) historyRef.current = h.filter((x) => typeof x === "string");
    } catch {
      /* ignore */
    }
  }, []);

  // ── chat-session recording (for the /resume list) ─────────────────────────
  // This conversation's PERMANENT identity: the store id when resuming (claude's
  // --resume forks a fresh session_id every restart — the fork is tracked as a
  // resume POINTER on the store entry by the backend, never adopted as identity,
  // else one conversation fragments into a new history entry per reopen), or
  // the first init's session_id for a fresh chat.
  const claudeSessionIdRef = useRef<string | null>(resume?.id ?? null);
  // true once we've recorded this chat (on the first user send of the session),
  // so subsequent sends don't re-upsert. A pane mounted on an EXISTING
  // conversation (resume prop) starts true — it's already in the list, and
  // re-recording on the next send used to RENAME the session to whatever you
  // typed next. Reset on /clear and set by the /resume picker.
  const recordedRef = useRef(Boolean(resume?.id));
  // A first-turn record that couldn't run because the engine session id hadn't
  // arrived yet: a send proceeds the moment the BACKEND session id is known
  // (chat_start resolves), which is BEFORE claude emits its `init` (the source of
  // claudeSessionIdRef). Sending in that window left the chat unrecorded — only
  // ever surfaced later by History's self-heal, with an auto-title that can't be
  // renamed durably. Stashed here on send, flushed by the init effect below.
  const pendingFirstRecordRef = useRef<{
    title: string;
    engine: string;
    model: string;
  } | null>(null);
  // Codex openers are often just "hi". Keep its title promotable until the
  // first meaningful prompt lands, then leave the topic stable.
  const codexTitleLockedRef = useRef(Boolean(resume));
  // true once the launcher seed has been auto-sent as the first turn, so it
  // fires exactly once and never re-fires on /clear or a session restart.
  const seedSentRef = useRef(false);

  // ── turn timing (for the Codex-style "Worked for Xs" activity line) ────────
  // wall-clock ms when the in-flight turn began; null when idle. Drives the live
  // "Working… 0:42" timer and is the fallback duration if claude's result event
  // doesn't carry one.
  const turnStartRef = useRef<number | null>(null);
  const [liveStart, setLiveStart] = useState<number | null>(null);
  // 1Hz tick so the running timer re-renders while streaming
  const [now, setNow] = useState(() => Date.now());
  // keep the latest input in a ref so the unmount writer-cleanup never goes stale
  const inputRef = useRef(input);
  inputRef.current = input;

  const empty = turns.length === 0;

  // ── per-turn wall-clock times (unix ms) ────────────────────────────────────
  // Live turns are stamped on arrival; resumed turns are seeded with their REAL
  // transcript times by transcriptToTurns (NaN = file had none — never faked as
  // "now"). Ref'd Map: stable across renders, read at render time for the
  // hover times + day separators.
  const turnTimesRef = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    const m = turnTimesRef.current;
    for (const t of turns) {
      if (!m.has(t.id)) m.set(t.id, Date.now());
    }
  }, [turns]);

  // ── hero resume rail ────────────────────────────────────────────────────────
  // The empty hero offers the last few sessions one click away (the /resume
  // picker stays the full-list path). Fetched once per pane while the hero is
  // up; null = not loaded yet (render nothing, no skeleton — it's optional).
  const [heroSessions, setHeroSessions] = useState<ChatSessionInfo[] | null>(null);
  useEffect(() => {
    if (!empty || heroSessions != null) return;
    let alive = true;
    listChatSessions(8)
      .then((s) => {
        if (alive) setHeroSessions(s);
      })
      .catch(() => {
        if (alive) setHeroSessions([]);
      });
    return () => {
      alive = false;
    };
  }, [empty, heroSessions]);

  // ── voice dictation bridge (P0) ────────────────────────────────────────────
  // App registers each pane's writer here; ⌘J dictation pushes text to the
  // focused pane. For a chat pane we append into the composer instead of a PTY.
  useEffect(() => {
    if (!paneKey) return;
    paneWriters.set(paneKey, (t) =>
      setInput((v) => (v ? v.trimEnd() + " " + t : t)),
    );
    // SUBMIT path ("send to AI" → chat): fire the text straight through the
    // kept-fresh sendText ref so it actually sends (no input-state race). Mirror
    // it into the box first so the user sees what went out.
    paneSubmitters.set(paneKey, (t) => {
      setInput(t);
      sendTextRef.current?.(t);
    });
    return () => {
      paneWriters.delete(paneKey);
      paneSubmitters.delete(paneKey);
    };
  }, [paneKey]);

  // ── auto-focus the composer ────────────────────────────────────────────────
  // Focus the composer textarea when the pane MOUNTS and each time it BECOMES
  // the active pane (false→true transition only — never on every render). Don't
  // steal focus if the user is already typing/selecting in an editable field
  // (e.g. a terminal/editor/composer in another pane): only grab focus when the
  // current focus isn't an interactive input the user is mid-action in. Runs on
  // a rAF so it lands after the pane's layout/visibility settles.
  const wasActiveRef = useRef(false);
  useEffect(() => {
    const isActive = active ?? true; // panes without an active signal focus on mount
    const becameActive = isActive && !wasActiveRef.current;
    wasActiveRef.current = isActive;
    if (!becameActive) return;
    const ta = taRef.current;
    if (!ta) return;
    const raf = requestAnimationFrame(() => {
      // don't yank focus out from under a user mid-action in ANOTHER editable.
      const el = document.activeElement as HTMLElement | null;
      const inThisPane = el ? ta.closest("[data-chat-pane]")?.contains(el) : false;
      const editingElsewhere =
        el != null &&
        !inThisPane &&
        (el.tagName === "INPUT" ||
          el.tagName === "TEXTAREA" ||
          el.isContentEditable ||
          // terminal/browser webviews capture keys via these
          el.tagName === "CANVAS" ||
          el.tagName === "IFRAME" ||
          el.tagName === "WEBVIEW");
      if (editingElsewhere) return;
      ta.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [active]);

  // A path dragged from another pane (Files) → append it to the composer.
  const insertPath = useCallback((path: string) => {
    setInput((v) => (v ? v.trimEnd() + " " + path + " " : path + " "));
    taRef.current?.focus();
  }, []);

  // Deterministic in-chat file open, bound to THIS session's cwd. Provided via
  // context so deep markdown/tool renderers can open files without threading cwd.
  const openChatFile = useCallback<ChatFileOpener>(
    (ref: string) => {
      void openChatFileReference(ref, cwd);
    },
    [cwd],
  );

  // ── image attach: paste a screenshot / pick a file → temp file + thumbnail ──
  const [images, setImages] = useState<ImageChip[]>([]);
  // an attached image opened full-size to confirm/remove before sending.
  const [previewImage, setPreviewImage] = useState<ImageChip | null>(null);
  // Live mirror of `images` so an async send can read the freshest paths after
  // awaiting in-flight saves (the closure-captured `images` would be stale).
  const imagesRef = useRef<ImageChip[]>([]);
  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  // In-flight disk-save promises, keyed by chip id. send() awaits these so a
  // fast paste→Enter can't ship the turn before the image finishes saving.
  const pendingSavesRef = useRef<Map<string, Promise<void>>>(new Map());
  const imgInputRef = useRef<HTMLInputElement>(null);
  const addImage = useCallback(async (file: Blob, mime: string) => {
    const id = `img${++_imgSeq}`;
    const url = URL.createObjectURL(file);
    setImages((prev) => [...prev, { id, url, path: null }]);
    const save = (async () => {
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        const path = await saveImageTemp(btoa(bin), extFromMime(mime));
        setImages((prev) => prev.map((im) => (im.id === id ? { ...im, path } : im)));
      } catch {
        // surface the failure instead of vanishing the thumbnail silently —
        // otherwise the user thinks the image attached when it didn't.
        setImages((prev) => {
          const gone = prev.find((im) => im.id === id);
          if (gone) URL.revokeObjectURL(gone.url);
          return prev.filter((im) => im.id !== id);
        });
        setTurns((prev) => [
          ...prev,
          { kind: "result", id: uid(), text: "couldn't attach that image (unsupported format or save failed) — not sent.", ok: false },
        ]);
      } finally {
        pendingSavesRef.current.delete(id);
      }
    })();
    pendingSavesRef.current.set(id, save);
    await save;
  }, []);
  const removeImage = useCallback((id: string) => {
    setImages((prev) => {
      const gone = prev.find((im) => im.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return prev.filter((im) => im.id !== id);
    });
  }, []);

  // Attach an image that already lives on disk (an OS file drop from Finder /
  // the desktop). Tauri's native drag-drop hands us a path, not a Blob, so we
  // skip the saveImageTemp round-trip: the chip's thumbnail renders straight off
  // the asset-protocol URL, and `path` is set immediately (already on disk).
  const addImageByPath = useCallback((path: string) => {
    const id = `img${++_imgSeq}`;
    setImages((prev) => [...prev, { id, url: fileSrc(path), path }]);
  }, []);

  // Register this chat pane's IMAGE-drop sink so App's native OS drag-drop
  // handler routes dropped image files here as thumbnail chips (instead of
  // appending their raw paths as text via paneWriters). Non-image drops still
  // fall through to the path-insert writer.
  useEffect(() => {
    if (!paneKey) return;
    paneImageDrop.set(paneKey, (paths) => {
      for (const p of paths) addImageByPath(p);
    });
    return () => {
      paneImageDrop.delete(paneKey);
    };
  }, [paneKey, addImageByPath]);
  // paste an image off the clipboard → thumbnail chip (temp file saved in bg)
  const onPasteImage = useCallback(
    (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.kind === "file" && it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            e.preventDefault();
            void addImage(file, it.type);
            return;
          }
        }
      }
    },
    [addImage],
  );
  // dropped files (a screenshot dragged from Finder / desktop) → attach any
  // image as a thumbnail chip. Returns true if it consumed ≥1 image, so the
  // drop zone skips inserting a bare path for those.
  const onDropFiles = useCallback(
    (files: FileList): boolean => {
      let took = false;
      for (const f of Array.from(files)) {
        if (f.type.startsWith("image/")) {
          void addImage(f, f.type);
          took = true;
        }
      }
      return took;
    },
    [addImage],
  );
  // ── voice dictation: click mic → inline waveform + timer → transcript ───────
  // Ported from TerminalComposer (the polished one). Records via lib/voice, swaps
  // the textarea for a live equalizer while recording, drops the transcript into
  // the box on stop. Esc cancels.
  type VoicePhase = "idle" | "recording" | "transcribing";
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  // Transient dictation problem (mic denied, whisper unreachable, transcribe
  // failed) — rendered as one strip in the composer; mic failures must never
  // be silent. Auto-clears.
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  useEffect(() => {
    if (!voiceNote) return;
    const t = setTimeout(() => setVoiceNote(null), 8000);
    return () => clearTimeout(t);
  }, [voiceNote]);
  const [voiceElapsed, setVoiceElapsed] = useState(0);
  const voicePhaseRef = useRef<VoicePhase>("idle");
  voicePhaseRef.current = voicePhase;
  useEffect(() => {
    if (voicePhase !== "recording") return;
    setVoiceElapsed(0);
    const base = Date.now();
    const t = setInterval(
      () => setVoiceElapsed(Math.floor((Date.now() - base) / 1000)),
      250,
    );
    return () => clearInterval(t);
  }, [voicePhase]);
  const micStart = useCallback(async () => {
    if (voicePhaseRef.current !== "idle") return;
    try {
      setVoiceNote(null);
      await dictateStart();
      setVoicePhase("recording");
    } catch (e) {
      // pre-flight/mic failures were silently swallowed here — the mic just
      // didn't arm with no explanation. Name the problem (incl. the whisper
      // endpoint pre-flight from lib/voice.ts).
      setVoiceNote(String((e as Error)?.message ?? e));
      setVoicePhase("idle");
    }
  }, []);
  const micStop = useCallback(async () => {
    if (voicePhaseRef.current !== "recording") return;
    setVoicePhase("transcribing");
    try {
      const text = await dictateStop();
      if (text) {
        setInput((v) => (v ? v.trimEnd() + " " + text : text));
      }
    } catch (e) {
      setVoiceNote(String((e as Error)?.message ?? e));
    } finally {
      setVoicePhase("idle");
      taRef.current?.focus();
    }
  }, []);
  const micCancel = useCallback(async () => {
    if (voicePhaseRef.current !== "recording") return;
    setVoicePhase("idle");
    try {
      await dictateCancel();
    } catch {
      /* best-effort */
    }
  }, []);
  const recording = voicePhase === "recording";
  // Esc cancels an in-progress recording (the textarea is swapped out then, so a
  // window listener catches it).
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        void micCancel();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, micCancel]);

  // ── event ingestion ───────────────────────────────────────────────────────

  const handleEvent = useCallback((ev: ChatEvent) => {
    setRunEventState((state) => reduceRunEvents(state, ev));
    // ---- background sub-agent lifecycle ---------------------------------------
    // run_in_background Task agents keep working AFTER the main turn closes; the
    // engine narrates them via `system/task_*` events (no turn to render). Track
    // the live set so the pane/tab can show "still running in the background" even
    // though `streaming` is false. task_started/progress upsert; the completion
    // notification (status completed/failed/cancelled) drops the task.
    if (ev.type === "system") {
      const st = ev.subtype;
      if (st === "task_started" || st === "task_progress") {
        const tid = typeof ev.task_id === "string" ? ev.task_id : "";
        if (tid) {
          const desc = typeof ev.description === "string" ? ev.description : "";
          const sub = typeof ev.subagent_type === "string" ? ev.subagent_type : undefined;
          // the spawning Agent tool_use id — links this live task to its turn in
          // the transcript (exact, provided by the CLI) so the dock card can pull
          // the agent's nested steps + fold it back into the transcript on finish.
          const tuid = typeof ev.tool_use_id === "string" ? ev.tool_use_id : undefined;
          setBgTasks((prev) => {
            const i = prev.findIndex((t) => t.id === tid);
            if (i < 0) {
              return [
                ...prev,
                {
                  id: tid,
                  toolUseId: tuid,
                  description: desc || "background agent",
                  subagentType: sub,
                  lastLine: st === "task_progress" ? desc || undefined : undefined,
                },
              ];
            }
            const next = [...prev];
            next[i] = {
              ...next[i],
              toolUseId: next[i].toolUseId ?? tuid,
              description: next[i].description || desc || "background agent",
              subagentType: next[i].subagentType ?? sub,
              lastLine: st === "task_progress" && desc ? desc : next[i].lastLine,
            };
            return next;
          });
        }
        return;
      }
      if (st === "task_notification" || st === "task_updated") {
        const tid = typeof ev.task_id === "string" ? ev.task_id : "";
        const patch = (ev.patch ?? {}) as { status?: unknown };
        const status = String(ev.status ?? patch.status ?? "").toLowerCase();
        const done =
          status === "completed" ||
          status === "failed" ||
          status === "cancelled" ||
          status === "canceled";
        if (tid && done) setBgTasks((prev) => prev.filter((t) => t.id !== tid));
        return;
      }
    }
    // ---- interactive-tool hold (AskUserQuestion / ExitPlanMode) --------------
    // Headless claude auto-dismisses both tools the instant they're called, and
    // the model reads that as "the user isn't answering" — it then proceeds on
    // assumptions before the card is even clickable. The moment the tool_use
    // arrives, soft-steer a SILENT hold into the running turn telling the model
    // the user is answering in our UI. One hold per turn; sub-agent calls
    // (parent_tool_use_id) are excluded — their asks aren't interactive here.
    // ---- context readout source of truth --------------------------------------
    // Each MAIN-agent assistant event carries its own API call's usage — in +
    // cache read/write = the prompt the model actually saw on that call. The
    // result event's usage SUMS every call in the turn (a 10-step turn re-reads
    // the context 10×), which is what made the old readout claim "492% ctx".
    // Sub-agent events are excluded (their context isn't this pane's context).
    if (ev.type === "assistant" && typeof ev.parent_tool_use_id !== "string") {
      const ctx = contextFromUsage(
        (ev.message as { usage?: unknown } | undefined)?.usage,
      );
      if (ctx > 0) {
        sawCallUsageRef.current = true;
        setCtxTokens(ctx);
      }
    }
    if (
      ev.type === "assistant" &&
      typeof ev.parent_tool_use_id !== "string" &&
      (activeModelRef.current.engine ?? "claude") === "claude"
    ) {
      const blocks = Array.isArray(ev.message?.content) ? ev.message.content : [];
      const askUse = blocks.some((b) => b?.type === "tool_use" && b.name === "AskUserQuestion");
      const planUse = blocks.some((b) => b?.type === "tool_use" && b.name === "ExitPlanMode");
      if ((askUse || planUse) && !holdSentRef.current) {
        const sid = sessionIdRef.current;
        if (sid != null) {
          holdSentRef.current = true;
          chatSteer(sid, planUse ? HOLD_PLAN : HOLD_ASK, true).catch(() => {
            holdSentRef.current = false;
          });
        }
        // A question/plan the user can't see is a stall, not a prompt: if this
        // chat is out of sight, raise the same clickable needs-input alert the
        // approval card gets, deep-linking back to the pane.
        const backendId = sessionIdRef.current;
        if (hiddenRef.current && backendId != null && backendId > 0) {
          pushNotification({
            kind: "chat.needs_input",
            level: "warning",
            priority: "high",
            sourceLabel: "chat",
            title: planUse ? "plan awaiting your review" : "chat has questions for you",
            body: `${chatTitleRef.current || "a background chat"} is waiting on your ${planUse ? "plan decision" : "answers"}.`,
            target: { type: "chat", sessionId: backendId, title: chatTitleRef.current || "chat" },
          });
        }
      }
    }
    // ---- control protocol: tool approval requests + acks --------------------
    // claude → us, non-bypass modes: a `control_request` whose request.subtype
    // is `can_use_tool`. We surface an inline approval card; the reply goes back
    // via chatSendRaw (see resolveApproval). `control_response` here is just
    // claude's ack of OUR interrupt — nothing to render.
    if (ev.type === "control_request") {
      const sub = ev.request?.subtype;
      if (sub === "can_use_tool") {
        const reqId = ev.request_id ?? uid();
        const toolName =
          ev.request?.tool_name ?? ev.request?.tool ?? "tool";
        const inp = (ev.request?.input as Record<string, unknown>) ?? {};
        setTurns((prev) => {
          if (prev.some((t) => t.kind === "approval" && t.requestId === reqId)) {
            return prev;
          }
          return [
            ...prev,
            {
              kind: "approval",
              id: uid(),
              requestId: reqId,
              toolName: String(toolName),
              input: inp,
            },
          ];
        });
        // If this chat is OUT OF SIGHT (minimized or detached), the user has no idea
        // it's blocked waiting on him. Fire a high-priority, clickable notification
        // that reattaches to the approval card. Foreground chats stay silent — the
        // inline card is already visible. De-dupe is handled by the store (one live
        // needs_input per session). Skipped when the backend id isn't known yet.
        const sid = sessionIdRef.current;
        if (hiddenRef.current && sid != null && sid > 0) {
          pushNotification({
            kind: "chat.needs_input",
            level: "warning",
            priority: "high",
            sourceLabel: "chat",
            title: "chat needs your input",
            body: `${chatTitleRef.current || "a background chat"} is waiting to run ${String(toolName)}.`,
            target: { type: "chat", sessionId: sid, title: chatTitleRef.current || "chat" },
          });
        }
      }
      return;
    }
    if (ev.type === "control_response") {
      // ack of our interrupt; nothing to display.
      return;
    }

    // ---- compaction (P2) ----------------------------------------------------
    // claude emits a `system`/`compact_boundary` (token metadata) then a synthetic
    // "continued from a previous conversation" user message (the summary). Render
    // a collapsible segment card; neither goes through the turn reducer below.
    const comp = detectCompaction(ev);
    if (comp) {
      setTurns((prev) => [
        ...prev,
        { kind: "compaction", id: uid(), createdAt: Date.now(), ...comp },
      ]);
      return;
    }
    const compSummary = compactionSummary(ev);
    if (compSummary) {
      setTurns((prev) => {
        for (let i = prev.length - 1; i >= 0; i--) {
          if (prev[i].kind === "compaction") {
            const next = [...prev];
            next[i] = { ...next[i], summary: compSummary } as Turn;
            return next;
          }
        }
        return prev;
      });
      return;
    }
    // drop other synthetic / replay user plumbing (e.g. "<local-command-stdout>")
    // so it never renders as a bogus user bubble.
    if (
      ev.type === "user" &&
      ((ev as { isSynthetic?: boolean }).isSynthetic ||
        (ev as { isReplay?: boolean }).isReplay)
    ) {
      return;
    }

    const reduced = (() => {
      let handled = false;
      setTurns((prev) => {
        const result = reduceChatStreamEvent(
          {
            turns: prev,
            streamingTurnId: streamingTurnId.current,
            thinkingTurnId: thinkingTurnId.current,
          },
          ev,
          { now: Date.now(), uid },
        );
        if (!result.handled) return prev;
        handled = true;
        streamingTurnId.current = result.state.streamingTurnId;
        thinkingTurnId.current = result.state.thinkingTurnId;
        return result.state.turns;
      });
      return handled;
    })();
    if (reduced) return;

    switch (ev.type) {
      // final result for the turn → faint footer + close the streaming bubble
      case "result": {
        setTurns((prev) => {
          const finalized = finalizeStreamingTurns(
            {
              turns: prev,
              streamingTurnId: streamingTurnId.current,
              thinkingTurnId: thinkingTurnId.current,
            },
            Date.now(),
          );
          return finalized.turns;
        });
        streamingTurnId.current = null;
        thinkingTurnId.current = null;
        setStreaming(false);
        setBackendBusy(false);
        // turn closed → the next AskUserQuestion/ExitPlanMode may hold again.
        holdSentRef.current = false;
        // prefer claude's reported duration; fall back to our wall-clock measure
        const wall =
          turnStartRef.current != null ? Date.now() - turnStartRef.current : undefined;
        const durationMs =
          typeof ev.duration_ms === "number" ? ev.duration_ms : wall;
        turnStartRef.current = null;
        setLiveStart(null);
        const dur = durationMs != null ? fmtDuration(durationMs) : "";
        const costNum =
          typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : undefined;
        // per-turn footer = OUTPUT tokens (what the model wrote). The full
        // in+cache sum re-counts the context once per step, so a tool-heavy
        // turn read as millions of "tok" — total volume stays in the tooltip
        // via the session aggregate instead.
        const tokens = outputTokensFromUsage(ev.usage) ?? tokensFromUsage(ev.usage);
        const tokStr =
          tokens != null ? `${tokens.toLocaleString()} tok` : "";
        // context-size fallback for engines whose assistant events carry no
        // per-call usage (codex/API adapters emit one call per turn, so their
        // result usage IS the context). claude's per-call source is the
        // assistant-event block above.
        if (!sawCallUsageRef.current) {
          const ctx = contextFromUsage(ev.usage);
          if (ctx > 0) setCtxTokens(ctx);
        }
        // synthesized engine failures carry their message in ev.text; claude
        // passthrough ERRORS carry it in ev.result. On SUCCESS ev.result holds
        // the full assistant reply — reading it unconditionally duplicated the
        // whole message into the footer (user-reported), so error-only.
        const resultText =
          typeof ev.text === "string" && ev.text.trim()
            ? ev.text.trim()
            : Boolean(ev.is_error) && typeof ev.result === "string"
              ? ev.result.trim()
              : "";
        // a user-initiated stop fans out a synthetic is_error result — stop()
        // already posted its calm "stopped by user" note; don't double up with
        // a contradictory red failure card.
        if (stoppingRef.current && Boolean(ev.is_error)) {
          stoppingRef.current = false;
          return;
        }
        // cost intentionally omitted — the user runs on subs, $ figures are noise.
        // A lone duration with no tokens + no message is the COMPACTION completion
        // (claude reports no usage for it) — a bare "30s" footer in an otherwise
        // empty OSAI frame reads as broken. Emit an EMPTY footer so the blocks
        // builder drops the result block (no hollow frame); durationMs still rides
        // the turn for the activity line. Mirrors the replay path (chatStream.ts),
        // which already skips these empty-success footers.
        const okEmptyMetric = !Boolean(ev.is_error) && !resultText && !tokStr;
        // generation rate (Odysseus footer signature) — only when the sample is
        // long enough to mean something (sub-400ms turns read as noise).
        const rate =
          tokens != null && durationMs != null && durationMs > 400
            ? `${(tokens / (durationMs / 1000)).toFixed(1)} tok/s`
            : "";
        const foot = okEmptyMetric ? "" : [resultText, dur, tokStr, rate].filter(Boolean).join(" · ");
        // always emit a result turn (carries durationMs for the activity line),
        // even if the human-readable footer would be empty.
        onPetResult({
          tokens,
          durationMs,
          ok: !Boolean(ev.is_error),
        });
        // soundscape (opt-in, default off): a soft cue when the run lands
        playCue(ev.is_error ? "fail" : "done");
        // A turn woken by a background agent finishing carries an `origin`
        // (task-notification). Tag its result so the variant segmenter stacks it
        // as its own segment instead of folding it into the previous prompt's
        // ‹N/M› switcher (which used to HIDE each background completion behind the
        // last one).
        const continuation = ev.origin != null;
        setTurns((prev) => [
          ...prev,
          { kind: "result", id: uid(), text: foot, cost: costNum, tokens, durationMs, ok: !Boolean(ev.is_error), ...(continuation ? { continuation: true } : {}) },
        ]);
        return;
      }

      // surface a backend stderr line (missing binary / not logged in / bad flag)
      case "osai_stderr": {
        if (ev.text) onPetError(ev.text);
        if (ev.text) {
          setTurns((prev) => [
            ...prev,
            { kind: "result", id: uid(), text: ev.text ?? "", ok: false },
          ]);
        }
        turnStartRef.current = null;
        setLiveStart(null);
        setStreaming(false);
        setBackendBusy(false);
        return;
      }

      // live usage tick (synthetic, from chat.rs) → move the composer's usage bar
      case "usage": {
        // Codex's app-server push can describe a model-specific CLI bucket. The
        // desktop usage panel uses /backend-api/wham/usage, so re-read that exact
        // account source instead of letting the push overwrite the visible meter.
        if ((ev.provider ?? "claude") === "codex") {
          const current = activeModelRef.current;
          void codexRate().then((r) => {
            const snap = codexUsageForModel(r, current);
            if (hasUsageData(snap)) {
              onPetUsage({
                provider: "codex",
                pct: snap.fiveHour.pct,
              });
            }
          });
          return;
        }
        const fh = ev.five_hour ?? {};
        const sd = ev.seven_day ?? {};
        onPetUsage({
          provider: ev.provider ?? "claude",
          pct:
            typeof fh.pct === "number"
              ? fh.pct
              : typeof sd.pct === "number"
                ? sd.pct
                : null,
        });
        // per-turn burn: the tick fires right after each turn, so the 5h-window
        // pct delta between ticks ≈ what one turn costs. Rolling average of the
        // last few positive deltas (a window reset drops pct — skip those).
        if (typeof fh.pct === "number") {
          const prev = lastUsagePctRef.current;
          lastUsagePctRef.current = fh.pct;
          if (prev != null && fh.pct > prev) {
            const deltas = turnBurnRef.current;
            deltas.push(fh.pct - prev);
            if (deltas.length > 6) deltas.shift();
            setTurnBurnPct(deltas.reduce((a, b) => a + b, 0) / deltas.length);
          }
        }
        return;
      }

      // system init: not rendered, but carries claude's session_id — capture it
      // so the first user send can recordChatSession() into the /resume list.
      case "system": {
        if (ev.session_id) {
          // Adopt the engine session id as this conversation's identity ONLY
          // when we don't have one yet (a fresh chat / post-/clear restart).
          // A resumed conversation keeps its STORE id: claude's --resume forks
          // a fresh session_id every restart, and the backend records the fork
          // as a resume pointer on the store entry (chat.rs ingest_line) —
          // adopting each fork here is what used to fragment one conversation
          // into a frozen old history entry + a new-turns-only entry per reopen.
          if (claudeSessionIdRef.current == null) {
            claudeSessionIdRef.current = ev.session_id;
            setOpenSessionId(ev.session_id);
            setRunEventsKey(runEventsStorageKey(ev.session_id));
          }
        }
        setClaudeReady(true);
        return;
      }

      // hooks / rate-limit / anything else → ignored in the transcript
      default:
        return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── session lifecycle: one channel + one session per mount ─────────────────
  // `restartKey` lets `/clear` tear down + re-spin the session without changing
  // any of the model/permission deps.
  const [restartKey, setRestartKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    // The resync's setModel re-fired this effect. The previous cleanup already
    // skipped teardown (skipResyncTeardownRef), the session is live + bound — so
    // this run must NOT re-reattach (double buffer replay) nor spawn. No-op.
    // The flag was consumed by the cleanup; here we just detect+skip the body.
    if (reattach != null && reattachBoundRef.current === reattach) {
      // distinguish the benign resync re-run from a real model switch: a real
      // switch went through the cleanup WITHOUT the skip flag, which cleared
      // reattachBoundRef. So if we're still bound here, it's the resync re-run.
      return;
    }
    setStarted(false);
    setClaudeReady(false);
    setCtxTokens(null);
    setBgTasks([]); // a fresh/restarted session has no carried-over background work
    if (webChatRuntime) {
      sessionIdRef.current = 0;
      claudeSessionIdRef.current = `web-${paneKey ?? "chat"}`;
      setRunEventsKey(runEventsStorageKey(claudeSessionIdRef.current));
      setStarted(true);
      setClaudeReady(true);
      return () => {
        webAbortRef.current?.abort();
        webAbortRef.current = null;
        sessionIdRef.current = null;
      };
    }
    const chan = new Channel<string>();
    chan.onmessage = (line) => {
      if (disposed) return;
      let parsed: ChatEvent | null = null;
      try {
        parsed = JSON.parse(line) as ChatEvent;
      } catch {
        return; // ignore non-JSON noise
      }
      handleEvent(parsed);
    };

    // Reattach to a live backgrounded session (replays its buffer) vs spawn fresh.
    // On reattach the backend reports the session's real engine/model so we can
    // re-sync `model` state — otherwise a reattached codex run stays on the
    // default claude state (wrong stop-strategy, steer hidden, wrong usage).
    const spawnFresh = () =>
      chatStart(chan, {
        engine: model.engine ?? "claude",
        cwd: cwd ?? null,
        model: model.disabled ? null : model.id,
        permissionMode: permission.id,
        // ultracode isn't a real --effort value; run it as xhigh (the
        // "+ workflows" half is applied per-message via ULTRA_PREFIX).
        effort: effectiveBudget === "ultracode" ? "xhigh" : effort.id,
        fast: effectiveBudget === "lean",
        resume: resumeId,
      }).then((id) => ({
        id,
        busy: false,
        engine: null as string | null,
        model: null as string | null,
        claudeId: null as string | null,
        title: "",
      }));
    // set when a reattach target turned out to be dead (backend registry is
    // in-memory — every app restart empties it) and we degraded to a fresh
    // session. The reattach-specific bindings below must be skipped then.
    let reattachFellBack = false;
    const startup =
      reattach != null
        ? chatReattach(reattach, chan)
            .then((info) => ({
              id: reattach,
              busy: info.busy,
              engine: info.engine,
              model: info.model,
              claudeId: info.claude_id,
              title: info.title,
            }))
            .catch((err) => {
              // Dead background session (clicked a stale done-notification, or
              // the app restarted). Retrying the same dead id forever was a
              // hard dead end — degrade to a fresh session instead, resuming
              // the conversation when the caller told us which one it was.
              reportDiag("chat.reattach", err, { action: "fallback-fresh" });
              reattachFellBack = true;
              if (!disposed) {
                setStartupNote(
                  resumeId
                    ? "that background run already ended — reopened the conversation from history"
                    : "that background run already ended — started a fresh session",
                );
                // repaint the transcript from the durable store (the mount
                // repaint skips reattach panes — the buffer replay we didn't
                // get was supposed to be the painter).
                if (resumeId) {
                  readChatHistory(resumeId)
                    .then((page) => {
                      if (disposed || !page.lines.length) return;
                      stickRef.current = true;
                      setTurns(replayHistoryToTurns(page.lines, uid));
                    })
                    .catch(() => {});
                }
              }
              return spawnFresh();
            })
        : spawnFresh();

    startup
      .then(({ id, busy, engine: liveEngine, model: liveModel, claudeId, title: liveTitle }) => {
        if (disposed) {
          // only kill a freshly-spawned session we're abandoning; never a reattach.
          if (reattach == null || reattachFellBack) chatStop(id).catch((e) => reportDiag("chat.stop", e, { action: "stop" }));
          return;
        }
        // Reattach: mark this session bound (so the model re-sync below can't
        // re-replay it) and re-sync `model` state to the session's REAL
        // engine/model so stop-strategy, steer visibility, and usage provider
        // all match the engine that's actually running (not default claude).
        if (reattach != null && !reattachFellBack) {
          reattachBoundRef.current = reattach;
          // Adopt the conversation's identity from the backend (the store id —
          // chat.rs pins it across --resume forks). A detached session always
          // had at least one send (that's the only way it got backgrounded), so
          // it's already recorded: without this the next send re-recorded the
          // replayed init's fork id as a brand-new history entry named after
          // whatever you typed next.
          if (claudeId) {
            claudeSessionIdRef.current = claudeId;
            setOpenSessionId(claudeId);
            setRunEventsKey(runEventsStorageKey(claudeId));
            recordedRef.current = true;
            codexTitleLockedRef.current = true;
            if (liveTitle) setResumedTitle(liveTitle);
            // Re-stamp the pane binding in App: kind.reattach is one-shot (dead
            // after this process exits) — kind.resume is what survives an app
            // restart and reopens this conversation with its transcript.
            onSessionRecorded?.({
              paneKey,
              sessionId: claudeId,
              title: liveTitle || "chat",
              cwd: cwd ?? undefined,
              engine: liveEngine ?? "claude",
              model: liveModel ?? undefined,
            });
          }
          if (liveEngine) {
            const restored =
              (liveModel ? CHAT_MODELS.find((m) => m.id === liveModel) : undefined) ??
              CHAT_MODELS.find((m) => (m.engine ?? "claude") === liveEngine);
            if (restored && restored.id !== model.id) {
              // arm: the cleanup fired by this setModel must skip teardown.
              skipResyncTeardownRef.current = true;
              setModel(restored);
            }
          }
        }
        sessionIdRef.current = id;
        // Register the pane → backend-session-id binding so a notification click
        // (chat.done / chat.needs_input) can resolve "is this chat still open?"
        // and focus it, or reattach it if its pane was closed.
        if (paneKey && id != null) chatSessions.set(paneKey, id);
        setBackendBusy(busy);
        if (busy && turnStartRef.current == null) {
          const t0 = Date.now();
          turnStartRef.current = t0;
          setLiveStart(t0);
          setNow(t0);
        }
        setStarted(true);
        setStartupNote(null);
      })
      .catch((err) => {
        if (!disposed) {
          // pre-session failure: keep the hero standing and surface the error
          // INLINE (a transcript turn would tear the empty state down into a
          // one-footnote conversation). Mid-conversation restarts still get a
          // visible turn so the failure isn't lost in scrollback.
          setStartupNote(`failed to start: ${err}`);
          setTurns((prev) =>
            prev.length === 0
              ? prev
              : [...prev, { kind: "result", id: uid(), text: `failed to start: ${err}`, ok: false }],
          );
        }
      });

    return () => {
      disposed = true;
      // The benign resync re-run: skip teardown entirely (session stays live +
      // bound). Consume the flag; reattachBoundRef stays set so the re-run body
      // no-ops. Closure-independent, so no stale model.id race.
      if (skipResyncTeardownRef.current) {
        skipResyncTeardownRef.current = false;
        return;
      }
      // A real teardown (manual model switch, /clear, resume, unmount): this is
      // no longer a passive resync, so drop the reattach binding.
      reattachBoundRef.current = null;
      const id = sessionIdRef.current;
      sessionIdRef.current = null;
      if (paneKey) chatSessions.delete(paneKey);
      // Skip the kill when the pane was intentionally detached (kept running in
      // the background) — chat_detach already cleared the sink.
      if (id != null && !detachedRef.current) chatStop(id).catch((e) => reportDiag("chat.stop", e, { action: "cleanup" }));
    };
    // model/permission/effort/resumeId are captured at start; changing them restarts the session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.id, permission.id, effort.id, effectiveBudget, cwd, restartKey, resumeId, reattach, webChatRuntime, paneKey]);

  // Publish a close-handle so App can detach (keep running) vs kill a busy chat.
  useEffect(() => {
    if (!paneKey) return;
    chatHandles.set(paneKey, {
      busy: () => activeRunRef.current,
      stop: () => stopChatRef.current(),
      // queued follow-ups die with the pane (they live in pane state) — the
      // close dialog reads this to warn instead of silently discarding them.
      queued: () => queuedRef.current.length,
      detach: (notify: boolean) => {
        const id = sessionIdRef.current;
        if (id != null) {
          detachedRef.current = true;
          chatDetach(id, notify).catch((e) => reportDiag("chat.detach", e, { action: "detach" }));
        }
      },
    });
    return () => {
      chatHandles.delete(paneKey);
      chatSessions.delete(paneKey);
    };
  }, [paneKey]);

  // Queue flush: when a turn finishes (streaming → false) and messages are
  // queued, fire the next one. dispatch via a ref so this effect isn't a dep of
  // the (changing) dispatch closure. One per turn → the queue drains in order.
  // ALSO fires on started/claudeReady: a message queued while the session was
  // still booting ("your message is queued and will send automatically") never
  // saw a streaming transition, so keying off streaming alone stranded it in
  // the tray forever — the promise was a lie until the session-up transition
  // flushed it too.
  const dispatchRef = useRef<(text: string) => void>(() => {});
  useEffect(() => {
    if (streaming) return;
    if (!started || !claudeReady) return;
    if (queuedRef.current.length === 0) return;
    if (sessionIdRef.current == null) return;
    const [next, ...rest] = queuedRef.current;
    setQueued(rest);
    setQueuedIdx((idx) => (rest.length === 0 ? 0 : Math.min(idx, rest.length - 1)));
    dispatchRef.current(next.text);
  }, [streaming, started, claudeReady]);

  // ── autoscroll (rebuilt from scratch) ────────────────────────────────────────
  // ONE source of truth: `stickRef` = "keep the view pinned to the newest
  // message?". It is a pure function of scroll POSITION (near the bottom ⇒ stick)
  // and flips ONLY on the user's own scrolling — never inferred from scroll
  // direction "intent" or a programmatic-vs-user flag (the old model's fragile
  // parts). A ResizeObserver on the transcript re-pins on EVERY size change (new
  // turns, streamed tokens, markdown/code that highlights a beat later, images,
  // tool cards), so the view can neither fall off a growing bottom nor open
  // stranded above it. Our own pin lands at distance ≈ 0, so the scroll event it
  // fires simply re-confirms "stuck"; overflow-anchor:none on the scroller keeps
  // reflow from moving scrollTop under us.
  const contentRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const lastArrowDownRef = useRef(0);
  const [showJump, setShowJump] = useState(false);
  const [newBelow, setNewBelow] = useState(0);
  // block count captured when the user detached from the bottom → the jump pill's
  // "N new" counts everything that has landed since.
  const newBaselineRef = useRef(0);
  // render-time mirror of blocks.length (assigned right after the blocks memo).
  const blocksCountRef = useRef(0);
  // scroll position as content-space fractions → the custom rail thumb (native
  // scrollbar hidden). State-driven so the thumb tracks 1:1 with no CSS easing.
  const [railWin, setRailWin] = useState<{ top: number; size: number } | null>(null);

  // pin to the live bottom now (imperative; changes scrollTop only, never SIZE —
  // so it can never retrigger the ResizeObserver into a loop).
  const pinBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  // reflect the current position into the chrome: jump-pill visibility, its
  // "N new" badge, and the rail-thumb window. Reads stickRef, never writes it.
  const syncChrome = useCallback(() => {
    const el = scrollRef.current;
    if (!el) {
      setShowJump(false);
      setNewBelow(0);
      setRailWin(null);
      return;
    }
    const stuck = stickRef.current;
    const dist = distanceFromBottom({
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
    });
    setShowJump(!stuck && dist > 24);
    setNewBelow(stuck ? 0 : Math.max(0, blocksCountRef.current - newBaselineRef.current));
    setRailWin(
      el.scrollHeight > el.clientHeight + 1
        ? { top: el.scrollTop / el.scrollHeight, size: el.clientHeight / el.scrollHeight }
        : null,
    );
  }, []);

  // the ONLY place stick flips: derive it from the current scroll POSITION.
  // Detaching snapshots the block baseline so "N new" counts from where you left.
  const setStickFromPosition = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const stuck = atBottom({
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
    });
    if (stuck !== stickRef.current) {
      stickRef.current = stuck;
      if (!stuck) newBaselineRef.current = blocksCountRef.current;
    }
    syncChrome();
  }, [syncChrome]);

  // USER scroll (wheel / drag / touch / keys / momentum) — pure position → stick.
  // Our own pins fire this too, but land at distance ≈ 0 so they keep it stuck.
  const onScroll = useCallback(() => {
    setStickFromPosition();
  }, [setStickFromPosition]);

  // "go to latest" (the pill + double-tap ↓): re-attach and pin. The
  // ResizeObserver then holds it at the bottom through the streaming that follows.
  const jumpToLatest = useCallback(() => {
    stickRef.current = true;
    pinBottom();
    syncChrome();
  }, [pinBottom, syncChrome]);

  // INSTANT pin on known content changes (new turn / token / stream flip) so a
  // just-sent message lands its bubble immediately — pre-paint, no flicker. The
  // ResizeObserver below then keeps it pinned through async growth.
  useLayoutEffect(() => {
    if (stickRef.current) pinBottom();
    syncChrome();
    // `now` intentionally excluded — the 1Hz clock must not thrash the layout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turns, streaming, liveStart]);

  // the robust half: re-pin whenever the transcript OR the scroller changes size —
  // streamed highlighting, images loading, tool cards expanding, the composer or
  // pane resizing. This is what makes "open at the bottom" and "follow live"
  // reliable no matter WHEN content actually lays out.
  useEffect(() => {
    const content = contentRef.current;
    const scroller = scrollRef.current;
    if (!content || !scroller) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) pinBottom();
      syncChrome();
    });
    ro.observe(content);
    ro.observe(scroller);
    return () => ro.disconnect();
    // `empty` matters: the transcript (and contentRef) is early-returned away in
    // the empty hero, so the observer must RE-attach when the first message flips
    // the pane into the scrolling transcript.
  }, [pinBottom, syncChrome, empty]);

  // autosize textarea. Also re-measures on box resize: a pane mounted inside a
  // display:none host (a toggled-away canvas conversation in the windowed
  // workspace) reads scrollHeight 0 here and stayed squished when revealed —
  // the observer fires as soon as the textarea gets real layout.
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    const fit = () => {
      ta.style.height = "auto";
      ta.style.height = `${Math.min(ta.scrollHeight, 240)}px`;
    };
    fit();
    const ro = new ResizeObserver(() => {
      if (ta.offsetParent !== null) fit();
    });
    ro.observe(ta);
    return () => ro.disconnect();
  }, [input]);

  // tick the live "Working… m:ss" timer once a second while a turn is in flight
  useEffect(() => {
    if (liveStart == null) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [liveStart]);

  // ── AskUserQuestion answers ─────────────────────────────────────────────────
  // tool-turn id → the formatted answer the user submitted, so the picker card
  // collapses to a one-line verdict and never re-submits. Keyed by the claude
  // tool_use id (stable across re-renders).
  const [askAnswered, setAskAnswered] = useState<Record<string, string>>({});
  // AskUserQuestion cards the user stopped before answering → render a
  // "cancelled" verdict instead of a dead, unanswerable prompt.
  const [askCancelled, setAskCancelled] = useState<Record<string, boolean>>({});

  // ── pinned answers ──────────────────────────────────────────────────────────
  // Pin any assistant answer to a sticky strip at the top of the transcript —
  // the one command/config you keep scrolling back for stays one click away.
  // Persisted per conversation id, keyed by a TEXT hash (block ids are minted
  // per mount, so a hash is what re-finds the same answer after a reload).
  const [pins, setPins] = useState<{ h: string; preview: string }[]>([]);
  useEffect(() => {
    if (!openSessionId) {
      setPins([]);
      return;
    }
    try {
      const raw = localStorage.getItem(`osai.chat.pins.${openSessionId}`);
      setPins(raw ? (JSON.parse(raw) as { h: string; preview: string }[]) : []);
    } catch {
      setPins([]);
    }
  }, [openSessionId]);
  const persistPins = useCallback(
    (next: { h: string; preview: string }[]) => {
      setPins(next);
      if (openSessionId) {
        try {
          localStorage.setItem(`osai.chat.pins.${openSessionId}`, JSON.stringify(next));
        } catch {
          /* quota — pins stay session-local */
        }
      }
    },
    [openSessionId],
  );
  const togglePinText = useCallback(
    (text: string) => {
      const h = hashText(text);
      persistPins(
        pins.some((p) => p.h === h)
          ? pins.filter((p) => p.h !== h)
          : [...pins, { h, preview: firstLine(text) }],
      );
    },
    [pins, persistPins],
  );
  const pinnedHashes = useMemo(() => new Set(pins.map((p) => p.h)), [pins]);
  // resolve pins to the CURRENT transcript's block ids for jump-to.
  const pinResolved = useMemo(() => {
    if (pins.length === 0) return [] as { h: string; preview: string; id: string | null }[];
    const byHash = new Map<string, string>();
    for (const t of turns) {
      if (t.kind === "assistant" && t.text.trim()) {
        const h = hashText(t.text);
        if (!byHash.has(h)) byHash.set(h, t.id);
      }
    }
    return pins.map((p) => ({ ...p, id: byHash.get(p.h) ?? null }));
  }, [pins, turns]);

  // ── ExitPlanMode (plan approval) ────────────────────────────────────────────
  // tool-turn id → the verdict the user gave ("approved" | "rejected"), so the
  // plan card collapses and never re-submits. Same lifecycle as askAnswered.
  const [planResolved, setPlanResolved] = useState<Record<string, "approved" | "rejected">>({});
  // plan cards the user stopped before deciding → a quiet "cancelled" verdict.
  const [planCancelled, setPlanCancelled] = useState<Record<string, boolean>>({});
  // Response branching: per user-turn id, which regenerated response variant is
  // showing (unset = the latest). Drives the ‹N/M› switcher in the OSAI frame.
  const [activeVariant, setActiveVariant] = useState<Record<string, number>>({});

  // ── needs-you attention (sidebar dot) ───────────────────────────────────────
  // true while this chat is blocked on the human: an undecided approval card, or
  // an unanswered question/plan in the CURRENT exchange (after the last user
  // turn — an old ignored ask shouldn't nag forever).
  const needsHuman = useMemo(() => {
    let lastUser = -1;
    for (let i = 0; i < turns.length; i++) if (turns[i].kind === "user") lastUser = i;
    for (let i = 0; i < turns.length; i++) {
      const t = turns[i];
      if (t.kind === "approval" && !t.decision) return true;
      if (i > lastUser && t.kind === "tool" && t.parentId == null) {
        if (isAskQuestionTool(t) && !askAnswered[t.id] && !askCancelled[t.id]) return true;
        if (
          isPlanProposalTool(t) &&
          !planResolved[t.id] &&
          !planCancelled[t.id] &&
          !inferPlanVerdict(turns, t.id)
        ) {
          return true;
        }
      }
    }
    return false;
  }, [turns, askAnswered, askCancelled, planResolved, planCancelled]);
  useEffect(() => {
    if (!paneKey) return;
    setPaneAttention(paneKey, needsHuman);
    return () => setPaneAttention(paneKey, false);
  }, [needsHuman, paneKey]);

  // ── approval resolution ─────────────────────────────────────────────────────

  const resolveApproval = useCallback(
    (requestId: string, toolName: string, decision: ApprovalDecision) => {
      const id = sessionIdRef.current;
      if (id == null) return;
      // chat.ts owns the exact control_response shape (buildApprovalLine).
      // Mark the card resolved only once the decision actually reached the
      // engine — collapsing it on a failed send showed "allowed" for a command
      // the model never got permission to run.
      chatSendRaw(id, buildApprovalLine(requestId, decision, toolName))
        .then(() => {
          setTurns((prev) =>
            prev.map((t) =>
              t.kind === "approval" && t.requestId === requestId
                ? { ...t, decision }
                : t,
            ),
          );
          resolveNeedsInputNotification(id);
        })
        .catch((e) => reportDiag("chat.approval", e, { action: "resolve" }));
    },
    [],
  );

  // ── submit ─────────────────────────────────────────────────────────────────

  // Sends an already-composed user line to claude. `display` is what shows in
  // the transcript (the raw text the user typed); `wire` is what claude receives
  // (display + any plan / goal prefixes). Regenerate replays the same display.
  const dispatch = useCallback(
    (
      display: string,
      opts?: { skipUserBubble?: boolean; wirePrefix?: string; imagePaths?: string[] },
    ) => {
      const id = sessionIdRef.current;
      if (id == null) return;
      // No per-turn preamble. claude/codex already know `cwd` natively, attached
      // memories ride as their own content blocks, and the old shell-context lines
      // bragged about "native ops" (open panes / route artifacts / reattach runs)
      // that the chat session has NO tools to actually perform — telling the model
      // it has powers it lacks induces hallucinated tool-talk and measurably dumbs
      // it. Repeating any preamble every turn is context bloat (and re-inflates
      // resumed codex threads). Session identity belongs in CLAUDE.md / AGENTS.md,
      // read once via cwd by each engine — not stapled to every user message.
      let wire = (opts?.wirePrefix ?? "") + display;
      if (goal.trim()) wire = GOAL_PREFIX(goal.trim()) + wire;
      if (planMode) wire = PLAN_PREFIX + wire;
      if (effectiveBudget === "ultracode") wire = ULTRA_PREFIX + wire;
      // user-attached selection snippets ride THIS send only (explicit, one-shot
      // context — not per-turn injection), each as its own labeled block.
      const snips = snippetsRef.current;
      if (snips.length) {
        const ctx = snips
          .map((s, i) => `[context snippet ${i + 1}]\n${s.text}`)
          .join("\n\n");
        wire = `${ctx}\n\n${wire}`;
        setSnippets([]);
      }
      lastSentRef.current = display;
      // feed the autocomplete history (dedup, newest first, capped).
      if (display.trim()) {
        onPetUserMessage({
          textLength: display.trim().length,
          memoryCount: attachedMemories.length,
          imageCount: images.length,
        });
        try {
          const h = [display, ...historyRef.current.filter((x) => x !== display)].slice(0, 200);
          historyRef.current = h;
          localStorage.setItem(HISTORY_KEY, JSON.stringify(h));
        } catch {
          /* ignore */
        }
      }
      if (!opts?.skipUserBubble) {
        // ride the consumed attachments along on the turn so the bubble can render
        // them (thumbnails / snippet chips) — they were invisible before: sent to
        // the model but dropped from the transcript.
        setTurns((prev) => [
          ...prev,
          {
            kind: "user",
            id: uid(),
            text: display,
            createdAt: Date.now(),
            images: opts?.imagePaths?.length ? opts.imagePaths : undefined,
            snippets: snips.length ? snips.map((s) => ({ id: s.id, text: s.text })) : undefined,
          },
        ]);
      }
      // sending always snaps to the bottom — your just-sent message must be in
      // view even if you'd scrolled up to read history (one-shot, consumed by the
      // autoscroll layout effect; it also clears the paused flag).
      stickRef.current = true;
      setStreaming(true);
      setBackendBusy(true);
      streamingTurnId.current = null;
      thinkingTurnId.current = null;
      // start the turn timer (drives "Working… m:ss" → "Worked for Xs")
      const t0 = Date.now();
      turnStartRef.current = t0;
      setLiveStart(t0);
      setNow(t0);
      // plan-mode is a per-message instruction; clear it after firing
      if (planMode) setPlanMode(false);
      if (webChatRuntime) {
        webAbortRef.current?.abort();
        const controller = new AbortController();
        webAbortRef.current = controller;
        const messages: WebChatTurn[] = turnsRef.current.flatMap((turn): WebChatTurn[] => {
          if (turn.kind === "user") return [{ role: "user" as const, text: turn.text }];
          if (turn.kind === "assistant") return [{ role: "assistant" as const, text: turn.text }];
          return [];
        });
        webChatSend(wire, {
          model: model.disabled ? null : model.id,
          messages,
          signal: controller.signal,
        })
          .then((reply) => {
            if (controller.signal.aborted) return;
            handleEvent({
              type: "assistant",
              model: reply.model,
              message: {
                role: "assistant",
                model: reply.model,
                content: [{ type: "text", text: reply.text }],
              },
            });
            handleEvent({
              type: "result",
              duration_ms: Date.now() - t0,
              usage: reply.usage,
            });
          })
          .catch((err) => {
            if (controller.signal.aborted) return;
            setTurns((prev) => [
              ...prev,
              { kind: "result", id: uid(), text: `send failed: ${err}`, ok: false },
            ]);
            setStreaming(false);
            setBackendBusy(false);
          })
          .finally(() => {
            if (webAbortRef.current === controller) webAbortRef.current = null;
          });
        return;
      }
      // API tier (Tier-4 branching): send the ACTIVE root→leaf path so the model
      // sees only the active branch.
      //   · regenerate (skipUserBubble) → up to the prompt being re-answered
      //   · edit-fork → up to the edited turn's PARENT + the edit (a sibling branch)
      //   · normal send → the full active path + this new user turn
      const editId = !opts?.skipUserBubble ? pendingEditRef.current : null;
      pendingEditRef.current = null;
      if (isApiProviderId(model.engine) && editId) {
        const en = treeNodesRef.current.find((n) => n.id === editId);
        pendingForkParentRef.current = en ? en.parentId : null;
      }
      const apiMessages: ApiMessage[] | undefined = isApiProviderId(model.engine)
        ? opts?.skipUserBubble
          ? messagesUpToLastUser(activeTurnsRef.current)
          : (() => {
              const at = activeTurnsRef.current;
              const idx = editId ? at.findIndex((t) => t.id === editId) : -1;
              const base = idx >= 0 ? at.slice(0, idx) : at;
              return [...turnsToApiMessages(base), { role: "user", content: wire }];
            })()
        : undefined;
      chatSend(id, wire, opts?.imagePaths, apiMessages).catch((err) => {
        setTurns((prev) => [
          ...prev,
          { kind: "result", id: uid(), text: `send failed: ${err}`, ok: false },
        ]);
        setStreaming(false);
        setBackendBusy(false);
      });
    },
    [
      goal,
      planMode,
      effectiveBudget,
      cwd,
      paneKey,
      attachedMemories.length,
      webChatRuntime,
      model.id,
      model.disabled,
      handleEvent,
    ],
  );
  // keep the flush effect calling the latest dispatch closure
  dispatchRef.current = dispatch;

  // Answer an AskUserQuestion card: record the choice (so the card collapses) and
  // send the formatted answers back as the next user turn. claude already
  // auto-denied its own tool call (no TTY in headless mode) and the turn has
  // ended, so the only way to feed answers back is a fresh user message — which
  // is exactly what the model is waiting for.
  const answerAskQuestion = useCallback(
    (toolId: string, questions: AskQuestion[], picks: string[][]) => {
      if (askAnswered[toolId]) return;
      const lines = questions.map((q, i) => {
        const chosen = picks[i] ?? [];
        return `- ${q.header}: ${chosen.length ? chosen.join(", ") : "(no preference)"}`;
      });
      const display = lines.join("\n");
      setAskAnswered((prev) => ({ ...prev, [toolId]: display }));
      if (sessionIdRef.current == null) return;
      resolveNeedsInputNotification(sessionIdRef.current);
      // IMPORTANT: the claude CLI auto-dismisses AskUserQuestion in headless /
      // stream-json mode — there's no TTY for its native picker, so the model never
      // actually BLOCKS on the tool. It gets a "dismissed" result back (we counter
      // that with a silent hold steer the moment the tool_use arrives — see
      // HOLD_ASK). Answers go back as a plain user message. If the turn is still
      // in flight, STEER the answers straight into it (the hold told the model to
      // wait for exactly this); queue is the fallback so nothing is dropped.
      const answerText = `Here are my answers to your questions:\n${display}`;
      const queueIt = () =>
        setQueued((items) => {
          const next = queueMessage(items, answerText);
          setQueuedIdx(next.selected);
          return next.items;
        });
      if (streaming) {
        const sid = sessionIdRef.current;
        const engine = model.engine ?? "claude";
        if (sid != null && (engine === "claude" || engine === "codex")) {
          chatSteer(sid, answerText).catch(queueIt);
        } else {
          queueIt();
        }
      } else {
        // skip the default user bubble — the collapsed card already shows the answer.
        dispatch(answerText, { skipUserBubble: true });
      }
    },
    [askAnswered, dispatch, streaming, model.engine],
  );

  // Resolve an ExitPlanMode card: record the verdict (so the card collapses) and
  // feed it back as the next user turn. Like AskUserQuestion, the CLI auto-dismisses
  // ExitPlanMode in headless mode (tool_result `"Exit plan mode?"`) and the model
  // stalls — so the verdict goes back as a plain follow-up message the model reads
  // as text. Approving also drops plan-mode locally so the next turn isn't plan-
  // prefixed (the model should now BUILD, not keep planning).
  const resolvePlan = useCallback(
    (toolId: string, decision: "approve" | "reject", feedback?: string) => {
      if (planResolved[toolId]) return;
      setPlanResolved((prev) => ({
        ...prev,
        [toolId]: decision === "approve" ? "approved" : "rejected",
      }));
      const note = feedback?.trim();
      // built on the fixed sentinels so inferPlanVerdict can recover the
      // decision from a replayed transcript.
      const text =
        decision === "approve"
          ? `${PLAN_APPROVE_SENTINEL} — go ahead and implement it now.${note ? `\n\nA few notes before you start:\n${note}` : ""}`
          : `${PLAN_REJECT_SENTINEL} — keep refining the plan.${note ? `\n\nHere's what to change:\n${note}` : "\n\nReconsider the approach and propose an updated plan."}`;
      if (decision === "approve") setPlanMode(false);
      if (sessionIdRef.current == null) return;
      resolveNeedsInputNotification(sessionIdRef.current);
      const queueIt = () =>
        setQueued((items) => {
          const next = queueMessage(items, text);
          setQueuedIdx(next.selected);
          return next.items;
        });
      if (streaming) {
        // a turn is still in flight → STEER the verdict straight into it (the
        // silent hold told the model to wait for exactly this); queue as the
        // fallback so the decision is never dropped.
        const sid = sessionIdRef.current;
        const engine = model.engine ?? "claude";
        if (sid != null && (engine === "claude" || engine === "codex")) {
          chatSteer(sid, text).catch(queueIt);
        } else {
          queueIt();
        }
      } else {
        // skip the default user bubble — the collapsed card already shows the verdict.
        dispatch(text, { skipUserBubble: true });
      }
    },
    [planResolved, dispatch, streaming, model.engine],
  );

  // Switch the working directory this chat operates in. A running engine can't
  // be re-rooted (cwd is fixed at process start), so this hands the new dir up
  // to App (persists it on the pane) — the cwd prop then changes, which the
  // session effect treats as a restart, re-spinning the engine in the new dir.
  // We clear the transcript first: the fresh process has none of the old
  // conversation's memory, so leaving stale turns up would imply a continuity
  // that no longer exists.
  const changeCwd = useCallback(
    (dir: string) => {
      const next = dir.trim();
      if (!next || next === (cwd ?? "")) return;
      setOpenMenu(null);
      // a brand-new (empty) chat just re-roots silently; an in-progress one gets
      // a short marker so the dir switch + fresh session is visible in scrollback.
      setTurns((prev) =>
        prev.length === 0
          ? prev
          : [{ kind: "result", id: uid(), text: `↳ working directory changed to ${next} — started a fresh session here`, ok: true }],
      );
      setResumeId(null);
      claudeSessionIdRef.current = null;
      recordedRef.current = false;
      // fresh session in the new dir → the old conversation no longer lives in
      // this pane; un-stamp so a restart doesn't restore it here.
      onSessionRecorded?.({ paneKey, sessionId: "", title: "" });
      onChangeCwd?.(next);
    },
    [cwd, onChangeCwd, onSessionRecorded, paneKey],
  );

  // Queue a message instead of sending it (used while a turn is streaming). It
  // fires automatically when the current turn completes (see the flush effect).
  const enqueue = useCallback((raw: string) => {
    setQueued((items) => {
      const next = queueMessage(items, raw);
      setQueuedIdx(next.selected);
      return next.items;
    });
    setInput("");
    setOverlay(null);
  }, []);

  const removeQueued = useCallback((id: string) => {
    setQueued((items) => {
      const next = removeQueuedMessage({ items, selected: queuedIdx }, id);
      setQueuedIdx(next.selected);
      return next.items;
    });
    if (editingQueuedId === id) {
      setEditingQueuedId(null);
      setEditingQueuedText("");
    }
  }, [queuedIdx, editingQueuedId]);

  const editQueued = useCallback((item: QueuedMessage) => {
    setEditingQueuedId(item.id);
    setEditingQueuedText(item.text);
  }, []);

  const saveQueuedEdit = useCallback(() => {
    const id = editingQueuedId;
    if (!id) return;
    setQueued((items) => {
      const next = updateQueuedMessage(
        { items, selected: queuedIdx },
        id,
        editingQueuedText,
      );
      setQueuedIdx(next.selected);
      return next.items;
    });
    setEditingQueuedId(null);
    setEditingQueuedText("");
  }, [editingQueuedId, editingQueuedText, queuedIdx]);

  const moveQueued = useCallback((id: string, delta: number) => {
    setQueued((items) => {
      const next = moveQueuedMessage({ items, selected: queuedIdx }, id, delta);
      setQueuedIdx(next.selected);
      return next.items;
    });
  }, [queuedIdx]);

  // Explicitly inject one highlighted pending message into the live turn. Both
  // codex (native `turn/steer`) and claude (soft-inject onto stdin) support this;
  // if the backend can't steer yet (no active turn), keep it queued so normal
  // auto-send wins.
  const steerQueued = useCallback(
    (queuedId: string) => {
      const item = queuedRef.current.find((q) => q.id === queuedId);
      if (!item || (model.engine !== "codex" && model.engine !== "claude")) return;
      const id = sessionIdRef.current;
      if (id == null) return;
      chatSteer(id, item.text)
        .then(() => {
          removeQueued(queuedId);
          // steering is a send — snap to your injected message and resume following.
          stickRef.current = true;
          setTurns((prev) => [...prev, { kind: "user", id: uid(), text: item.text, steered: true, createdAt: Date.now() }]);
        })
        .catch((e) => reportDiag("chat.steer", e, { action: "queued" })); // no active turn yet → keep queued for automatic send
    },
    [model.engine, removeQueued],
  );

  // Send an explicit string (used by send() with the composer text, and by the
  // external "send to AI" submitter which passes the note body directly so it
  // doesn't race the input state).
  const sendText = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      // If any attached image is still saving to disk, wait it out before we
      // collect paths — a fast paste→Enter used to filter out the pending image
      // and ship the turn without it (the "image send is buggy" report).
      if (imagesRef.current.some((im) => im.path == null) && pendingSavesRef.current.size) {
        await Promise.allSettled([...pendingSavesRef.current.values()]);
      }
      // attached images are sent as REAL image content blocks (the backend reads
      // these temp paths → base64/localImage), so they land on every turn, not
      // just the first. allow a send with images even when the text is empty.
      const imgPaths = imagesRef.current
        .filter((im) => im.path)
        .map((im) => im.path as string);
      if (!text && imgPaths.length === 0) return;
      if (streaming) return;
      if (sessionIdRef.current == null) {
        // pre-session sends must not tear down the hero with a transcript turn
        // — queue the text and say so inline, right under the composer.
        if (imgPaths.length === 0) {
          enqueue(text);
          setInput("");
          setOverlay(null);
          setStartupNote("still starting — your message is queued and will send automatically");
          return;
        }
        setStartupNote("session isn't ready yet — retry after startup and attachments will be included");
        return;
      }
      // Claude keeps its original first-message labels. Codex starts with a
      // provisional label for low-signal openers, then promotes the first real
      // request into a compact stable topic.
      const engine = model.engine ?? "claude";
      const suggested = resumeTitle(text, engine);
      const stableTitle = agentLabel ?? suggested.title;
      const firstRecord = !recordedRef.current;
      const promoteCodex =
        engine === "codex" && !codexTitleLockedRef.current && suggested.meaningful;
      const sid = claudeSessionIdRef.current;
      if (sid && (firstRecord || promoteCodex)) {
        if (firstRecord) recordedRef.current = true;
        if (promoteCodex) codexTitleLockedRef.current = true;
        recordChatSession(sid, stableTitle, cwd ?? null, engine, model.id)
          // tell an open History pane to refresh, so a chat recorded after it was
          // opened (e.g. a new pane you then close) shows up without a manual reload.
          .then(() => window.dispatchEvent(new Event("osai:history-changed")))
          .catch(() => {
            // failed to persist → allow a later send to retry
            if (firstRecord) recordedRef.current = false;
            if (promoteCodex) codexTitleLockedRef.current = false;
          });
        // report the durable id so App can bind this chat to a Work Session.
        onSessionRecorded?.({ paneKey, sessionId: sid, title: stableTitle, cwd: cwd ?? undefined, engine, model: model.id });
        if (agentId) {
          saveScheduledAgentChatSession(agentId, {
            sessionId: sid,
            title: stableTitle,
            updatedAt: Date.now(),
          });
        }
        // Label the backend session for the background tray + done-notification.
        if (sessionIdRef.current != null)
          chatSetTitle(sessionIdRef.current, stableTitle).catch((e) => reportDiag("chat.title", e, { action: "setTitle" }));
      } else if (!sid && firstRecord) {
        // Sent before claude's init landed → the engine session id isn't known
        // yet. Remember this first record; the init effect flushes it the moment
        // the id arrives, so the chat still lands in History (recordable +
        // renamable) instead of only being self-healed with an auto-title.
        recordedRef.current = true;
        pendingFirstRecordRef.current = { title: stableTitle, engine, model: model.id };
      }
      setInput("");
      setImages((prev) => {
        prev.forEach((im) => URL.revokeObjectURL(im.url));
        return [];
      });
      setOverlay(null);
      const attachedMemoryBlock = memoryContextBlock(attachedMemories);
      setAttachedMemoryIds([]);
      // images ride as native content blocks (opts.imagePaths). Keep the wire +
      // "[n images]" fallback label EXACTLY as before so the model sees what it
      // always has — the bubble now ALSO carries the paths and renders thumbnails,
      // hiding that placeholder text when it's present (see UserBubble).
      const bubble = text || (imgPaths.length ? `[${imgPaths.length} image${imgPaths.length > 1 ? "s" : ""}]` : "");
      dispatch(bubble, { wirePrefix: attachedMemoryBlock, imagePaths: imgPaths });
    },
    [streaming, dispatch, cwd, images, model, attachedMemories],
  );

  const send = useCallback(() => sendText(input), [sendText, input]);

  // Soft-steer the running turn with the composer draft: codex via native
  // `turn/steer`, claude via a stdin soft-inject (folds in at its next step, or
  // lands as the next turn — no in-flight work lost). Engines that can't steer
  // fall back to queueing. The ⌥⏎ modifier routes to interruptAndRedirect instead.
  const steerDraft = useCallback(() => {
    const text = input.trim();
    const id = sessionIdRef.current;
    if (!text || id == null) return;
    if (model.engine !== "codex" && model.engine !== "claude") {
      enqueue(text);
      return;
    }
    chatSteer(id, text)
      .then(() => {
        // steering is a send — snap to your injected message and resume following.
        stickRef.current = true;
        setTurns((prev) => [...prev, { kind: "user", id: uid(), text, steered: true, createdAt: Date.now() }]);
        setInput("");
        setOverlay(null);
      })
      .catch(() => enqueue(text));
  }, [input, model.engine, enqueue]);

  // Deep-leaf note submitter (markdown checklists → "send progress"): steer into
  // the live turn when the engine can take it, queue mid-turn otherwise, plain
  // send when idle. Provided via ChatSubmitContext.
  const submitNote = useCallback(
    (text: string) => {
      const note = text.trim();
      const id = sessionIdRef.current;
      if (!note || id == null) return;
      const engine = model.engine ?? "claude";
      if (streaming && (engine === "claude" || engine === "codex")) {
        chatSteer(id, note)
          .then(() => {
            setTurns((prev) => [
              ...prev,
              { kind: "user", id: uid(), text: note, steered: true, createdAt: Date.now() },
            ]);
          })
          .catch(() => enqueue(note));
      } else if (streaming) {
        enqueue(note);
      } else {
        dispatch(note);
      }
    },
    [streaming, model.engine, dispatch, enqueue],
  );

  // Interrupt-and-redirect: stop the in-flight turn (verified claude/codex
  // interrupt — the process survives), then let the queue-flush effect fire the
  // draft the instant the turn ends. Used by the ⌥⏎ steer modifier when you want
  // the model to drop what it's doing and pivot, not fold the note in gently.
  const interruptAndRedirect = useCallback(() => {
    const text = input.trim();
    const id = sessionIdRef.current;
    if (!text || id == null) return;
    enqueue(text); // auto-fires on the interrupt's `result` (see the flush effect)
    chatInterrupt(id).catch((e) => reportDiag("chat.interrupt", e, { action: "steer-redirect" }));
  }, [input, enqueue]);

  // Keep a fresh ref to sendText so the external submitter (registered once per
  // paneKey) always calls the latest closure without re-registering.
  const sendTextRef = useRef(sendText);
  sendTextRef.current = sendText;

  // ── launcher seed: auto-send as the first turn ─────────────────────────────
  // The idle page hands over the prompt you typed as `seed`; fire it once the
  // session is live (started) and claude's init has landed (claudeReady, so the
  // chat records into /resume) — so the text you typed on the idle page IS the
  // first message. No "type once to launch, type again to send".
  //
  // Hardening (fix 6.1): a resume / model-switch / restart nulls sessionIdRef
  // mid-flight, and dispatch() early-returns when the id is null — so naively
  // firing on (started && claudeReady) could send into a stale/null session and
  // silently lose the seed. Gate strictly on a LIVE session id, send the seed
  // text explicitly (not racy `input` state), and only mark it sent once the
  // dispatch had a live session. If the session never comes live, surface a
  // visible note instead of swallowing the prompt.
  useEffect(() => {
    if (!seed || seedSentRef.current) return;
    if (!started || !claudeReady) return;
    // require a live backend session id — not just the started/ready flags,
    // which can be true for a beat while sessionIdRef is being (re)assigned.
    if (sessionIdRef.current == null) return;
    seedSentRef.current = true;
    void sendTextRef.current(seed).catch((e) => reportDiag("chat.send", e, { action: "seed" }));
    // started flips true in the same startup .then() that assigns sessionIdRef,
    // so by the time this re-runs the id is live.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed, started, claudeReady]);

  // Safety net: if a seed never got delivered (the session kept restarting so a
  // live id never settled within a grace window), tell the user instead of
  // silently dropping the prompt they typed on the idle page.
  useEffect(() => {
    if (!seed || seedSentRef.current) return;
    const t = window.setTimeout(() => {
      if (seedSentRef.current) return;
      if (sessionIdRef.current != null) return; // a later tick will send it
      seedSentRef.current = true;
      setTurns((prev) => [
        ...prev,
        {
          kind: "result",
          id: uid(),
          text: "couldn't auto-send your opening message — the session didn't come live. retype + send.",
        },
      ]);
      // keep the prompt in the composer so it isn't lost.
      setInput((cur) => (cur ? cur : seed));
    }, 12000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  // regenerate: replay the last user turn (no extra user bubble)
  const regenerate = useCallback(
    (text?: string) => {
      // prefer the caller's text (the visible bubble) so a rehydrated/resumed
      // transcript regenerates what's on screen, not a stale lastSent ref.
      const last = text ?? lastSentRef.current;
      if (!last || streaming || sessionIdRef.current == null) return;
      // the new response is a fresh VARIANT of the last user turn — clear any
      // explicit variant pick for it so the latest (new) one shows, not a pinned
      // older response (response-branching switcher reset).
      const lastUser = [...turnsRef.current].reverse().find((t) => t.kind === "user");
      if (isApiProviderId(model.engine)) {
        // API branching: the regenerated answer FORKS from the last user turn (a
        // new sibling branch, newest = shown). The mirror links it on arrival.
        pendingForkParentRef.current = lastUser?.id ?? null;
      } else if (lastUser) {
        // CLI tier: the old display-variant reset (clear any pinned older answer).
        setActiveVariant((prev) => {
          if (prev[lastUser.id] == null) return prev;
          const next = { ...prev };
          delete next[lastUser.id];
          return next;
        });
      }
      dispatch(last, { skipUserBubble: true });
    },
    [streaming, dispatch, model],
  );

  // the failure card's retry: pre-session (startup failed) a resend has nothing
  // to land in — re-spin the session instead of dead-clicking regenerate.
  const retryTurn = useCallback(() => {
    if (sessionIdRef.current == null) {
      setRestartKey((k) => k + 1);
      return;
    }
    regenerate();
  }, [regenerate]);

  // retry-with-model: re-run the last turn on a DIFFERENT model. The engine is
  // bound at session start (the session effect keys on model.id), so there's no
  // per-send model — we resume the live conversation under the new model (which
  // restarts the session) and regenerate once it's ready. Same model → a plain
  // regenerate. NOTE: full context-fidelity across the swap rides on the CLI
  // honoring `--resume` together with a new `--model`; the display always rewinds
  // cleanly (the new answer lands as a ‹N/M› variant).
  const pendingRetryRef = useRef<string | null>(null);
  const retryWithModel = useCallback(
    (m: ChatModel, text: string) => {
      if (streaming || sessionIdRef.current == null) return;
      if (m.id === model.id) {
        regenerate(text);
        return;
      }
      // resume the LIVE backend conversation so the new model keeps context
      // (resumeId isn't otherwise synced to the running session — this is the
      // one path that needs it). Both setState calls batch → one restart.
      const rid = claudeSessionIdRef.current;
      if (rid) setResumeId(rid);
      pendingRetryRef.current = text;
      setModel(m);
    },
    [streaming, model.id, regenerate],
  );
  // Fire the queued retry once the resumed/new-model session is live (claudeReady
  // flips true after the restart). No pending retry → no-op, so this is inert on
  // every other (re)start.
  useEffect(() => {
    if (started && claudeReady && !streaming && pendingRetryRef.current != null) {
      const text = pendingRetryRef.current;
      pendingRetryRef.current = null;
      regenerate(text);
    }
  }, [started, claudeReady, streaming, regenerate]);
  // Flush a deferred first-turn record once the engine session id lands (the
  // send raced ahead of claude's init — see pendingFirstRecordRef). Records the
  // chat into the /resume index + reports the id to App (which binds the pane and
  // flushes any pending tab/History rename). Without this, a fast first send was
  // never recorded — only self-healed later with an unrenamable auto-title.
  useEffect(() => {
    const pending = pendingFirstRecordRef.current;
    if (!openSessionId || !pending) return;
    pendingFirstRecordRef.current = null;
    recordChatSession(openSessionId, pending.title, cwd ?? null, pending.engine, pending.model)
      .then(() => window.dispatchEvent(new Event("osai:history-changed")))
      .catch(() => {
        // let a later send retry if this persist failed
        recordedRef.current = false;
      });
    onSessionRecorded?.({
      paneKey,
      sessionId: openSessionId,
      title: pending.title,
      cwd: cwd ?? undefined,
      engine: pending.engine,
      model: pending.model,
    });
    if (agentId) {
      saveScheduledAgentChatSession(agentId, {
        sessionId: openSessionId,
        title: pending.title,
        updatedAt: Date.now(),
      });
    }
    if (sessionIdRef.current != null)
      chatSetTitle(sessionIdRef.current, pending.title).catch((e) =>
        reportDiag("chat.title", e, { action: "setTitle" }),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSessionId]);

  // edit-and-resend: load a past message back into the composer to tweak + send.
  const editMessage = useCallback(
    (id: string, text: string) => {
      setOverlay(null);
      setInput(text);
      // API tier: remember which turn we're editing so the next send FORKS a new
      // branch from its parent (keeping the original as a sibling). CLI tier just
      // refills the composer (can't branch).
      if (isApiProviderId(model.engine)) pendingEditRef.current = id;
      setTimeout(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
        }
      }, 0);
    },
    [model],
  );

  const finalizeStreaming = useCallback(
    (note: string, mode: "interrupt" | "kill-and-restart" = "interrupt") => {
      const id = sessionIdRef.current;
      setTurns((prev) =>
        finalizeStreamingTurns(
          {
            turns: prev,
            streamingTurnId: streamingTurnId.current,
            thinkingTurnId: thinkingTurnId.current,
          },
          Date.now(),
        ).turns,
      );
      streamingTurnId.current = null;
      thinkingTurnId.current = null;
      turnStartRef.current = null;
      setLiveStart(null);
      setStreaming(false);
      setBackendBusy(false);
      setTurns((prev) => [...prev, { kind: "result", id: uid(), text: note }]);
      if (webChatRuntime) {
        webAbortRef.current?.abort();
        webAbortRef.current = null;
        return;
      }
      if (id != null) {
        if (mode === "kill-and-restart") {
          sessionIdRef.current = null;
          chatStop(id)
            .catch((e) => reportDiag("chat.stop", e, { action: "killRestart" }))
            .finally(() => {
              setRunEventState(emptyRunEventState());
              setRunEventsKey(null);
              setRestartKey((k) => k + 1);
            });
        } else {
          chatInterrupt(id).catch((e) => reportDiag("chat.interrupt", e, { action: "interrupt" }));
        }
      }
    },
    [webChatRuntime],
  );

  // true interrupt of the in-flight turn (process survives)
  const stop = useCallback(() => {
    if (sessionIdRef.current == null) return;
    stoppingRef.current = true;
    // any AskUserQuestion still open when the user stops is now moot — mark it
    // cancelled so the card shows that instead of a dead, unanswerable prompt.
    setAskCancelled((prev) => {
      let next = prev;
      for (const t of turnsRef.current) {
        if (t.kind === "tool" && isAskQuestionTool(t) && !next[t.id]) {
          next = { ...next, [t.id]: true };
        }
      }
      return next;
    });
    // an unresolved plan card is likewise moot once stopped — show a cancelled
    // verdict rather than a dead, undecidable proposal.
    setPlanCancelled((prev) => {
      let next = prev;
      for (const t of turnsRef.current) {
        if (t.kind === "tool" && isPlanProposalTool(t) && !next[t.id]) {
          next = { ...next, [t.id]: true };
        }
      }
      return next;
    });
    const strategy = stopStrategy(model.engine);
    finalizeStreaming(
      strategy === "kill-and-restart"
        ? "stopped by user — backend restarted"
        : "stopped by user",
      strategy,
    );
  }, [finalizeStreaming, model.engine]);
  stopChatRef.current = stop;

  // hard reset: clear transcript + re-spin a FRESH claude session (drops any
  // resume id, so a new chat / /clear never keeps continuing a past session).
  const clearSession = useCallback(() => {
    if (runEventsKey) {
      try {
        localStorage.removeItem(runEventsKey);
      } catch {
        /* ignore */
      }
    }
    setTurns([]);
    setRunEventState(emptyRunEventState());
    setRunEventsKey(null);
    setStreaming(false);
    webAbortRef.current?.abort();
    webAbortRef.current = null;
    streamingTurnId.current = null;
    thinkingTurnId.current = null;
    lastSentRef.current = null;
    turnStartRef.current = null;
    setLiveStart(null);
    setInput("");
    setOverlay(null);
    setQueued([]);
    setQueuedIdx(0);
    setResumeId(null);
    setResumedTitle(null);
    // fresh chat → forget the prior session id + recording flag so the next
    // first-send records a brand-new /resume entry (not the old one).
    claudeSessionIdRef.current = null;
    setOpenSessionId(null);
    recordedRef.current = false;
    codexTitleLockedRef.current = false;
    // Un-stamp the pane↔conversation binding in App: the user explicitly
    // dropped this thread, so an app restart must NOT resurrect it into this
    // pane (sessionId "" = clear, by contract with handleSessionRecorded).
    onSessionRecorded?.({ paneKey, sessionId: "", title: "" });
    setRestartKey((k) => k + 1);
  }, [runEventsKey, onSessionRecorded, paneKey]);

  // ── /resume: reopen a past chat session ────────────────────────────────────
  // Loads the chat-only session list (lazy, on picker open). On selection we
  // OPEN the conversation: repaint its past user/assistant turns from the saved
  // transcript so the user SEES it, THEN re-spin the claude process with that
  // resume id so the next message continues it. Reuses the same restart
  // mechanism as /clear — but `resumeId` (an effect dep) carries forward and the
  // turns are the rehydrated transcript instead of empty.
  const loadResumeSessions = useCallback(async () => {
    setResumeLoading(true);
    try {
      const sessions = await listChatSessions(40);
      setResumeSessions(sessions);
    } catch {
      setResumeSessions([]);
    } finally {
      setResumeLoading(false);
    }
  }, []);

  /** Map saved transcript turns into the live transcript model (static bubbles).
   *  User turns run through the session-label sanitizer so resumed CLI slash
   *  turns repaint as "/usage", not raw <command-name> XML (user-reported).
   *  Each minted id gets its REAL transcript time in `turnTimes` (NaN when the
   *  file has none — the live stamper must not fake-date old turns "now"). */
  const transcriptToTurns = useCallback((rows: ChatTurnInfo[]): Turn[] => {
    return rows.map((r) => {
      const at = r.ts != null ? r.ts * 1000 : undefined;
      const turn: Turn =
        r.role === "user"
          ? { kind: "user", id: uid(), text: cleanSessionLabel(r.text), createdAt: at }
          : { kind: "assistant", id: uid(), text: r.text, streaming: false, createdAt: at };
      turnTimesRef.current.set(turn.id, at ?? NaN);
      return turn;
    });
  }, []);

  // A freshly-spawned RESUMED pane (resume prop set at mount — open-from-history
  // or resume-last) must repaint its transcript: claude `--resume` continues the
  // thread but never re-emits the past turns, so without this the pane is empty.
  // (The /resume picker repaints via resumeSession; this covers the new-pane path.)
  // Repaint from OUR durable store first (full fidelity), fall back to the engine
  // transcript for foreign/legacy chats.
  const mountRepaintedRef = useRef(false);
  useEffect(() => {
    // reattach panes paint from the live buffer replay, not history — with both
    // set (a notification target carrying its history fallback), painting here
    // too would double every turn. The reattach-failure path repaints itself.
    if (mountRepaintedRef.current || !resume?.id || reattach != null) return;
    mountRepaintedRef.current = true;
    const id = resume.id;
    // P7b deep-link: a History-pane search result carries its query, so once the
    // transcript is painted we open the find bar on it — the find machinery then
    // scrolls to + highlights the first matching message. (No-match → find bar
    // just opens empty-handed and the forced bottom stands.)
    const deepLink = () => {
      const q = resume.findText?.trim();
      if (q && q.length >= 2) {
        setFindOpen(true);
        setFindQuery(q);
      }
    };
    const fromTranscript = () =>
      readChatTranscript(id)
        .then((rows) => {
          if (rows.length) {
            stickRef.current = true;
            setTurns(transcriptToTurns(rows));
            deepLink();
          }
        })
        .catch(() => {});
    const linearReplay = () =>
      readChatHistory(id)
        .then((page) => {
          if (page.lines.length) {
            stickRef.current = true;
            setTurns(replayHistoryToTurns(page.lines, uid));
            deepLink();
          } else void fromTranscript();
        })
        .catch(() => void fromTranscript());
    // API chats may have a TREE sidecar (branches) — restore the exact tree so
    // reopening preserves the active branch + switchers; else replay linearly.
    if (isApiProviderId(model.engine)) {
      loadChatTree(id)
        .then((json) => {
          const tree = json ? deserializeTree(json) : null;
          if (tree) {
            stickRef.current = true;
            setTurns(tree.turns);
            setTreeNodes(tree.nodes);
            setTreeSel(tree.selection);
            deepLink();
          } else void linearReplay();
        })
        .catch(() => void linearReplay());
    } else {
      void linearReplay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resumeSession = useCallback(
    (session: ChatSessionInfo) => {
      // reset turn/stream bookkeeping; mark as already-recorded (it's in the
      // list), set the resume id (→ effect re-spins claude with --resume), and
      // remember the new claude session id so a future first-send doesn't
      // re-record it.
      setStreaming(false);
      streamingTurnId.current = null;
      thinkingTurnId.current = null;
      lastSentRef.current = null;
      turnStartRef.current = null;
      setLiveStart(null);
      setInput("");
      setOverlay(null);
      setResumeQuery("");
      claudeSessionIdRef.current = session.id;
      setOpenSessionId(session.id);
      setRunEventsKey(runEventsStorageKey(session.id));
      recordedRef.current = true;
      codexTitleLockedRef.current = true;
      const resumeModel =
        resolveChatModel(session.model, session.engine) ??
        CHAT_MODELS.find((m) => (m.engine ?? "claude") === (session.engine || "claude"));
      if (resumeModel) setModel(resumeModel);
      setResumeId(session.id);
      setResumedTitle(session.title);
      // show the past conversation immediately while claude re-spins. Paint a
      // placeholder first, then swap in the real transcript when it loads (the
      // session-restart effect never clears `turns`, so this is safe).
      setTurns([]);
      setRunEventState(emptyRunEventState());
      // Repaint from OUR durable store first (full fidelity — thinking, tool
      // calls, diffs), replayed through the SAME reducer the live stream uses.
      // Fall back to the engine's text-only transcript for foreign/legacy chats
      // with no store yet (D4).
      const repaintFromTranscript = () =>
        readChatTranscript(session.id)
          .then((rows) => {
            if (rows.length) setTurns(transcriptToTurns(rows));
          })
          .catch(() => {
            // transcript unavailable → leave the pane empty but still resumable
          });
      readChatHistory(session.id)
        .then((page) => {
          if (page.lines.length) {
            stickRef.current = true;
            setTurns(replayHistoryToTurns(page.lines, uid));
          } else {
            void repaintFromTranscript();
          }
        })
        .catch(() => void repaintFromTranscript());
      // Tell App which conversation this pane now hosts, so layout persistence
      // reopens it (transcript + --resume) after an app restart — the /resume
      // picker was the one resume path that never re-stamped the pane.
      onSessionRecorded?.({
        paneKey,
        sessionId: session.id,
        title: session.title,
        cwd: session.cwd || undefined,
        engine: session.engine || undefined,
        model: session.model || undefined,
      });
      // bump restartKey too so re-picking the SAME session still re-spins
      setRestartKey((k) => k + 1);
    },
    [transcriptToTurns, onSessionRecorded, paneKey],
  );

  // ── slash + @ overlays ─────────────────────────────────────────────────────

  const slashCommands = useMemo<SlashCommand[]>(
    () => [
      {
        id: "clear",
        label: "/clear",
        desc: "reset transcript + restart session",
        icon: <RefreshCw size={14} />,
        run: () => {
          clearSession();
        },
      },
      {
        id: "compact",
        label: "/compact",
        desc: "summarize + shrink the context window (keeps the thread)",
        icon: <Minimize2 size={14} />,
        run: () => {
          // /compact is a real CLI slash command — send it as the turn text and
          // the engine compacts in place (the composer shows "Compacting context…"
          // while it runs). Unlike /clear it keeps the conversation.
          setOverlay(null);
          void sendText("/compact");
        },
      },
      {
        id: "plan",
        label: "/plan",
        desc: "plan-first on the next message",
        icon: <ListChecks size={14} />,
        run: () => {
          setPlanMode(true);
          setInput("");
          setOverlay(null);
        },
      },
      {
        id: "goal",
        label: "/goal",
        desc: "set an ongoing goal (prepended each turn)",
        icon: <Target size={14} />,
        run: () => {
          setOverlay(null);
          setInput("");
          setGoalDraft(goal); // open the inline editor (themed, not a native OS modal)
        },
      },
      {
        id: "memory",
        label: "/memory",
        desc: "search and attach memory context",
        icon: <Brain size={14} />,
        run: () => {
          setInput("");
          setOverlay(null);
          setMemoryPanelOpen(true);
          setTimeout(() => taRef.current?.focus(), 0);
        },
      },
      {
        id: "resume",
        label: "/resume",
        desc: "reopen a past conversation",
        icon: <History size={14} />,
        run: () => {
          setInput("");
          setResumeQuery("");
          setOverlay("resume");
          setOverlayIdx(0);
          void loadResumeSessions();
          // focus the picker's search box after it mounts
          setTimeout(() => resumeSearchRef.current?.focus(), 0);
        },
      },
      {
        id: "model",
        label: "/model",
        desc: "switch the model",
        icon: <Sparkles size={14} />,
        run: () => {
          setInput("");
          setOverlay(null);
          setOpenMenu("model");
        },
      },
      {
        id: "handoff",
        label: "/handoff",
        desc: "package this session for a target model",
        icon: <PackageOpen size={14} />,
        run: () => {
          setInput("");
          setOverlay(null);
          setHandoffPanelOpen(true);
          setTimeout(() => taRef.current?.focus(), 0);
        },
      },
      {
        id: "agent",
        label: "/agent",
        desc: "hand this conversation to a scheduled agent to keep working",
        icon: <Clock size={14} />,
        run: () => {
          setInput("");
          setOverlay(null);
          const sid = claudeSessionIdRef.current;
          const firstUser = turnsRef.current.find((t) => t.kind === "user");
          const title = (
            chatTitleRef.current ||
            (firstUser?.kind === "user"
              ? resumeTitle(firstUser.text, model.engine ?? "claude").title
              : "") ||
            "chat"
          ).slice(0, 60);
          const agent = createScheduledAgent({
            label: `continue: ${title}`,
            mission:
              goal.trim() ||
              `Continue the work from the chat "${title}". Review the recent conversation, pick up exactly where it left off, and keep making concrete progress. Report what you did at the end of each run.`,
            cwd: cwd ?? undefined,
          });
          if (!agent) return;
          // bind the agent to THIS conversation so opening it resumes here.
          if (sid) {
            saveScheduledAgentChatSession(agent.id, {
              sessionId: sid,
              title,
              updatedAt: Date.now(),
            });
          }
          setTurns((prev) => [
            ...prev,
            {
              kind: "result",
              id: uid(),
              text: `↳ handed off to scheduled agent “${agent.label}” — run or schedule it from the sidebar agents panel; it resumes this conversation`,
              ok: true,
            },
          ]);
        },
      },
      {
        id: "help",
        label: "/help",
        desc: "what can this do",
        icon: <HelpCircle size={14} />,
        run: () => {
          setInput("");
          setOverlay(null);
          setTurns((prev) => [
            ...prev,
            {
              kind: "assistant",
              id: uid(),
              streaming: false,
              text: HELP_TEXT,
            },
          ]);
        },
      },
    ],
    [clearSession, loadResumeSessions, sendText, goal],
  );

  // load dir entries for the @-mention picker (lazy, on first open)
  const loadMentions = useCallback(async () => {
    const root = cwd;
    if (!root) {
      setMentionItems([]);
      return;
    }
    try {
      const entries = await readDir(root);
      // dirs first, then files; cap to keep the popover tight
      entries.sort((a, b) =>
        a.is_dir === b.is_dir
          ? a.name.localeCompare(b.name)
          : a.is_dir
            ? -1
            : 1,
      );
      setMentionItems(entries.slice(0, 200));
    } catch {
      setMentionItems([]);
    }
  }, [cwd]);

  // detect `/` at start or `@…` token under the caret, drive the overlay
  const syncOverlay = useCallback(
    (value: string) => {
      // slash menu: only when the whole composer starts with a lone `/word`
      if (/^\/[a-z]*$/i.test(value)) {
        setOverlay("slash");
        setOverlayIdx(0);
        return;
      }
      // @-mention: last token before caret begins with @
      const m = value.match(/(?:^|\s)@([^\s]*)$/);
      if (m) {
        setMentionQuery(m[1] ?? "");
        if (overlay !== "mention") {
          setOverlay("mention");
          setOverlayIdx(0);
          void loadMentions();
        }
        return;
      }
      if (overlay) setOverlay(null);
    },
    [overlay, loadMentions],
  );

  const onChangeInput = (value: string) => {
    setInput(value);
    syncOverlay(value);
  };

  // filtered views for the active overlay
  const slashFiltered = useMemo(() => {
    const q = input.replace(/^\//, "").toLowerCase();
    return slashCommands.filter((c) => c.id.startsWith(q) || q === "");
  }, [input, slashCommands]);

  const mentionFiltered = useMemo(() => {
    const q = mentionQuery.toLowerCase();
    if (!q) return mentionItems;
    return mentionItems.filter((e) => e.name.toLowerCase().includes(q));
  }, [mentionItems, mentionQuery]);

  const resumeFiltered = useMemo(() => {
    const q = resumeQuery.trim().toLowerCase();
    if (!q) return resumeSessions;
    return resumeSessions.filter((s) =>
      [s.title, s.cwd, s.engine, s.model, s.id]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [resumeSessions, resumeQuery]);

  // keep the /resume highlight in-bounds as the typed filter shrinks the list
  useEffect(() => {
    if (overlay !== "resume") return;
    setOverlayIdx((i) =>
      resumeFiltered.length === 0 ? 0 : Math.min(i, resumeFiltered.length - 1),
    );
  }, [resumeFiltered.length, overlay]);

  const pickSlash = useCallback(
    (cmd: SlashCommand) => {
      cmd.run();
    },
    [],
  );

  const pickMention = useCallback(
    (entry: DirEntry) => {
      const insert = entry.is_dir ? `${entry.name}/` : entry.name;
      setInput((v) => v.replace(/(^|\s)@([^\s]*)$/, `$1@${insert} `));
      setOverlay(null);
      taRef.current?.focus();
    },
    [],
  );

  const closeResume = useCallback(() => {
    setOverlay(null);
    setResumeQuery("");
    taRef.current?.focus();
  }, []);

  // keyboard for the /resume picker (driven from its own search input)
  const onResumeKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      const list = resumeFiltered;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOverlayIdx((i) => (list.length ? (i + 1) % list.length : 0));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setOverlayIdx((i) =>
          list.length ? (i - 1 + list.length) % list.length : 0,
        );
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (list.length) resumeSession(list[overlayIdx] ?? list[0]);
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeResume();
      }
    },
    [resumeFiltered, overlayIdx, resumeSession, closeResume],
  );

  // ── keyboard ─────────────────────────────────────────────────────────────────
  const activeRun = streaming || backendBusy;

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // overlay navigation takes priority. (the /resume picker drives its own
    // keyboard from its search input — see onResumeKeyDown — so it's excluded
    // here; this branch handles the inline slash + @ overlays.)
    if (overlay && overlay !== "resume") {
      const list = overlay === "slash" ? slashFiltered : mentionFiltered;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setOverlayIdx((i) => (list.length ? (i + 1) % list.length : 0));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setOverlayIdx((i) =>
          list.length ? (i - 1 + list.length) % list.length : 0,
        );
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOverlay(null);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        if (list.length) {
          e.preventDefault();
          if (overlay === "slash") pickSlash(slashFiltered[overlayIdx]);
          else pickMention(mentionFiltered[overlayIdx]);
          return;
        }
      }
    }
    // Pending steer list behaves like the slash menu: arrows choose a queued
    // follow-up, then Enter injects the highlighted row into a live codex turn.
    if (streaming && input.trim() === "" && queued.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setQueuedIdx((idx) =>
          cycleQueueSelection(idx, queued.length, e.key === "ArrowDown" ? 1 : -1),
        );
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const item = queued[queuedIdx] ?? queued[0];
        if (item) steerQueued(item.id);
        return;
      }
    }
    if (e.key === "ArrowDown" && !overlay) {
      const now = e.timeStamp || performance.now();
      if (now - lastArrowDownRef.current < 360) {
        e.preventDefault();
        lastArrowDownRef.current = 0;
        jumpToLatest();
        return;
      }
      lastArrowDownRef.current = now;
    }
    // copilot-style ghost accept: Tab, or → when the caret is at the very end.
    if (!overlay && ghostRef.current) {
      const ta = taRef.current;
      const atEnd = ta != null && ta.selectionStart === input.length && ta.selectionStart === ta.selectionEnd;
      if (e.key === "Tab" || (e.key === "ArrowRight" && atEnd)) {
        e.preventDefault();
        acceptGhost();
        return;
      }
    }
    // ↑ on an EMPTY composer recalls the last sent message for quick edit/resend
    // (TUI staple). Empty-only so it never fights normal cursor movement.
    if (
      e.key === "ArrowUp" &&
      !overlay &&
      input.trim() === "" &&
      lastSentRef.current
    ) {
      e.preventDefault();
      const recalled = lastSentRef.current;
      setInput(recalled);
      requestAnimationFrame(() => {
        const ta = taRef.current;
        if (ta) {
          ta.focus();
          ta.setSelectionRange(recalled.length, recalled.length);
        }
      });
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      // mid-turn Enter is explicit: codex + claude steer the active turn (soft
      // inject); ⌥⏎ / ⌃⏎ interrupts and redirects instead (drop the turn, pivot
      // to this message). Other engines just queue for the next turn.
      if (activeRun) {
        const canSteer = model.engine === "codex" || model.engine === "claude";
        if (canSteer && (e.altKey || e.ctrlKey)) interruptAndRedirect();
        else if (canSteer) steerDraft();
        else enqueue(input);
      }
      else send();
    }
  };

  // Pane-level double-tap ↓ → jump to bottom + re-latch autoscroll. The composer
  // textarea handles its own double-tap (see onKeyDown) so it can also recall the
  // last message on a single ↑; here we cover the REST of the pane (transcript,
  // tool cards, focus on the pane root) so ↓↓ works anywhere. Skip when focus is
  // in any editable field so it never fights cursor movement / a search input.
  const onPaneKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== "ArrowDown") return;
      const t = e.target as HTMLElement | null;
      if (t === taRef.current) return; // composer owns its own ↓↓
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.isContentEditable)
      ) {
        return;
      }
      const stamp = e.timeStamp || performance.now();
      if (stamp - lastArrowDownRef.current < 360) {
        e.preventDefault();
        lastArrowDownRef.current = 0;
        jumpToLatest();
        return;
      }
      lastArrowDownRef.current = stamp;
    },
    [jumpToLatest],
  );

  const hasDraft = input.trim().length > 0;
  const hasReadyImages = images.some((im) => im.path);
  const action = sendContract({
    streaming: activeRun,
    hasDraft,
    hasImages: hasReadyImages,
    engine: model.engine ?? "claude",
    started,
  });
  const contextChips = composerContextChips({
    cwd,
    modelLabel: model.label,
    effortLabel: effortChipLabel(effort.id, effort.label, model.engine ?? "claude"),
    permissionLabel: permission.label,
    engine: model.engine ?? "claude",
    contextBudget: effectiveBudget,
    queuedCount: queued.length,
    imageCount: images.length,
    planMode,
    hasGoal: Boolean(goal.trim()),
  });
  // model · effort · access · context now live as interactive pills in the
  // action row, so the passive summary row drops them — it carries only ambient
  // context (cwd) + transient state (images, queue, plan, goal). `engine` is also
  // dropped: the model pill already names the backend ("sonnet 4.6" ⇒ claude), so
  // a standalone ">_ claude" tag was pure redundancy.
  const summaryChips = contextChips.filter(
    (chip) => !CONTROL_CHIP_IDS.has(chip.id) && chip.id !== "engine",
  );
  void summaryChips; // deck redesign: plan/goal ride as armed strips; the rest live in the rail/tray

  // ── deck telemetry (W4 composer redesign) ──────────────────────────────────
  // working clock — "● working · 0:42" in the rail while a run is live (D).
  const [workClock, setWorkClock] = useState(0);
  useEffect(() => {
    if (!activeRun) {
      setWorkClock(0);
      return;
    }
    const t0 = Date.now();
    setWorkClock(0);
    const iv = setInterval(() => setWorkClock(Date.now() - t0), 1000);
    return () => clearInterval(iv);
  }, [activeRun]);
  // context meter for the filament (A: the deck's top edge IS the ctx meter;
  // the numbers live in its hover card). Same window map + accuracy guard the
  // old stats-row chip used (observed > nominal → trust the 1M beta).
  const ctxMeter = useMemo(() => {
    if (ctxTokens == null || ctxTokens <= 0) return null;
    let win = model.id.startsWith("claude-opus")
      ? 1_000_000
      : model.engine === "codex"
        ? 272_000
        : model.engine === "opencode"
          ? 256_000
          : 200_000;
    if (ctxTokens > win) win = 1_000_000;
    const pct = Math.min(100, Math.round((ctxTokens / win) * 100));
    return { win, pct };
  }, [ctxTokens, model.id, model.engine]);
  const contextBuckets = contextLedger({
    draft: input,
    goal,
    planMode,
    memoryCount: attachedMemories.length,
    imageCount: images.length,
    queuedCount: queued.length,
    contextBudget: effectiveBudget,
  });
  const estimatedContextTokens = contextBuckets.reduce((sum, bucket) => sum + bucket.tokens, 0);
  const contextLedgerWarning = contextBuckets.some((bucket) => bucket.level === "warning");
  const runPhase = runEventState.phase;
  const runEventCount = runEventState.events.length;

  // copilot-style ghost: the remainder of the most recent past message that
  // prefixes what's typed. Suppressed while an overlay (slash/@/resume) or voice
  // is active, or on a multi-line draft. Recomputed each keystroke (input dep).
  const ghost = useMemo(() => {
    if (!input || overlay || recording || input.includes("\n")) return "";
    const lc = input.toLowerCase();
    const hit = historyRef.current.find(
      (e) => e.length > input.length && e.toLowerCase().startsWith(lc),
    );
    return hit ? hit.slice(input.length) : "";
  }, [input, overlay, recording]);
  const ghostRef = useRef("");
  ghostRef.current = ghost;
  const acceptGhost = useCallback(() => {
    if (ghostRef.current) setInput((v) => v + ghostRef.current);
  }, []);

  // ── composer (shared between empty hero + docked) ──────────────────────────

  // fresh hero = a bare rail (cwd · model · orb); the full rail blooms in on
  // the first keystroke (sketch plate 12).
  const bareRail = empty && !hasDraft;

  const composer = useMemo(
    () => (
      <div className="relative">
        {/* (the summary-chip row retired with the deck redesign: plan/goal ride
            as ARMED STRIPS inside the deck, cwd/model/attachments live in the
            rail + tray, the run phase is the rail's working chip.) */}
        {(!empty || hasDraft) && (
        <div
          className={`mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 font-mono text-[10px] ${
            empty ? "fade-in-up " : ""
          }${contextLedgerWarning ? "text-[var(--color-warning)]" : "text-[var(--color-faint)]"}`}
          title="estimated tokens added by the next send; exact billing comes from provider usage"
        >
          <span><NumberTicker value={estimatedContextTokens} /> est tok</span>
          {/* a single bucket equals the total — listing it was pure noise */}
          {contextBuckets.length > 1 &&
            contextBuckets.map((bucket) => (
              <span
                key={bucket.id}
                className={bucket.level === "warning" ? "text-[var(--color-warning)]" : undefined}
              >
                {bucket.label}:{bucket.tokens.toLocaleString()}
              </span>
            ))}
        </div>
        )}

        {memoryPanelOpen && (
          <div className="mb-2 flex max-h-36 flex-col gap-1 overflow-y-auto rounded-md border border-[var(--color-border)] bg-[var(--color-panel)]/80 p-1.5">
            <div className="flex items-center justify-between px-1 pb-1">
              <span className="flex items-center gap-1.5 text-[11px] font-medium text-[var(--color-text-2)]">
                <Brain size={12} className="text-[var(--color-accent)]" />
                memory
              </span>
              <button
                type="button"
                onClick={() => setMemoryPanelOpen(false)}
                className="rounded p-0.5 text-[var(--color-muted)] hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
                title="close memory search"
              >
                <X size={12} />
              </button>
            </div>
            {input.trim().length < 2 ? (
              <div className="px-2 py-2 text-[11.5px] text-[var(--color-muted)]">type to search memory</div>
            ) : memoryHits.length === 0 ? (
              <div className="px-2 py-2 text-[11.5px] text-[var(--color-muted)]">no memory matches</div>
            ) : (
              memoryHits.slice(0, 5).map((hit) => {
                const attached = attachedMemoryIds.includes(hit.id);
                return (
                  <button
                    key={hit.id}
                    type="button"
                    onClick={() =>
                      setAttachedMemoryIds((ids) =>
                        attached ? ids.filter((id) => id !== hit.id) : [...ids, hit.id],
                      )
                    }
                    className={`flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left font-sans text-[11.5px] transition-colors ${
                      attached
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-text)]"
                        : "text-[var(--color-text-2)] hover:bg-[var(--color-panel-2)]"
                    }`}
                    title={hit.reasons.join("; ")}
                  >
                    <Brain size={12} className="shrink-0 text-[var(--color-accent)]" />
                    <span className="min-w-0 flex-1 truncate">
                      {hit.title}{" "}
                      <span className="text-[var(--color-faint)]">· {hit.description || hit.preview}</span>
                    </span>
                    <span className="shrink-0 rounded border border-[var(--color-border)] px-1 py-0.5 font-mono text-[9px] text-[var(--color-faint)]">
                      {attached ? "attached" : hit.score}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        )}

        {handoffPanelOpen && (() => {
          // Targets = the LIVE model catalog (same list the composer's model menu
          // shows), minus the current model — you don't hand off to yourself.
          // Grouped by engine so the API tier reads clearly next to the CLIs.
          const currentKey = modelKey(model);
          const targets = [...pickerModels, ...apiModels].filter((m) => modelKey(m) !== currentKey);
          const groups: Array<[string, ChatModel[]]> = [];
          for (const m of targets) {
            const g = m.engine ?? "claude";
            const bucket = groups.find(([k]) => k === g);
            if (bucket) bucket[1].push(m);
            else groups.push([g, [m]]);
          }
          const runHandoff = (target: ChatModel) => {
            if (target.disabled) return;
            setHandoffPanelOpen(false);
            void sendText(buildHandoffPrompt(target, { delivery: handoffDelivery, cwd }));
          };
          const copyHandoff = (target: ChatModel) => {
            const text = buildHandoffPrompt(target, { delivery: handoffDelivery, cwd });
            const key = modelKey(target);
            navigator.clipboard
              ?.writeText(text)
              .then(() => {
                setHandoffCopied(key);
                window.setTimeout(() => setHandoffCopied((c) => (c === key ? null : c)), 1500);
              })
              .catch((e) => reportDiag("chat.handoff", e, { action: "copy" }));
          };
          const DELIVERY: Array<{ id: HandoffDelivery; label: string; hint: string }> = [
            { id: "chat", label: "into chat", hint: "the current model writes the handoff here" },
            { id: "file", label: "to HANDOFF.md", hint: "written to a file in the working directory" },
          ];
          return (
          <div className="mb-2 flex max-h-64 flex-col overflow-y-auto rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] py-1 shadow-[var(--osai-shadow-pop)]">
            <div className="flex items-center justify-between px-3 pb-1 pt-1">
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
                <PackageOpen size={11} className="text-[var(--color-accent)]" />
                hand off to
              </span>
              <button
                type="button"
                onClick={() => setHandoffPanelOpen(false)}
                className="grid h-5 w-5 place-items-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                title="close handoff targets"
              >
                <X size={12} />
              </button>
            </div>
            {/* delivery mode — segmented control, matching the model menu's effort
                toggle so the surface reads as native. */}
            <div className="mx-2 mb-1 flex gap-[3px] rounded-[9px] border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_60%,transparent)] p-[3px]">
              {DELIVERY.map((d) => {
                const on = handoffDelivery === d.id;
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setHandoffDelivery(d.id)}
                    title={d.hint}
                    className={`flex-1 rounded-md px-2 py-[3px] text-center font-sans text-[10.5px] transition-colors ${
                      on
                        ? "bg-[var(--color-accent-soft)] text-[var(--color-text)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
                        : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    }`}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            {targets.length === 0 && (
              <div className="px-3 py-2 font-sans text-[11.5px] text-[var(--color-faint)]">
                no other models available — connect a provider in settings.
              </div>
            )}
            {groups.map(([engine, models], gi) => (
              <div key={engine} className="flex flex-col">
                <div
                  className={`px-3 pb-1 pt-2 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)] ${
                    gi > 0 ? "mt-1 border-t border-[var(--color-border)]" : ""
                  }`}
                >
                  {engineGroupLabel(engine)}
                </div>
                {models.map((target) => {
                  const key = modelKey(target);
                  const win = contextWindowFor(target);
                  return (
                    <div
                      key={key}
                      className="group/handoff relative mx-2 flex min-w-0 items-center gap-1 rounded-lg pr-1 text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                    >
                      {/* left accent bar on hover — the MenuItem lit affordance */}
                      <span
                        aria-hidden
                        className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-[linear-gradient(180deg,var(--color-accent),var(--osai-accent-2))] opacity-0 shadow-[var(--osai-glow-soft)] transition-opacity group-hover/handoff:opacity-100"
                      />
                      <button
                        type="button"
                        disabled={target.disabled}
                        onClick={() => runHandoff(target)}
                        className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-1.5 text-left font-sans text-[12px] disabled:cursor-not-allowed disabled:opacity-45"
                        title={target.note ?? `hand off to ${target.label} · ~${formatTokens(win)} context`}
                      >
                        <span
                          className="h-[6px] w-[6px] shrink-0 rounded-full"
                          style={{ background: engineDotColor(target.engine) }}
                        />
                        <span className="min-w-0 flex-1 truncate">{target.label}</span>
                        <span className="shrink-0 font-mono text-[9px] text-[var(--color-faint)]">
                          {formatTokens(win)}
                        </span>
                      </button>
                      <button
                        type="button"
                        disabled={target.disabled}
                        onClick={() => copyHandoff(target)}
                        title="copy the handoff prompt"
                        className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-[var(--color-muted)] opacity-0 transition-opacity hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)] group-hover/handoff:opacity-100 disabled:hidden"
                      >
                        {handoffCopied === key ? (
                          <Check size={12} className="text-[var(--color-success)]" />
                        ) : (
                          <Copy size={12} />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          );
        })()}

        {/* slash / @-mention overlay — opens downward on the hero (the
            composer sits near the top there; upward clipped, user-reported) */}
        {overlay === "slash" && slashFiltered.length > 0 && (
          <OverlayPanel compact drop={empty ? "down" : "up"}>
            {slashFiltered.map((c, i) => (
              <OverlayRow
                key={c.id}
                active={i === overlayIdx}
                onMouseEnter={() => setOverlayIdx(i)}
                onClick={() => pickSlash(c)}
                icon={c.icon}
                label={c.label}
                desc={c.desc}
              />
            ))}
          </OverlayPanel>
        )}
        {overlay === "mention" && (
          <OverlayPanel drop={empty ? "down" : "up"}>
            {!cwd ? (
              <div className="px-3 py-2 font-mono text-[11.5px] text-[var(--color-faint)]">
                no working directory for this pane
              </div>
            ) : mentionFiltered.length === 0 ? (
              <div className="px-3 py-2 font-mono text-[11.5px] text-[var(--color-faint)]">
                no matches in {baseName(cwd)}
              </div>
            ) : (
              mentionFiltered
                .slice(0, 50)
                .map((e, i) => (
                  <OverlayRow
                    key={e.path}
                    active={i === overlayIdx}
                    onMouseEnter={() => setOverlayIdx(i)}
                    onClick={() => pickMention(e)}
                    icon={
                      e.is_dir ? (
                        <Folder size={14} className="text-[var(--color-accent)]" />
                      ) : (
                        <FileText size={14} className="text-[var(--color-muted)]" />
                      )
                    }
                    label={e.name}
                    desc={e.is_dir ? "dir" : ""}
                    mono
                  />
                ))
            )}
          </OverlayPanel>
        )}
        {overlay === "resume" && (
          <ResumePicker
            drop={empty ? "down" : "up"}
            sessions={resumeFiltered}
            total={resumeSessions.length}
            loading={resumeLoading}
            query={resumeQuery}
            activeIdx={overlayIdx}
            currentSessionId={openSessionId}
            searchRef={resumeSearchRef}
            onQueryChange={setResumeQuery}
            onKeyDown={onResumeKeyDown}
            onPick={resumeSession}
            onClose={closeResume}
          />
        )}

        {/* pending steer queue belongs with the composer in every layout. first
            Enter queues, arrows highlight, explicit steer injects when possible. */}
        {queued.length > 0 && (
          <div className="mb-2 overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] shadow-xl shadow-black/20">
            {queued.map((q, i) => (
              <div
                key={q.id}
                onMouseEnter={() => setQueuedIdx(i)}
                className={`flex items-center gap-2 px-3 py-2 font-sans text-[12px] text-[var(--color-text-2)] ${
                  i === queuedIdx ? "bg-[var(--color-accent-soft)]" : "hover:bg-[var(--color-panel)]"
                }`}
              >
                <Clock size={12} className="shrink-0 text-[var(--color-faint)]" />
                {editingQueuedId === q.id ? (
                  <input
                    value={editingQueuedText}
                    onChange={(e) => setEditingQueuedText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        saveQueuedEdit();
                      }
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setEditingQueuedId(null);
                        setEditingQueuedText("");
                      }
                    }}
                    onBlur={saveQueuedEdit}
                    autoFocus
                    className="min-w-0 flex-1 rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-1 text-[12px] text-[var(--color-text)] outline-none focus:border-[var(--color-accent)]"
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate">{q.text}</span>
                )}
                {/* the head of the queue is a promise — say it ("sends next"),
                    not just a generic "queued" on every row */}
                <span className="shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
                  {i === 0 ? "sends next" : `queued #${i + 1}`}
                </span>
                {editingQueuedId === q.id ? (
                  <button
                    type="button"
                    onClick={saveQueuedEdit}
                    className="shrink-0 rounded p-0.5 text-[var(--color-accent)] hover:bg-[var(--color-panel)]"
                    title="save"
                  >
                    <Check size={12} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => editQueued(q)}
                    className="shrink-0 rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    title="edit queued message"
                  >
                    <Pencil size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => moveQueued(q.id, -1)}
                  disabled={i === 0}
                  className="shrink-0 rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
                  title="move up"
                >
                  <ArrowUp size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => moveQueued(q.id, 1)}
                  disabled={i === queued.length - 1}
                  className="shrink-0 rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)] disabled:opacity-30"
                  title="move down"
                >
                  <ArrowDown size={12} />
                </button>
                {model.engine === "codex" && streaming && (
                  <button
                    type="button"
                    onClick={() => steerQueued(q.id)}
                    className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)] hover:bg-[var(--color-panel)]"
                    title="inject into current turn"
                  >
                    steer
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeQueued(q.id)}
                  className="shrink-0 rounded p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
                  title="remove from queue (won't send)"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={`flash-composer glass-strong glow-focus relative rounded-2xl transition-all duration-200 ${streaming ? "glow-live" : ""}`}>
          {/* the context FILAMENT (decision A) — the deck's top edge is the
              live context meter: fills with usage, warms past ~80%, sweeps
              while streaming. Hover the edge for the Context Window card. */}
          <Filament
            pct={ctxMeter ? ctxMeter.pct / 100 : 0}
            live={streaming}
            label={ctxMeter ? `context · ${formatTokens(ctxTokens ?? 0)} used · ${ctxMeter.pct}%` : "context meter — fills as the window fills"}
            card={
              ctxMeter ? (
                <>
                  <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-muted)]">
                    context window
                    <span className="text-[var(--color-text-2)]">{ctxMeter.pct}%</span>
                  </span>
                  <span className="h-1.5 overflow-hidden rounded-full bg-[var(--color-panel-2)]">
                    <span
                      className="block h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--osai-accent-2))]"
                      style={{ width: `${Math.max(2, ctxMeter.pct)}%` }}
                    />
                  </span>
                  <span className="flex justify-between font-mono text-[10.5px] text-[var(--color-text-2)]">
                    <span>{(ctxTokens ?? 0).toLocaleString()} used</span>
                    <span>{ctxMeter.win.toLocaleString()} total</span>
                  </span>
                  <span className="truncate font-mono text-[10px] text-[var(--color-faint)]">
                    model · {model.id}
                  </span>
                  {turnBurnPct != null && turnBurnPct >= 0.05 && (
                    <span className="font-mono text-[10px] text-[var(--color-faint)]">
                      ≈{turnBurnPct < 1 ? turnBurnPct.toFixed(1) : Math.round(turnBurnPct)}% of the 5h window per turn
                    </span>
                  )}
                </>
              ) : undefined
            }
          />
          {/* (the BorderBeam retired with the deck redesign — its beam path
              was a rectangle that ignored the rounded corners, and the
              FILAMENT is the deck's living edge now. Owner-reported.) */}
          {/* ── armed strips ── the receipt for anything riding the next send
              (plan-first · goal · live run) — replaces the floating chip row. */}
          {planMode && (
            <ArmedStrip
              icon={<ListChecks size={12} />}
              onClear={() => setPlanMode(false)}
              clearTitle="cancel plan mode"
            >
              <b className="font-semibold">plan-first</b> — will propose a plan and wait for your go-ahead
            </ArmedStrip>
          )}
          {goal.trim() && (
            <ArmedStrip icon={<Target size={12} />} onClear={() => setGoal("")} clearTitle="clear goal">
              <b className="font-semibold">goal</b> — {goal}
            </ArmedStrip>
          )}
          {/* (the live "run: {phase}" strip was removed — it duplicated the
              activity header's phase, which already shows the same live state
              right above the composer. One source of truth, less chrome.) */}
          {/* ── attachment tray ── images (click to preview before sending),
              quoted text snippets, and attached memories — one consistent row. */}
          {(images.length > 0 || snippets.length > 0 || attachedMemories.length > 0) && (
            <div className="flex flex-wrap items-center gap-2 px-3 pt-3">
              {images.map((im) => (
                <TiltCard key={im.id} className="rounded-xl" max={10}>
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setPreviewImage(im)}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setPreviewImage(im); }}
                    title="click to preview before sending"
                    className="group relative h-16 w-16 cursor-zoom-in overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel)] transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={im.url} alt="attachment" className="h-full w-full object-cover" />
                    {im.path == null && (
                      <div className="absolute inset-0 grid place-items-center bg-[var(--color-bg)]/60">
                        <Loader2 size={14} className="animate-spin text-[var(--color-accent)]" />
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); removeImage(im.id); }}
                      title="remove"
                      className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--color-bg)]/85 text-[var(--color-muted)] opacity-0 transition-opacity hover:text-[var(--color-text)] focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <X size={11} />
                    </button>
                  </div>
                </TiltCard>
              ))}
              {snippets.map((s) => (
                <span
                  key={s.id}
                  className="fade-in-up inline-flex max-w-[230px] items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)]/60 px-2.5 py-1.5 font-sans text-[11.5px] text-[var(--color-text-2)] backdrop-blur"
                  title={s.text}
                >
                  <Quote size={12} className="shrink-0 text-[var(--color-accent)]" />
                  <span className="truncate">{s.text.replace(/\s+/g, " ").slice(0, 42)}</span>
                  <button
                    type="button"
                    onClick={() => setSnippets((prev) => prev.filter((x) => x.id !== s.id))}
                    className="ml-0.5 rounded-full p-0.5 text-[var(--color-muted)] hover:text-[var(--color-text)]"
                    title="remove this quote"
                  >
                    <X size={11} />
                  </button>
                </span>
              ))}
              {attachedMemories.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)]/60 px-2.5 py-1.5 font-sans text-[11.5px] text-[var(--color-text-2)] backdrop-blur">
                  <Brain size={12} className="shrink-0 text-[var(--color-accent)]" />
                  <span className="truncate">{attachedMemories.length} memories attached</span>
                </span>
              )}
            </div>
          )}
          <input
            ref={imgInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = e.target.files;
              if (files) for (const f of files) void addImage(f, f.type);
              e.target.value = "";
            }}
          />
          {/* background-agent dock — persistent live fleet for run_in_background
              agents that keep working after the reply landed (replaces the old
              one-line pill; the transcript stays out of it). */}
          <FleetDock agents={fleet.dock} />
          {voiceNote && (
            <button
              type="button"
              onClick={() => setVoiceNote(null)}
              className="flex w-full items-center gap-1.5 px-4 pt-2 text-left font-mono text-[11px] text-[var(--color-danger)]"
              title="dismiss"
            >
              <AlertTriangle size={11} className="shrink-0" />
              <span className="min-w-0 truncate">{voiceNote}</span>
            </button>
          )}
          {recording ? (
            <div className="flex items-center gap-3 px-4 pt-4 pb-2">
              <div className="flex h-7 flex-1 items-center gap-[3px] overflow-hidden">
                {WAVEFORM_BARS.map((b, i) => (
                  <span
                    key={i}
                    className="w-[3px] shrink-0 origin-center rounded-full bg-[var(--color-accent)]"
                    style={{
                      height: `${b.h}%`,
                      animation: "osai-wave 0.9s ease-in-out infinite",
                      animationDelay: `${b.delay}ms`,
                    }}
                  />
                ))}
              </div>
              <span className="font-mono text-[12px] tabular-nums text-[var(--color-text)]">
                {fmtElapsed(voiceElapsed)}
              </span>
              <button
                type="button"
                onClick={() => void micStop()}
                title="stop dictation (esc to cancel)"
                className="grid h-8 w-8 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-bg)] transition-colors hover:bg-[var(--color-accent-hover)]"
              >
                <Square size={14} className="fill-current" />
              </button>
            </div>
          ) : (
            <div className="relative">
              {/* copilot-style ghost suggestion: a mirror layer behind the
                  textarea reserves the typed text (transparent) then renders the
                  remaining suggestion dimmed, so it lines up exactly after the
                  caret. Tab / → accepts. Same box model as the textarea. */}
              {ghost && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words px-4 pt-2.5 pb-1.5 font-sans text-[13.5px] leading-relaxed text-transparent"
                >
                  {input}
                  <span className="text-[var(--color-faint)]">{ghost}</span>
                </div>
              )}
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => onChangeInput(e.target.value)}
                onKeyDown={onKeyDown}
                onPaste={onPasteImage}
                rows={1}
                placeholder={
                  streaming
                    ? model.engine === "codex"
                      ? "steer the model… (won't interrupt)"
                      : model.engine === "claude"
                        ? `steer the model… ⏎ inject · ${ALT}⏎ interrupt & redirect`
                        : "queue a follow-up…"
                    : planMode
                      ? "describe the task to plan…"
                      : "ask, or describe a task — / for commands, @ for files"
                }
                spellCheck={false}
                className="relative block w-full resize-none bg-transparent px-4 pt-2.5 pb-1.5 font-sans text-[13.5px] leading-relaxed text-[var(--color-text)] placeholder:text-[var(--color-faint)] focus:outline-none"
              />
            </div>
          )}
          {/* zoned divider — a lit hairline separating the input hero from the
              control bar (Neon Glass composer layout "01 · Zoned"). */}
          <div className="mx-3 h-px bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--color-accent)_28%,transparent)] to-transparent" />
          {/* THE RAIL (deck redesign) — context on the left (folder · shield ·
              plan · goal), action on the right (attach · mic · model · orb).
              Nothing scrolls; the fresh hero shows a bare rail (cwd + model +
              orb) until the first keystroke blooms the rest in. */}
          <div className="flex items-center gap-1 px-2.5 pt-1.5 pb-2">
            <div className={`flex min-w-0 items-center gap-1 ${empty ? "stagger" : ""}`}>
            {/* working directory — the folder the agent reads + acts in. Click
                to browse/pick a new one; switching it restarts the session there
                (an engine's cwd is fixed at process start). Hidden in the hosted
                web build (no local filesystem / no onChangeCwd). */}
            {onChangeCwd && nativeRuntime && (
              <Dropdown
                open={openMenu === "cwd"}
                onToggle={() => setOpenMenu(openMenu === "cwd" ? null : "cwd")}
                align="left"
                triggerClassName={openMenu === "cwd" ? CTRL_PILL_OPEN : CTRL_PILL}
                label={`working directory — ${cwd ?? "not set"}`}
                trigger={
                  <>
                    <Folder size={12} className="shrink-0 text-[var(--color-muted)]" />
                    <span className="max-w-[140px] truncate whitespace-nowrap">
                      {cwd ? baseName(cwd) : "set folder"}
                    </span>
                    <ChevronDown size={11} className="text-[var(--color-faint)]" />
                  </>
                }
              >
                <CwdPicker cwd={cwd ?? null} onPick={changeCwd} />
              </Dropdown>
            )}
            {/* the SHIELD (decision C) — access mode + context budget behind
                one icon whose form mirrors the choice: check = bypass, half =
                accept-edits, outline = ask, cyan = plan-only. */}
            {!bareRail && (
              <Dropdown
                open={openMenu === "perm"}
                onToggle={() => setOpenMenu(openMenu === "perm" ? null : "perm")}
                align="left"
                triggerClassName={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${
                  openMenu === "perm"
                    ? "border border-[color-mix(in_srgb,var(--color-accent)_55%,transparent)] bg-[var(--color-accent-soft)]"
                    : "border border-transparent hover:bg-[var(--color-panel)]"
                }`}
                label={`access — ${permission.label} · context — ${effectiveBudget}`}
                trigger={
                  permission.id === "bypassPermissions" ? (
                    <ShieldCheck size={14} className="text-[var(--color-accent)]" />
                  ) : permission.id === "acceptEdits" ? (
                    <ShieldHalf size={14} className="text-[var(--color-accent)]" />
                  ) : permission.id === "plan" ? (
                    <Shield size={14} style={{ color: "var(--osai-accent-2)" }} />
                  ) : (
                    <Shield size={14} className="text-[var(--color-muted)]" />
                  )
                }
              >
                <div className="w-[250px]">
                  <div className="px-3 pb-1 pt-1.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
                    access
                  </div>
                  {PERMISSION_MODES.map((p) => (
                    <MenuItem
                      key={p.id}
                      active={p.id === permission.id}
                      onClick={() => {
                        setPermission(p);
                        saveSettings({ chatAccess: p.id });
                        setOpenMenu(null);
                      }}
                    >
                      <span className="flex flex-col leading-snug">
                        <span>{p.label}</span>
                        {PERMISSION_SUBS[p.id] && (
                          <span className="text-[10.5px] text-[var(--color-faint)]">{PERMISSION_SUBS[p.id]}</span>
                        )}
                      </span>
                    </MenuItem>
                  ))}
                  <div className="mx-2 my-1 h-px bg-[var(--color-border)]" />
                  <div className="px-3 pb-1 pt-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-faint)]">
                    context budget
                  </div>
                  <div className="mx-2 mb-1.5 flex gap-[3px] rounded-[9px] border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-bg)_60%,transparent)] p-[3px]">
                    {CONTEXT_BUDGETS.map((b) => {
                      const on = b.id === effectiveBudget;
                      return (
                        <button
                          key={b.id}
                          type="button"
                          title={b.sub}
                          onClick={() => {
                            setContextBudget(b.id);
                            saveSettings({ chatContextBudget: b.id });
                            if (b.id === "ultracode") {
                              const ultra = EFFORTS.find((ef) => ef.ultra);
                              if (ultra) {
                                setEffort(ultra);
                                saveSettings({ chatEffort: ultra.id });
                              }
                            } else if (effort.ultra) {
                              setEffort(EFFORTS[1]);
                              saveSettings({ chatEffort: EFFORTS[1].id });
                            }
                            setOpenMenu(null);
                          }}
                          className={`flex-1 rounded-md px-0.5 py-[3px] text-center font-sans text-[10.5px] transition-colors ${
                            on
                              ? b.id === "ultracode"
                                ? "bg-[linear-gradient(135deg,color-mix(in_srgb,var(--color-accent)_30%,transparent),color-mix(in_srgb,var(--osai-accent-2)_25%,transparent))] text-[var(--color-text)]"
                                : "bg-[var(--color-accent-soft)] text-[var(--color-text)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
                              : "text-[var(--color-muted)] hover:text-[var(--color-text)]"
                          }`}
                        >
                          {b.id === "ultracode" ? (
                            <span className="inline-flex items-center gap-0.5">
                              <Sparkles size={9} />
                              ultra
                            </span>
                          ) : (
                            b.label
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </Dropdown>
            )}
            {/* plan-first + goal as icon toggles — the armed strip above the
                input is their receipt. */}
            {!bareRail && (
              <button
                type="button"
                onClick={() => setPlanMode((v) => !v)}
                title={planMode ? "plan-first armed — click to disarm" : "plan-first: propose a plan before building"}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${
                  planMode
                    ? "border border-[color-mix(in_srgb,var(--color-accent)_55%,transparent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-[var(--osai-glow-soft)]"
                    : "border border-transparent text-[var(--color-muted)] hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                }`}
              >
                <ListChecks size={13} />
              </button>
            )}
            {!bareRail && (
              <button
                type="button"
                onClick={() => setGoalDraft(goal)}
                title={goal.trim() ? `goal — ${goal}` : "set an ongoing goal (kept across turns)"}
                className={`grid h-7 w-7 shrink-0 place-items-center rounded-full transition-colors ${
                  goal.trim()
                    ? "border border-[color-mix(in_srgb,var(--color-accent)_55%,transparent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] shadow-[var(--osai-glow-soft)]"
                    : "border border-transparent text-[var(--color-muted)] hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                }`}
              >
                <Target size={13} />
              </button>
            )}
            </div>
            {/* RIGHT — action: (compact) · attach · mic · (working) · model pill · orb. */}
            <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* Compact nudge — appears once the context window is past halfway on a
                CLI chat (compaction is a CLI feature; API chats have no /compact).
                Warms toward danger as it fills, so a full window reads as urgent. */}
            {!bareRail && !activeRun && !isApiChat && ctxMeter && ctxMeter.pct >= 50 && (
              <button
                type="button"
                onClick={() => void sendText("/compact")}
                title={`context ${ctxMeter.pct}% full — compact to summarize + free the window`}
                className={`flex h-7 shrink-0 items-center gap-1 rounded-full border px-2 font-mono text-[9.5px] transition-colors ${
                  ctxMeter.pct >= 80
                    ? "border-[color-mix(in_srgb,var(--color-danger)_55%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_16%,transparent)] text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_26%,transparent)]"
                    : "border-[color-mix(in_srgb,var(--color-warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-warning)_12%,transparent)] text-[var(--color-warning)] hover:bg-[color-mix(in_srgb,var(--color-warning)_22%,transparent)]"
                }`}
              >
                <Minimize2 size={12} />
                compact · {ctxMeter.pct}%
              </button>
            )}
            {!bareRail && !activeRun && (
              <button
                type="button"
                onClick={() => imgInputRef.current?.click()}
                title="attach image"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
              >
                <ImageIcon size={13} />
              </button>
            )}
            {!bareRail && !activeRun && (
              <button
                type="button"
                onClick={() => void micStart()}
                title={`dictate (${chord("J")})`}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
              >
                <Mic size={13} />
              </button>
            )}
            {/* the working chip (decision D) — the run's clock lives in the
                rail where attach/mic sat, for exactly the run's duration. */}
            {activeRun && (
              <span className="flex h-7 shrink-0 items-center gap-1.5 rounded-full bg-[color-mix(in_srgb,var(--color-panel-2)_45%,transparent)] px-2.5 font-mono text-[9.5px] text-[var(--color-muted)]">
                <span className="h-[6px] w-[6px] rounded-full bg-[var(--color-accent)] shadow-[var(--osai-glow-soft)]" />
                working · {fmtClock(workClock)}
              </span>
            )}
            {/* the model pill (decision B) — engine dot · name · effort ticks.
                Its menu = short-by-default + type-to-dig + manage (M1+M3). */}
            <Dropdown
              open={openMenu === "model"}
              onToggle={() => setOpenMenu(openMenu === "model" ? null : "model")}
              align="right"
              triggerClassName={openMenu === "model" ? CTRL_PILL_OPEN : CTRL_PILL_MODEL}
              label={`model — ${model.label} · effort — ${effort.label}`}
              trigger={
                <>
                  <span
                    className="h-[6px] w-[6px] shrink-0 rounded-full"
                    style={{
                      background: engineDotColor(model.engine),
                      boxShadow: `0 0 6px color-mix(in srgb, ${engineDotColor(model.engine)} 70%, transparent)`,
                    }}
                  />
                  <span className="max-w-[130px] truncate font-medium whitespace-nowrap">{model.label}</span>
                  <EffortTicks effortId={effort.id} ultra={effort.ultra} />
                  <ChevronDown size={11} className="text-[var(--color-faint)]" />
                </>
              }
            >
              <ModelMenu
                models={[...pickerModels, ...apiModels]}
                currentId={model.id}
                currentEngine={model.engine ?? "claude"}
                recents={recentModels}
                hidden={hiddenModels}
                effort={effort}
                efforts={EFFORTS}
                onEffort={(ef) => {
                  const full = EFFORTS.find((e) => e.id === ef.id);
                  if (!full) return;
                  setEffort(full);
                  saveSettings({ chatEffort: full.id });
                }}
                onToggleHidden={toggleHiddenModel}
                onPick={(m) => {
                  // Mid-conversation model switch: RESUME the live conversation
                  // under the new model instead of starting a fresh session. The
                  // session effect keys on model.id, so setModel restarts it; if
                  // we don't hand it the resume id, the restart spawns a brand-new
                  // engine session with its own durable log — which self-heal then
                  // surfaces as a SECOND History row for the same thread (the
                  // reported "changing model splits the conversation"). Mirrors
                  // retryWithModel: set resumeId first so both setState calls batch
                  // into one resuming restart that keeps context + one history
                  // entry. Only when there's a live conversation to continue.
                  if (m.id !== model.id && claudeSessionIdRef.current != null) {
                    setResumeId(claudeSessionIdRef.current);
                  }
                  setModel(m);
                  // Picking a model sets the global default (sticks across
                  // panes + restarts). For API providers we persist the bare
                  // provider id (the model-init restores it; the CLI helpers
                  // fall back gracefully) and leave defaultAi — the "send to
                  // AI" route — untouched since it's CLI-only.
                  if (isApiProviderId(m.engine)) {
                    saveSettings({ chatModel: m.id, chatProvider: m.engine });
                  } else {
                    const provider = `${m.engine ?? "claude"}-cli`;
                    saveSettings({
                      chatModel: m.id,
                      chatProvider: provider,
                      defaultAi: defaultAiForProvider(provider),
                    });
                  }
                  pushRecentModel(modelKey(m));
                  setOpenMenu(null);
                }}
                renderWindow={(m) => {
                  const win = m.disabled ? null : modelWindowFor(m, pickerWindows);
                  if (!win) return null;
                  return (
                    <span
                      className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-faint)]"
                      title={`this model's own ${win.tag === "7d" ? "weekly" : "5-hour"} window${
                        win.resetsAt ? ` · resets ${resetIn(win.resetsAt)}` : ""
                      }`}
                    >
                      {win.tag} {Math.round(Math.min(Math.max(100 - win.pct, 0), 100))}% left
                    </span>
                  );
                }}
              />
            </Dropdown>
            {!empty && (
              <button
                type="button"
                onClick={() => {
                  setOpenMenu(null);
                  setComposerCollapsed(true);
                }}
                className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
                title="hide composer"
              >
                <ChevronDown size={14} />
              </button>
            )}
            {/* (the wrench tools menu retired — attach + dictate are direct
                rail chips now, and /resume owns resume. Owner-confirmed.) */}
            {voicePhase === "transcribing" ? (
              <div className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-accent)]">
                <Loader2 size={15} className="animate-spin" />
              </div>
            ) : null}

            {/* the ORB — hollow when empty, lit when ready, breathing stop
                ring while a run is live. While running, a quiet steer/queue
                chip carries the draft's contract (⌥/⌃ click = interrupt). */}
            {activeRun ? (
              <>
                {hasDraft && (
                  <button
                    type="button"
                    onClick={(e) => {
                      // ⌥/⌃ click interrupts & redirects (parity with ⌥⏎); a plain
                      // click soft-steers, or queues on engines that can't steer.
                      if (action.mode === "steer") {
                        if (e.altKey || e.ctrlKey) interruptAndRedirect();
                        else steerDraft();
                      } else enqueue(input);
                    }}
                    disabled={action.disabled}
                    className="flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] bg-[var(--color-accent-soft)] px-2.5 font-sans text-[11px] text-[var(--color-text)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] disabled:cursor-not-allowed disabled:opacity-40"
                    title={action.title}
                  >
                    {action.mode === "steer" ? <Waypoints size={12} /> : <Clock size={12} />}
                    {action.label}
                  </button>
                )}
                <SendOrb mode="stop" onClick={stop} title="stop the run" />
              </>
            ) : (
              <SendOrb
                mode={hasDraft && !action.disabled ? "ready" : "idle"}
                disabled={action.disabled}
                title={action.title}
                onClick={send}
              />
            )}
            </div>
          </div>
        </div>
        {/* under-row — the steer contract, only while a run is live. */}
        {streaming && (
          <div className="mt-1.5 flex items-center gap-3.5 px-1.5 font-mono text-[10px] text-[var(--color-faint)]">
            <span className="text-[var(--color-accent)]">streaming</span>
            {(model.engine ?? "claude") === "claude" ? (
              <>
                <span><span className="rounded border border-[var(--color-border)] px-1 text-[var(--color-muted)]">⏎</span> steer into the run</span>
                <span><span className="rounded border border-[var(--color-border)] px-1 text-[var(--color-muted)]">{ALT}⏎</span> interrupt &amp; redirect</span>
              </>
            ) : model.engine === "codex" ? (
              <span><span className="rounded border border-[var(--color-border)] px-1 text-[var(--color-muted)]">⏎</span> steer (won't interrupt)</span>
            ) : (
              <span><span className="rounded border border-[var(--color-border)] px-1 text-[var(--color-muted)]">⏎</span> queue a follow-up</span>
            )}
          </div>
        )}
      </div>
    ),
    // re-render composer on the inputs that affect it
    // (images: chip row + attach-button state)
    [
      input,
      ghost,
      empty,
      openMenu,
      permission,
      effort,
      model,
      ctxTokens,
      images,
      voicePhase,
      voiceNote,
      voiceElapsed,
      streaming,
      backendBusy,
      activeRun,
      action,
      contextChips,
      memoryHits,
      attachedMemoryIds,
      attachedMemories,
      handoffPanelOpen,
      hasDraft,
      empty,
      snippets,
      send,
      stop,
      enqueue,
      queued,
      queuedIdx,
      editingQueuedId,
      editingQueuedText,
      editQueued,
      saveQueuedEdit,
      moveQueued,
      steerQueued,
      steerDraft,
      interruptAndRedirect,
      planMode,
      goal,
      overlay,
      overlayIdx,
      slashFiltered,
      mentionFiltered,
      cwd,
      pickSlash,
      pickMention,
      resumeFiltered,
      resumeSessions.length,
      resumeLoading,
      resumeQuery,
      loadResumeSessions,
      onResumeKeyDown,
      resumeSession,
      closeResume,
      pickerWindows,
      // deck redesign (W4): filament + working chip + armed strips + model menu
      workClock,
      ctxMeter,
      turnBurnPct,
      runPhase,
      runEventCount,
      recentModels,
      hiddenModels,
      toggleHiddenModel,
      pushRecentModel,
      bareRail,
    ],
  );

  // ── render-block segmentation (Codex-style activity grouping) ──────────────
  // Collapse the flat turn list into display blocks: runs of consecutive tool
  // turns fold into ONE activity group ("Worked for Xs ›"); the turn's `result`
  // duration is attached to the last activity group in its segment; the faint
  // tokens/cost footer renders only when that segment had no tool activity (the
  // activity line already shows the duration otherwise). File artifacts written
  // by Write/Edit/NotebookEdit are collected per activity group.
  // Response branching: segment the transcript into response variants (a run of
  // non-user turns between user turns; regenerate appends a fresh run = a variant).
  // ── conversation tree (Tier-3 P2 branching) — mirror declared with `turns` ──
  // (isApiChat is declared up top, right after `model`, to avoid a TDZ from the
  // composer subtree reading it before this point.)
  // Mirror of the committed nodes, read in the effect so the whole computation
  // (incl. consuming the fork token) stays OUTSIDE a setState updater — StrictMode
  // double-invokes updaters, which would eat the fork token.
  const treeNodesRef = useRef<TreeNode<string>[]>([]);
  treeNodesRef.current = treeNodes;
  useEffect(() => {
    if (!isApiChat) return;
    const prev = treeNodesRef.current;
    const turnIds = new Set(turns.map((t) => t.id));
    // A REPLACE (clear / resume) — not all prior nodes still present — rebuilds a
    // linear chain (branch structure isn't persisted yet).
    if (prev.length === 0 || !prev.every((n) => turnIds.has(n.id))) {
      setTreeNodes(
        turns.map((t, i) => ({ id: t.id, parentId: i > 0 ? turns[i - 1]!.id : null, value: t.id })),
      );
      return;
    }
    // APPEND the new turns. Each chains from the active leaf, EXCEPT the first
    // after a regenerate/edit, which forks from the recorded parent (a sibling).
    const known = new Set(prev.map((n) => n.id));
    const fresh = turns.filter((t) => !known.has(t.id));
    if (fresh.length === 0) return;
    const forkParent = pendingForkParentRef.current;
    pendingForkParentRef.current = null;
    const ap = activePath(prev, treeSel);
    let leaf = ap.length > 0 ? ap[ap.length - 1]!.id : null;
    const additions = fresh.map((t, i) => {
      const parent = i === 0 && forkParent != null ? forkParent : leaf;
      leaf = t.id;
      return { id: t.id, parentId: parent, value: t.id };
    });
    setTreeNodes([...prev, ...additions]);
  }, [turns, isApiChat, treeSel]);
  // Render source: the active root→leaf path (API sessions), else `turns` verbatim.
  // For a linear chat the path === turns; after a fork it's the active branch only.
  const treeTurns = useMemo(() => {
    if (!isApiChat) return turns;
    const byId = new Map(turns.map((t) => [t.id, t]));
    return activePath(treeNodes, treeSel)
      .map((n) => byId.get(n.id))
      .filter((t): t is Turn => t != null);
  }, [isApiChat, turns, treeNodes, treeSel]);
  // The active-path turns, for the send (dispatch reads this ref so it isn't a dep).
  const activeTurnsRef = useRef<Turn[]>([]);
  activeTurnsRef.current = treeTurns;
  // Persist the conversation tree (API branching) so branches survive a reload —
  // the durable event log is linear and can't represent the tree. Debounced (so
  // streaming deltas don't thrash), keyed by the engine session id.
  useEffect(() => {
    if (!isApiChat) return;
    const sid = claudeSessionIdRef.current;
    if (!sid || treeNodes.length === 0) return;
    const t = setTimeout(() => {
      const byId = new Map(turns.map((x) => [x.id, x]));
      void saveChatTree(sid, JSON.stringify(serializeTree(treeNodes, treeSel, byId))).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [isApiChat, treeNodes, treeSel, turns]);

  const variantInfo = useMemo(() => computeResponseVariants(turns), [turns]);
  // API branching is governed by the tree (treeTurns is already the active path);
  // the old display-variant hiding only applies to the CLI tier.
  const hiddenTurnIds = useMemo(
    () => (isApiChat ? new Set<string>() : hiddenVariantTurnIds(variantInfo, activeVariant)),
    [isApiChat, variantInfo, activeVariant],
  );
  // the transcript renders ONLY the active variant's turns; the rest stay in the
  // store + the model's context (display-level branching), just hidden here.
  const visibleTurns = useMemo(
    () => (hiddenTurnIds.size === 0 ? treeTurns : treeTurns.filter((t) => !hiddenTurnIds.has(t.id))),
    [treeTurns, hiddenTurnIds],
  );

  const blocks = useMemo<RenderBlock[]>(() => {
    const { childIds, backgroundMemberIds } = fleet;
    const out: RenderBlock[] = [];
    let pending: ToolTurn[] = [];

    const flushTools = () => {
      if (pending.length === 0) return;
      out.push({ kind: "activity", id: pending[0].id, tools: pending });
      pending = [];
    };
    // the activity group most recently emitted in the current turn segment,
    // so a trailing `result` can attach its duration to it.
    const lastActivity = (): Extract<RenderBlock, { kind: "activity" }> | null => {
      for (let i = out.length - 1; i >= 0; i--) {
        const b = out[i];
        if (b.kind === "activity") return b;
        if (b.kind === "user") break; // don't cross into a previous turn
      }
      return null;
    };

    for (const t of visibleTurns) {
      if (t.kind === "tool") {
        // A sub-agent's OWN tool calls are owned by their Agent row (via the
        // global childrenByAgent map) — pull them OUT of the linear stream
        // entirely so they cluster under the agent wherever it lives, and can't
        // form a detached flat group or get promoted to a top-level card.
        // A RUNNING background agent's whole subtree (its Agent row + children)
        // also leaves the transcript — it lives in the composer dock until it
        // finishes, then re-enters here as a collapsed, done AgentStep.
        if (childIds.has(t.id) || backgroundMemberIds.has(t.id)) continue;
        // a dangling-parent child (parent Agent absent — mid-replay) keeps the
        // old degrade-to-flat path and is never promoted.
        const isChild = t.parentId != null;
        // AskUserQuestion is an INTERACTIVE prompt, not background activity — it
        // gets its own prominent card (with answer buttons) instead of being
        // folded into a collapsed "Worked for Xs ›" group where its questions
        // would be buried and unanswerable.
        if (!isChild && isPlanProposalTool(t)) {
          // ExitPlanMode is an INTERACTIVE approval gate, not background activity —
          // promote it to a prominent plan card (same treatment as AskUserQuestion)
          // instead of burying it in the collapsed "Worked for Xs ›" group as a
          // dead, auto-dismissed step.
          flushTools();
          out.push({ kind: "plan", id: t.id, turn: t });
        } else if (!isChild && isAskQuestionTool(t)) {
          flushTools();
          out.push({ kind: "ask", id: t.id, turn: t });
        } else if (!isChild && isFileEditTool(t)) {
          // file edits get a prominent, always-visible change card — never folded
          // into the collapsed activity group (where the diff used to flash + hide).
          flushTools();
          out.push({ kind: "change", id: t.id, turn: t });
        } else {
          pending.push(t);
        }
        continue;
      }
      flushTools();
      if (t.kind === "user") {
        out.push({ kind: "user", id: t.id, turn: t });
      } else if (t.kind === "assistant") {
        out.push({ kind: "assistant", id: t.id, turn: t });
      } else if (t.kind === "thinking") {
        out.push({ kind: "thinking", id: t.id, turn: t });
      } else if (t.kind === "approval") {
        out.push({ kind: "approval", id: t.id, turn: t });
      } else if (t.kind === "compaction") {
        out.push({ kind: "compaction", id: t.id, turn: t });
      } else if (t.kind === "result") {
        const act = lastActivity();
        if (act && t.durationMs != null) act.durationMs = t.durationMs;
        // footer only carries supplementary metadata; when an activity line owns
        // the duration we still show tokens/cost there (it's separate + faint).
        if (t.text) out.push({ kind: "result", id: t.id, turn: t });
      }
    }
    flushTools();
    return out;
  }, [visibleTurns, fleet]);
  blocksCountRef.current = blocks.length;
  // keep the jump pill's "N new" fresh as blocks land while detached. (The
  // ResizeObserver re-syncs on growth too; this guarantees the count tracks the
  // block list even if a new block adds no measurable height.)
  useEffect(() => {
    syncChrome();
  }, [blocks.length, syncChrome]);

  // P4d — every file the AI edited/created this chat, aggregated for the roll-up.
  const changedFiles = useMemo(() => {
    const map = new Map<
      string,
      { path: string; name: string; edits: number; adds: number; dels: number }
    >();
    for (const t of turns) {
      if (t.kind !== "tool" || !isFileEditTool(t)) continue;
      const inp = t.input ?? {};
      const path =
        (typeof inp.file_path === "string" && inp.file_path) ||
        (typeof inp.path === "string" && inp.path) ||
        (typeof inp.notebook_path === "string" && inp.notebook_path) ||
        "";
      if (!path) continue;
      const { adds, dels } = editStat(t);
      const e = map.get(path) ?? { path, name: baseName(path), edits: 0, adds: 0, dels: 0 };
      e.edits += 1;
      e.adds += adds;
      e.dels += dels;
      map.set(path, e);
    }
    return [...map.values()];
  }, [turns]);

  // index of the final activity group IN THE CURRENT TURN — only IT shows the
  // live "Working…" timer while streaming (so an earlier group in a multi-step
  // turn never double-spins). Scan stops at the last user block: an activity
  // group from a PREVIOUS turn must not be treated as live. Without this, opening
  // a conversation whose last run left an unclosed activity group (no durationMs)
  // pinned the live timer to that stale, off-screen group — so a new reply showed
  // no "Working…" indication near the composer at all (owner-reported on resume).
  const lastActivityIdx = useMemo(() => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].kind === "activity") return i;
      if (blocks[i].kind === "user") return -1;
    }
    return -1;
  }, [blocks]);

  // id of the last user block — "regenerate" only makes sense there (regenerate
  // always replays the most recent user turn, so showing it on every bubble lied).
  const lastUserId = useMemo(() => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].kind === "user") return blocks[i].id;
    }
    return null;
  }, [blocks]);

  // ── find-in-chat ────────────────────────────────────────────────────────
  // mod+F routes here via App's handleCmdF → "osai-chat-find" (same context-
  // aware pattern as the browser pane; before this, ⌘F on a chat pane
  // FULLSCREENED it). Matching is block-granular: jump + one-shot highlight
  // wash, with collapsed thinking/activity groups force-opened on their hits —
  // text the native find could never reach.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findSel, setFindSel] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);
  /** block id → its wrapper element (find jumps + minimap geometry). */
  const blockElsRef = useRef<Map<string, HTMLElement>>(new Map());

  const findMatches = useMemo(() => {
    const q = findQuery.trim().toLowerCase();
    if (!findOpen || q.length < 2) return [] as string[];
    return blocks
      .filter((b) => blockSearchText(b).toLowerCase().includes(q))
      .map((b) => b.id);
  }, [findOpen, findQuery, blocks]);
  const findMatchSet = useMemo(() => new Set(findMatches), [findMatches]);
  const findCurrentId = findOpen ? (findMatches[findSel] ?? null) : null;

  const scrollToBlock = useCallback((id: string) => {
    blockElsRef.current.get(id)?.scrollIntoView({
      block: "center",
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
  }, []);
  const gotoFind = useCallback(
    (dir: 1 | -1) => {
      setFindSel((s) => {
        const len = findMatches.length;
        if (!len) return 0;
        const next = (((s + dir) % len) + len) % len;
        const id = findMatches[next];
        if (id) requestAnimationFrame(() => scrollToBlock(id));
        return next;
      });
    },
    [findMatches, scrollToBlock],
  );
  // fresh query → restart at (and reveal) the first hit
  useEffect(() => {
    setFindSel(0);
    if (!findOpen || findMatches.length === 0) return;
    const id = findMatches[0];
    const raf = requestAnimationFrame(() => scrollToBlock(id));
    return () => cancelAnimationFrame(raf);
    // findMatches is derived from findQuery/findOpen — keying on those keeps
    // this from re-firing on every streamed block while the query sits still.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [findQuery, findOpen]);
  const closeFind = useCallback(() => {
    setFindOpen(false);
    taRef.current?.focus();
  }, []);
  useEffect(() => {
    const onFind = (e: Event) => {
      const k = (e as CustomEvent<{ key?: string }>).detail?.key;
      if (paneKey && k && k !== paneKey) return;
      setFindOpen(true);
      requestAnimationFrame(() => {
        findInputRef.current?.focus();
        findInputRef.current?.select();
      });
    };
    window.addEventListener("osai-chat-find", onFind);
    return () => window.removeEventListener("osai-chat-find", onFind);
  }, [paneKey]);

  // ── run cinema — replay the captured run-event timeline ────────────────
  // Segment starts: index 0 plus the event after each terminal marker, so the
  // k-th activity group replays from (roughly) its own run's beginning.
  const [cinemaAt, setCinemaAt] = useState<number | null>(null);
  // stable replay opener passed to every (memoized) ActivityGroup — a fresh
  // closure per group would defeat the memo.
  const replayCinemaSeg = useCallback((seg: number) => setCinemaAt(seg), []);
  const cinemaSegStarts = useMemo(() => {
    const starts = [0];
    runEventState.events.forEach((ev, i) => {
      if (
        (ev.type === "run.completed" || ev.type === "run.failed" || ev.type === "run.interrupted") &&
        i + 1 < runEventState.events.length
      ) {
        starts.push(i + 1);
      }
    });
    return starts;
  }, [runEventState.events]);

  // ── conversation minimap — one tick per block, click to jump ───────────
  const [mapTicks, setMapTicks] = useState<
    {
      id: string;
      kind: RenderBlock["kind"];
      frac: number;
      err: boolean;
      at: number | null;
      label: string;
    }[]
  >([]);
  useEffect(() => {
    if (blocks.length < 9) {
      setMapTicks([]);
      return;
    }
    // one rAF batches all the geometry reads after layout settles
    const raf = requestAnimationFrame(() => {
      const root = scrollRef.current;
      if (!root) return;
      // Markers live in CONTENT space (offset within the scroll run / scrollHeight)
      // — the same space as the custom rail thumb, a window of height
      // clientHeight/scrollHeight that slides over them. Positions are measured
      // with getBoundingClientRect relative to the scroll container, NOT
      // offsetTop: any ancestor with a transform/filter/backdrop-filter becomes
      // an offsetParent and silently REBASES offsetTop — the Neon Glass
      // TurnFrame's backdrop-blur did exactly that, compressing every tick into
      // the top of the rail. Rect math can't be rebased.
      const H = Math.max(1, root.scrollHeight);
      const rootTop = root.getBoundingClientRect().top - root.scrollTop;
      const out: {
        id: string;
        kind: RenderBlock["kind"];
        frac: number;
        err: boolean;
        at: number | null;
        label: string;
      }[] = [];
      for (const b of blocks) {
        const el = blockElsRef.current.get(b.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top - rootTop;
        out.push({
          id: b.id,
          kind: b.kind,
          frac: Math.min(1, Math.max(0, top / H)),
          err: b.kind === "result" && b.turn.ok === false,
          at: blockTime(b),
          label: tickLabel(b),
        });
      }
      setMapTicks(out);
    });
    return () => cancelAnimationFrame(raf);
    // railWin?.size ≈ clientHeight/scrollHeight — re-measure when the content/
    // viewport ratio shifts (pane resize, images landing) even if the block
    // list itself didn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks, railWin?.size]);

  // ── conversation outline — the ticks as a clickable table of contents ────
  const [outlineOpen, setOutlineOpen] = useState(false);
  const outlineEntries = useMemo(
    () =>
      mapTicks.filter(
        (t) =>
          t.kind === "user" ||
          t.kind === "plan" ||
          t.kind === "ask" ||
          t.kind === "compaction" ||
          t.err,
      ),
    [mapTicks],
  );
  // the entry the viewport is currently on (nearest at-or-above the window top)
  const outlineCurrentId = useMemo(() => {
    if (!railWin) return outlineEntries[0]?.id ?? null;
    const mid = railWin.top + railWin.size * 0.35;
    let cur: string | null = null;
    for (const t of outlineEntries) {
      if (t.frac <= mid) cur = t.id;
      else break;
    }
    return cur ?? outlineEntries[0]?.id ?? null;
  }, [outlineEntries, railWin]);
  // Esc closes the outline (transcript-level listener; the panel has no input).
  useEffect(() => {
    if (!outlineOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOutlineOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [outlineOpen]);

  // ── scrubber interaction (P6): drag the minimap to scroll, hover for a
  // time+snippet bubble, day-boundary hairlines on the rail ─────────────────
  const railRef = useRef<HTMLDivElement>(null);
  const scrubbingRef = useRef(false);
  const [scrubBubble, setScrubBubble] = useState<{
    frac: number;
    at: number | null;
    label: string;
  } | null>(null);
  const dayMarks = useMemo(
    () => dayBoundaries(mapTicks).map((i) => ({ frac: mapTicks[i].frac })),
    [mapTicks],
  );
  const railFrac = (clientY: number): number => {
    const r = railRef.current?.getBoundingClientRect();
    if (!r || r.height === 0) return 0;
    return Math.min(1, Math.max(0, (clientY - r.top) / r.height));
  };
  const railBubbleAt = (frac: number) => {
    const near = nearestTick(mapTicks, frac);
    setScrubBubble({ frac, at: near?.at ?? null, label: near?.label ?? "" });
  };
  const railScrubTo = (clientY: number) => {
    const frac = railFrac(clientY);
    const root = scrollRef.current;
    if (root) {
      // map the cursor fraction straight to the scroll window's TOP so the thumb
      // tracks the pointer 1:1 (scrollbar feel), not offset by half a viewport
      // (the old "center the point" math felt laggy/disconnected when dragging).
      root.scrollTop = Math.max(
        0,
        Math.min(frac * root.scrollHeight, root.scrollHeight - root.clientHeight),
      );
      // derive stick from the dragged-to position — synchronously, so the thumb +
      // pill don't lag the drag (the scroll event it fires would do it, later).
      // Dragging INTO the bottom zone re-arms following; anywhere else detaches.
      setStickFromPosition();
    }
    railBubbleAt(frac);
  };

  // ── per-turn token sparkline (last 24 result turns) ─────────────────────
  const tokenHistory = useMemo(() => {
    const out: number[] = [];
    for (const t of turns) {
      if (t.kind === "result" && typeof t.tokens === "number" && t.tokens > 0) {
        out.push(t.tokens);
      }
    }
    return out.slice(-24);
  }, [turns]);

  // ── cumulative session usage (Tier 3) — messages · tokens · age, no $ ────
  // The session-level companion to the per-turn sparkline + live "ctx" readout.
  // Recomputed when the transcript changes; age reads Date.now() at render (so it
  // advances as you interact — close enough without a dedicated idle timer).
  const usage = useMemo(() => sessionUsage(turns), [turns]);

  // ── smart starter deck — the hero's cards read the workspace ────────────
  // One shallow readDir on the empty hero probes what kind of place this is:
  // a manifest → "explain this codebase" gets specific + "fix" becomes "run
  // the tests"; a git repo → "plan" becomes "what changed lately?"; an empty
  // folder → "explore" becomes "start from scratch". Static deck when the
  // probe fails or there's no cwd.
  const [deckHints, setDeckHints] = useState<{
    manifest?: string;
    hasGit: boolean;
    hasReadme: boolean;
    bare: boolean;
  } | null>(null);
  useEffect(() => {
    if (!empty || !cwd) {
      setDeckHints(null);
      return;
    }
    let alive = true;
    readDir(cwd)
      .then((entries) => {
        if (!alive) return;
        const names = new Set(entries.map((e) => e.name.toLowerCase()));
        const manifest = ["package.json", "cargo.toml", "pyproject.toml", "go.mod"].find((m) =>
          names.has(m),
        );
        setDeckHints({
          manifest,
          hasGit: names.has(".git"),
          hasReadme: names.has("readme.md"),
          bare: entries.length === 0,
        });
      })
      .catch(() => {
        if (alive) setDeckHints(null);
      });
    return () => {
      alive = false;
    };
  }, [empty, cwd]);
  // (starter deck removed with the hero cards — see the empty-state comment.)
  void deckHints;

  /** Wall-clock for a block (unix ms) — the turn's own createdAt (sends +
   *  resumed transcripts) first, then the arrival stamp; null when unknown
   *  (NaN-seeded resumed turns whose transcript carried no timestamp). */
  const blockTime = (b: RenderBlock): number | null => {
    if (b.kind !== "activity") {
      const c = (b.turn as { createdAt?: number }).createdAt;
      if (c != null && Number.isFinite(c)) return c;
    }
    const id = b.kind === "activity" ? b.tools[0]?.id : b.turn.id;
    const t = id != null ? turnTimesRef.current.get(id) : undefined;
    return t != null && Number.isFinite(t) ? t : null;
  };

  /** Time that may ANCHOR a day separator. Only the turn-level blocks carry a
   *  trustworthy wall-clock (their own transcript `createdAt`): user, assistant,
   *  result, compaction. Activity / thinking / change / ask are always *inside*
   *  an assistant turn and fall back to arrival stamps — on a resumed chat those
   *  re-arrive "today" while the prose keeps its original date, which used to
   *  flip the day mid-turn (…jun 19 → today → jun 19…) and split one turn into
   *  two frames. Anchoring only on turn-level blocks makes mid-turn blocks
   *  inherit the surrounding day instead of inventing one. */
  const dayAnchorTime = (b: RenderBlock): number | null => {
    if (
      b.kind === "user" ||
      b.kind === "assistant" ||
      b.kind === "result" ||
      b.kind === "compaction"
    ) {
      return blockTime(b);
    }
    return null;
  };

  // ── render ──────────────────────────────────────────────────────────────────

  if (empty) {
    const startupFailed = Boolean(startupNote?.startsWith("failed to start"));
    return (
      <ChatFileOpenContext.Provider value={openChatFile}>
      <PaneDropZone onPath={insertPath} onFiles={onDropFiles} label="drop image or path">
      {/* vertically CENTERED hero (owner: anchored-high read as empty) — the
          block still grows downward from center as chips/status bloom in.
          NEVER scrolls (owner: only content bubbles may scroll): overlays like
          /resume fit by shifting the hero up instead. */}
      <div className="relative flex h-full min-h-0 w-full flex-col items-center justify-center overflow-hidden bg-[var(--color-bg)] px-6 py-10">
        {/* ambient aurora — two slow accent blobs whispering behind the hero
            (drift keyframes die under reduce-motion; the static wash stays). */}
        <div
          aria-hidden
          className="osai-drift-a pointer-events-none absolute h-[44vh] w-[44vh] rounded-full opacity-[0.04]"
          style={{ background: "radial-gradient(circle, var(--color-accent), transparent 62%)", filter: "blur(80px)" }}
        />
        <div
          aria-hidden
          className="osai-drift-b pointer-events-none absolute h-[36vh] w-[36vh] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(circle, var(--color-highlight), transparent 62%)", filter: "blur(80px)" }}
        />
        {/* an open overlay (the /resume ledger drops BELOW the composer here)
            shifts the whole hero up so everything fits without scrolling. */}
        <div
          className={`fade-in-up relative w-full max-w-3xl transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${
            overlay ? "-translate-y-[16vh]" : ""
          }`}
        >
          <div className="hero-kicker fade-in-up mb-3 text-center" style={{ animationDelay: "60ms" }}>
            {timeGreeting()}, <b>{displayName()}</b>
          </div>
          {/* per-word spring rise (SplitText); keyed per state so it fires
              once per state, not on every transcript re-render. The title is
              a living question — it morphs with what's actually happening:
              /resume open, dictation live, plan-first armed. */}
          <h1 className="hero-title mb-6 text-center">
            {(() => {
              const heroState =
                overlay === "resume"
                  ? "resume"
                  : recording
                    ? "listening"
                    : planMode
                      ? "plan"
                      : resumedTitle
                        ? "resumed"
                        : "fresh";
              const accent = (key: string, text: string) => (
                <span key={key} className="osai-greet-name">
                  {text}
                </span>
              );
              const words =
                heroState === "resume"
                  ? ["what", "should", "we", accent("resume", "resume?")]
                  : heroState === "listening"
                    ? ["go", "ahead —", "i'm", accent("listening", "listening")]
                    : heroState === "plan"
                      ? ["what", "should", "we", accent("plan", "plan?")]
                      : heroState === "resumed"
                        ? ["picking", "up", "where", "we", accent("left", "left off")]
                        : ["what", "should", "we", accent("work", "work"), "on?"];
              return <SplitText key={heroState} startDelay={0.08} words={words} />;
            })()}
          </h1>
          {resumedTitle && (
            <div className="mb-4 flex justify-center">
              <ResumedNote title={resumedTitle} onClear={() => setResumedTitle(null)} />
            </div>
          )}
          {composer}
          {startupNote && (
            <div
              className={`fade-in-up mt-3 flex items-center justify-center gap-2 text-[12px] ${
                startupFailed ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"
              }`}
            >
              {startupFailed && <AlertTriangle size={12} className="shrink-0" />}
              <span className="min-w-0 truncate" title={startupNote}>{startupNote}</span>
              {startupFailed && (
                <button
                  type="button"
                  onClick={() => {
                    setStartupNote(null);
                    setRestartKey((k) => k + 1);
                  }}
                  className="press inline-flex shrink-0 items-center gap-1 rounded-md border border-[var(--color-border-strong)] px-2 py-0.5 font-sans text-[11px] text-[var(--color-muted)] transition-colors hover:border-[var(--color-text)] hover:text-[var(--color-text)]"
                >
                  <RefreshCw size={10} /> retry
                </button>
              )}
            </div>
          )}
          {/* status/kbd hints hide while an overlay is open — the /resume
              ledger occupies exactly this space below the composer. */}
          {!overlay && (
            <div className="helper-line mt-3 flex items-center justify-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span
                  className={`status-dot ${started ? "status-dot--active" : "status-dot--idle"}`}
                  style={{ width: 6, height: 6 }}
                />
                {started ? `${model.engine ?? "claude"} · ready` : `starting ${model.engine ?? "claude"}…`}
              </span>
              <span className="text-[var(--color-border-strong)]">·</span>
              <span>⏎ send</span>
              <span>{SHIFT}⏎ newline</span>
            </div>
          )}
          {/* (starter deck + resume rail removed — the home lock screen owns
              discovery and "pick up where you left off" now; the chat hero
              stays a clean greeting + composer. Owner request, W1.6b.) */}
        </div>
      </div>
      {goalDraft !== null && (
        <GoalEditorOverlay
          value={goalDraft}
          onChange={setGoalDraft}
          onCommit={(v) => { setGoal(v.trim()); setGoalDraft(null); }}
          onCancel={() => setGoalDraft(null)}
        />
      )}
      {/* the attach-preview lightbox must exist in the HERO branch too — this
          is where images usually get attached first (owner-reported dead click). */}
      {previewImage && (
        <ImagePreview
          image={previewImage}
          onClose={() => setPreviewImage(null)}
          onRemove={() => {
            removeImage(previewImage.id);
            setPreviewImage(null);
          }}
        />
      )}
      </PaneDropZone>
      </ChatFileOpenContext.Provider>
    );
  }

  return (
    <ChatCwdContext.Provider value={cwd ?? null}>
    <ChatFileOpenContext.Provider value={openChatFile}>
    <ChatSubmitContext.Provider value={submitNote}>
    <PaneDropZone onPath={insertPath} label="drop to add to message">
    <div
      data-chat-pane
      tabIndex={-1}
      onKeyDown={onPaneKeyDown}
      className="osai-stage relative flex h-full min-h-0 w-full flex-col outline-none"
    >
      {/* quiet dot-grid texture on the chat ground — behind the aurora + content */}
      <DotPattern className="-z-10" gap={26} />
      {/* W5 ambient canvas art — the hero's aurora blobs, whisper-faint, on
          the live transcript ground too (drift dies under reduce-motion; the
          static wash stays). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div
          className="osai-drift-a absolute left-[6%] top-[10%] h-[44vh] w-[44vh] rounded-full opacity-[0.035]"
          style={{ background: "radial-gradient(circle, var(--color-accent), transparent 62%)", filter: "blur(90px)" }}
        />
        <div
          className="osai-drift-b absolute bottom-[6%] right-[4%] h-[36vh] w-[36vh] rounded-full opacity-[0.03]"
          style={{ background: "radial-gradient(circle, var(--osai-accent-2), transparent 62%)", filter: "blur(90px)" }}
        />
      </div>
      <div
        ref={scrollRef}
        // overflow-anchor:none — WE own the scroll position. Browser scroll-
        // anchoring otherwise nudges scrollTop when a mid-transcript block resizes
        // (tool cards, thinking) and fires a phantom scroll that would flip the
        // stick flag off, silently stopping the follow. Disabling it keeps the
        // position honest so `stickRef` is driven only by real user scrolls.
        className="relative min-h-0 flex-1 overflow-y-auto [overflow-anchor:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        onMouseUp={onTranscriptMouseUp}
        onScroll={() => {
          onScroll();
          if (snipTip) setSnipTip(null);
        }}
      >
        {/* floating selection affordance — attach as context, or jump straight
            into a follow-up about exactly this passage. */}
        {snipTip && (
          <div
            className="scale-in absolute z-30 flex -translate-x-1/2 items-center overflow-hidden rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel-2)]/95 font-sans text-[11px] text-[var(--color-text)] shadow-[var(--osai-shadow-pop)]"
            style={{ left: snipTip.x, top: Math.max(snipTip.y - 34, 4) }}
          >
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setSnippets((prev) => [...prev, { id: uid(), text: snipTip.text }]);
                setSnipTip(null);
                window.getSelection()?.removeAllRanges();
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-accent)]"
              title="attach the selected text as a context snippet on your next message"
            >
              <Quote size={11} className="text-[var(--color-muted)]" />
              add as context
            </button>
            <span className="h-4 w-px shrink-0 bg-[var(--color-border)]" />
            <button
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                // quote the passage AND put the cursor in the composer — a
                // drill-down follow-up becomes one gesture.
                setSnippets((prev) => [...prev, { id: uid(), text: snipTip.text }]);
                setSnipTip(null);
                window.getSelection()?.removeAllRanges();
                requestAnimationFrame(() => taRef.current?.focus());
              }}
              className="flex items-center gap-1.5 px-2.5 py-1 transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-accent)]"
              title="quote this passage and focus the composer"
            >
              <CornerDownLeft size={11} className="text-[var(--color-muted)]" />
              ask about this
            </button>
          </div>
        )}
        <div ref={contentRef} className="chat-col mx-auto flex flex-col gap-4 px-6 py-7">
          {resumedTitle && (
            <div className="flex justify-center">
              <ResumedNote title={resumedTitle} onClear={() => setResumedTitle(null)} />
            </div>
          )}
          {changedFiles.length > 0 && <ChangedFilesBar files={changedFiles} />}
          {/* pinned answers — sticky within the scroll so the pinned command/
              config stays one click away anywhere in a long session. */}
          {pinResolved.length > 0 && (
            <div className="sticky top-1 z-10 flex flex-wrap items-center gap-1.5">
              {pinResolved.map((p) => (
                <span
                  key={p.h}
                  className="glass-strong flex max-w-[340px] items-center gap-1.5 overflow-hidden rounded-full py-1 pl-2.5 pr-1 shadow-[var(--osai-shadow-pop)]"
                >
                  <Pin size={10} className="shrink-0 fill-current text-[var(--color-accent)]" />
                  <button
                    type="button"
                    disabled={!p.id}
                    onClick={() => p.id && scrollToBlock(p.id)}
                    title={p.id ? p.preview : `${p.preview} — not in this view (other branch/variant)`}
                    className="min-w-0 truncate text-left font-sans text-[11px] text-[var(--color-text-2)] transition-colors enabled:hover:text-[var(--color-text)] disabled:opacity-60"
                  >
                    {p.preview}
                  </button>
                  <button
                    type="button"
                    onClick={() => persistPins(pins.filter((x) => x.h !== p.h))}
                    title="unpin"
                    className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-danger)]"
                  >
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
          )}
          {(() => {
            // same elements as before, built in a loop so a quiet day rule can
            // slip in whenever the wall-clock day changes mid-transcript
            // (resumed sessions span days; "yesterday" deserves a seam).
            //
            // 02 Framed Turns: the run of non-user blocks following a user
            // message (thinking · activity · change · prose · result) collapses
            // into ONE assistant TurnFrame. User → its own you-card; compaction
            // + day seams stay standalone (between frames). The frame is
            // non-positioned, so child `offsetTop` (minimap geometry) is intact.
            const out: React.ReactNode[] = [];
            let prevDay: string | null = null;
            let actIdx = -1; // running activity-group index → cinema segment
            let group: {
              firstId: string;
              nodes: React.ReactNode[];
              steps: number;
              workedMs: number;
              hasResult: boolean;
              hasContent: boolean; // a block that actually renders (prose/thinking w/ text, tools/change/ask/approval)
              model?: string; // model that produced this turn (from its assistant blocks)
            } | null = null;
            const flushGroup = (isTail = false) => {
              if (!group) return;
              const g = group;
              group = null;
              const live = isTail && streaming && !g.hasResult;
              // Drop a hollow frame: no real content AND no result block at all (e.g.
              // a degenerate empty assistant turn). A `/compact` no longer reaches
              // here — its empty footer is dropped at the source (see the result
              // event handler), so no result block is created. Keep live frames.
              if (!live && !g.hasContent && !g.hasResult) return;
              // response branching: if this prompt has >1 response variant (you
              // regenerated), show a ‹N/M› switcher in the frame header. Only the
              // ACTIVE variant's blocks were rendered (the rest are filtered out of
              // visibleTurns), so this group IS the active variant.
              // API branching: the ‹N/M› switcher is driven by the TREE — sibling
              // answers under the user turn. Switching re-selects the active child,
              // which re-renders the active path (the other branch + its whole
              // continuation hide). CLI tier keeps the old display-variant switcher.
              let variantNav:
                | { index: number; count: number; onPrev: () => void; onNext: () => void }
                | undefined;
              if (isApiChat) {
                const pos = siblingPosition(treeNodes, g.firstId);
                variantNav =
                  pos.count > 1
                    ? {
                        index: pos.index,
                        count: pos.count,
                        onPrev: () => setTreeSel((sel) => stepBranch(treeNodes, sel, g.firstId, -1)),
                        onNext: () => setTreeSel((sel) => stepBranch(treeNodes, sel, g.firstId, 1)),
                      }
                    : undefined;
              } else {
                const vinfo = variantInfo.byTurnId.get(g.firstId);
                const vUser = vinfo?.userId;
                const vCount = vUser ? variantInfo.countByUser.get(vUser) ?? 1 : 1;
                variantNav =
                  vUser && vCount > 1
                    ? {
                        index: vinfo!.variant,
                        count: vCount,
                        onPrev: () =>
                          setActiveVariant((prev) => ({
                            ...prev,
                            [vUser]: Math.max(0, activeVariantIndex(prev, vUser, vCount) - 1),
                          })),
                        onNext: () =>
                          setActiveVariant((prev) => ({
                            ...prev,
                            [vUser]: Math.min(vCount - 1, activeVariantIndex(prev, vUser, vCount) + 1),
                          })),
                      }
                    : undefined;
              }
              out.push(
                <TurnFrame
                  key={`turn-${g.firstId}`}
                  modelLabel={g.model ? modelLabelFor(g.model) : model.label}
                  steps={g.steps}
                  workedMs={g.workedMs}
                  live={live}
                  variantNav={variantNav}
                >
                  {g.nodes}
                </TurnFrame>,
              );
            };
            blocks.forEach((b, i) => {
              if (b.kind === "activity") actIdx += 1;
              const segForBlock = Math.min(actIdx < 0 ? 0 : actIdx, cinemaSegStarts.length - 1);
              const t = blockTime(b);
              const anchor = dayAnchorTime(b);
              if (anchor != null) {
                const day = new Date(anchor).toDateString();
                if (prevDay != null && day !== prevDay) {
                  flushGroup();
                  out.push(<DaySeparator key={`day-${b.id}`} at={anchor} />);
                }
                prevDay = day;
              }
              // live only on the final activity group, while a turn is in flight
              // and it hasn't been closed by a result yet. Computed ONCE so the
              // memoized ActivityGroup gets STABLE elapsedMs/phase — a non-live
              // group must not see the per-second `now` tick, or memo can't bail.
              const activityLive =
                b.kind === "activity" && streaming && b.durationMs == null && i === lastActivityIdx;
              const inner =
                b.kind === "activity" ? (
                  <ActivityGroup
                    tools={b.tools}
                    childrenByAgent={fleet.childrenByAgent}
                    durationMs={b.durationMs}
                    live={activityLive}
                    elapsedMs={activityLive && liveStart != null ? now - liveStart : 0}
                    phase={activityLive ? runEventState.phase : undefined}
                    forceOpen={findOpen && findMatchSet.has(b.id)}
                    // stable number + stable callback (vs a fresh closure each
                    // render) so the memoized group's props don't churn.
                    replaySeg={
                      runEventState.events.length > 0 ? (cinemaSegStarts[segForBlock] ?? 0) : undefined
                    }
                    onReplaySeg={replayCinemaSeg}
                  />
                ) : b.kind === "user" ? (
                  <UserBubble
                    turn={b.turn}
                    at={t}
                    streaming={streaming}
                    isLast={b.id === lastUserId}
                    onRegenerate={() => regenerate(b.turn.text)}
                    onRetryModel={(m) => retryWithModel(m, b.turn.text)}
                    retryModels={retryMenuModels}
                    currentModelId={model.id}
                    onEdit={editMessage}
                    variantNav={(() => {
                      // edit-fork: this user turn has alternate edited versions
                      // (tree siblings). Switching swaps the prompt + its branch.
                      if (!isApiChat) return undefined;
                      const pos = siblingPosition(treeNodes, b.turn.id);
                      return pos.count > 1
                        ? {
                            index: pos.index,
                            count: pos.count,
                            onPrev: () => setTreeSel((s) => stepBranch(treeNodes, s, b.turn.id, -1)),
                            onNext: () => setTreeSel((s) => stepBranch(treeNodes, s, b.turn.id, 1)),
                          }
                        : undefined;
                    })()}
                  />
                ) : b.kind === "assistant" ? (
                  <AssistantBubble
                    turn={b.turn}
                    at={t}
                    onButton={(label) => {
                      if (!streaming && sessionIdRef.current != null) dispatch(label);
                    }}
                    disabled={streaming}
                    onOpenUrl={onOpenUrl}
                    pinned={pinnedHashes.has(hashText(b.turn.text))}
                    onTogglePin={
                      b.turn.text.trim() ? () => togglePinText(b.turn.text) : undefined
                    }
                  />
                ) : b.kind === "compaction" ? (
                  <CompactionCard turn={b.turn} forceOpen={findOpen && findMatchSet.has(b.id)} />
                ) : b.kind === "thinking" ? (
                  <ThinkingBlock turn={b.turn} forceOpen={findOpen && findMatchSet.has(b.id)} />
                ) : b.kind === "approval" ? (
                  <ApprovalCard turn={b.turn} onResolve={resolveApproval} />
                ) : b.kind === "change" ? (
                  <ChangeCard turn={b.turn} />
                ) : b.kind === "ask" ? (
                  <AskQuestionCard
                    turn={b.turn}
                    // live: the in-memory answer collapses the card instantly.
                    // replayed-from-history: the recorded tool_result lands on the
                    // turn (turn.result), so an answered chat reopens as answered
                    // instead of an open prompt.
                    answered={
                      askAnswered[b.turn.id] ??
                      (b.turn.result && !b.turn.isError ? b.turn.result : undefined)
                    }
                    cancelled={askCancelled[b.turn.id]}
                    onAnswer={answerAskQuestion}
                  />
                ) : b.kind === "plan" ? (
                  <PlanProposalCard
                    turn={b.turn}
                    // live verdicts come from memory; replayed/resumed chats
                    // recover theirs from the verdict sentinel in the next user
                    // turn (ExitPlanMode's own tool_result is always the
                    // meaningless auto-dismiss) — so an already-approved plan
                    // never re-arms its buttons on reopen.
                    resolved={planResolved[b.turn.id] ?? inferPlanVerdict(turns, b.turn.id)}
                    cancelled={planCancelled[b.turn.id]}
                    onResolve={resolvePlan}
                  />
                ) : (
                  <ResultFooter turn={b.turn} onRetry={retryTurn} />
                );
              // Every block gets a ref'd wrapper (find jumps + minimap geometry).
              // Settled kinds get the BlurFade entrance (W5-3, replacing the CSS
              // fade-in-up); streaming kinds stay a plain div so token appends
              // never retrigger an entrance.
              const animates =
                b.kind === "user" ||
                b.kind === "approval" ||
                b.kind === "ask" ||
                b.kind === "plan" ||
                b.kind === "change" ||
                b.kind === "compaction" ||
                b.kind === "result";
              const setBlockEl = (el: HTMLElement | null) => {
                if (el) blockElsRef.current.set(b.id, el);
                else blockElsRef.current.delete(b.id);
              };
              const blockClass = `chat-block${findCurrentId === b.id ? " find-current" : ""}`;
              const node = animates ? (
                <BlurFade key={b.id} ref={setBlockEl} className={blockClass}>
                  {inner}
                </BlurFade>
              ) : (
                <div key={b.id} ref={setBlockEl} className={blockClass}>
                  {inner}
                </div>
              );
              if (b.kind === "user") {
                // a user message closes the assistant turn and stands alone
                flushGroup();
                out.push(node);
              } else if (b.kind === "compaction") {
                // a system event between turns — never inside an assistant frame
                flushGroup();
                out.push(node);
              } else {
                // accumulate into the current assistant frame
                if (!group) {
                  group = {
                    firstId: b.id,
                    nodes: [],
                    steps: 0,
                    workedMs: 0,
                    hasResult: false,
                    hasContent: false,
                  };
                }
                group.nodes.push(node);
                if (b.kind === "result") {
                  group.hasResult = true;
                  if (b.turn.durationMs != null) {
                    group.workedMs = Math.max(group.workedMs, b.turn.durationMs);
                  }
                } else {
                  // a block that renders something keeps the frame alive; an empty
                  // assistant/thinking turn (no text) does not.
                  const emptyText =
                    (b.kind === "assistant" || b.kind === "thinking") && !b.turn.text.trim();
                  if (!emptyText) group.hasContent = true;
                  // the header model = the model the assistant turn was generated
                  // with (first one wins; a turn group is one model).
                  if (!group.model && b.kind === "assistant" && b.turn.model) {
                    group.model = b.turn.model;
                  }
                  if (b.kind === "activity") {
                    group.steps += b.tools.length;
                    if (b.durationMs != null) group.workedMs += b.durationMs;
                  }
                }
              }
            });
            flushGroup(true);
            return out;
          })()}
          {/* turn in flight with neither streamed text nor a live activity group
              yet (the very first beat) → the bare working timer */}
          {streaming &&
            streamingTurnId.current == null &&
            !(
              lastActivityIdx >= 0 &&
              (blocks[lastActivityIdx] as Extract<RenderBlock, { kind: "activity" }>)
                .durationMs == null
            ) && (
              <WorkingLine
                elapsedMs={liveStart != null ? now - liveStart : 0}
                label={
                  lastSentRef.current?.trim().startsWith("/compact")
                    ? "Compacting context…"
                    : undefined
                }
              />
            )}
        </div>
      </div>
      {/* run cinema — replay the captured run timeline at director's pace */}
      {cinemaAt != null && runEventState.events.length > 0 && (
        <RunCinema
          events={runEventState.events}
          startIndex={cinemaAt}
          onClose={() => setCinemaAt(null)}
        />
      )}
      {/* find-in-chat bar — opens via mod+F (App routes by focused pane) */}
      {findOpen && (
        <div className="surface-pop scale-in absolute right-3 top-2 z-30 flex items-center gap-1.5 px-2 py-1.5">
          <Search size={12} className="shrink-0 text-[var(--color-muted)]" />
          <input
            ref={findInputRef}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                gotoFind(e.shiftKey ? -1 : 1);
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeFind();
              }
            }}
            placeholder="find in chat"
            spellCheck={false}
            className="w-44 bg-transparent text-[12px] text-[var(--color-text)] outline-none placeholder:text-[var(--color-faint)]"
          />
          <span className="min-w-[34px] text-right font-mono text-[10px] tabular-nums text-[var(--color-faint)]">
            {findMatches.length
              ? `${findSel + 1}/${findMatches.length}`
              : findQuery.trim().length >= 2
                ? "0/0"
                : ""}
          </span>
          <button
            type="button"
            onClick={() => gotoFind(-1)}
            disabled={!findMatches.length}
            className="grid h-5 w-5 place-items-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)] disabled:opacity-40"
            title="previous match (shift+enter)"
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            onClick={() => gotoFind(1)}
            disabled={!findMatches.length}
            className="grid h-5 w-5 place-items-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)] disabled:opacity-40"
            title="next match (enter)"
          >
            <ChevronDown size={12} />
          </button>
          <button
            type="button"
            onClick={closeFind}
            className="grid h-5 w-5 place-items-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
            title="close (esc)"
          >
            <X size={12} />
          </button>
        </div>
      )}
      {/* conversation minimap — long chats get a tick rail (same bottom
          clearance convention as the jump pill); click a tick to jump */}
      {(mapTicks.length > 0 || railWin) && (
        <div
          ref={railRef}
          className="group/rail absolute bottom-24 right-0 top-3 z-20 w-5 cursor-ns-resize"
          onPointerDown={(e) => {
            scrubbingRef.current = true;
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
            railScrubTo(e.clientY);
          }}
          onPointerMove={(e) => {
            if (scrubbingRef.current) railScrubTo(e.clientY);
            else railBubbleAt(railFrac(e.clientY));
          }}
          onPointerUp={(e) => {
            scrubbingRef.current = false;
            try {
              e.currentTarget.releasePointerCapture(e.pointerId);
            } catch {
              /* ignore */
            }
          }}
          onPointerLeave={() => {
            if (!scrubbingRef.current) setScrubBubble(null);
          }}
        >
          {/* current scroll window — content-space thumb; THIS is the scrollbar
              (native bar hidden). Markers slide inside it as you scroll. */}
          {railWin && (
            <div
              // NO position transition (only `transition-colors` for the hover
              // tint): the thumb's top/height come straight from scroll state, so an
              // ease would make it trail the scroll — the old "follows late" lag.
              className="pointer-events-none absolute right-[3px] w-1.5 rounded-full bg-[color-mix(in_srgb,var(--color-accent)_55%,transparent)] shadow-[var(--osai-glow-soft)] transition-colors group-hover/rail:bg-[color-mix(in_srgb,var(--color-accent)_75%,transparent)]"
              style={{ top: `${railWin.top * 100}%`, height: `${Math.max(railWin.size * 100, 6)}%` }}
            />
          )}
          {/* day-boundary hairlines */}
          {dayMarks.map((dm, i) => (
            <div
              key={`day${i}`}
              className="pointer-events-none absolute right-0.5 h-px w-3.5 bg-[var(--color-border)]"
              style={{ top: `${dm.frac * 100}%` }}
            />
          ))}
          {/* one tick per block — click to jump */}
          {mapTicks.map((mt) => {
            const s = markerStyle(mt.kind, mt.err);
            return (
              <button
                key={mt.id}
                type="button"
                tabIndex={-1}
                onClick={() => scrollToBlock(mt.id)}
                className="absolute right-1 rounded-full transition-transform hover:scale-x-150"
                style={{
                  top: `${mt.frac * 100}%`,
                  height: s.major ? 3 : 2,
                  width: s.major ? 8 : 5,
                  backgroundColor: s.color,
                  opacity: s.major ? 0.75 : 0.45,
                }}
              />
            );
          })}
          {/* hover / drag bubble: time + snippet of the nearest turn */}
          {scrubBubble && (
            <div
              className="glass pointer-events-none absolute right-7 z-10 -translate-y-1/2 rounded-md px-2 py-1 shadow-[var(--osai-shadow-pop)]"
              style={{ top: `${scrubBubble.frac * 100}%` }}
            >
              {scrubBubble.at != null && (
                <div className="font-mono text-[10px] text-[var(--color-faint)]">
                  {fmtTickTime(scrubBubble.at)}
                </div>
              )}
              <div className="max-w-[240px] truncate font-sans text-[11px] text-[var(--color-text-2)]">
                {scrubBubble.label || "—"}
              </div>
            </div>
          )}
        </div>
      )}
      {/* conversation outline — the rail's ticks as a table of contents: your
          prompts (+ plans, questions, compactions, errors), click to jump. */}
      {outlineEntries.length >= 3 && (
        <button
          type="button"
          onClick={() => setOutlineOpen((v) => !v)}
          title={outlineOpen ? "close outline" : "conversation outline"}
          className={`glass-strong absolute right-7 top-3 z-30 grid h-7 w-7 place-items-center rounded-full shadow-[var(--osai-shadow-pop)] transition-colors hover:text-[var(--color-accent)] ${
            outlineOpen ? "text-[var(--color-accent)]" : "text-[var(--color-muted)]"
          }`}
        >
          <ListChecks size={13} />
        </button>
      )}
      {outlineOpen && outlineEntries.length >= 3 && (
        <div className="glass-strong absolute bottom-28 right-7 top-12 z-30 flex w-80 flex-col overflow-hidden rounded-xl shadow-[var(--osai-shadow-pop)]">
          <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[var(--color-faint)]">
              outline · {outlineEntries.length}
            </span>
            <button
              type="button"
              onClick={() => setOutlineOpen(false)}
              className="grid h-5 w-5 place-items-center rounded text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
            >
              <X size={12} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {outlineEntries.map((t) => {
              const s = markerStyle(t.kind, t.err);
              const current = t.id === outlineCurrentId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    scrollToBlock(t.id);
                    setOutlineOpen(false);
                  }}
                  className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-[var(--color-panel)] ${
                    current ? "bg-[var(--color-panel)]/70" : ""
                  }`}
                >
                  <span
                    className="mt-[5px] h-[7px] w-[7px] shrink-0 rounded-full"
                    style={{ backgroundColor: s.color, opacity: 0.9 }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-sans text-[12px] leading-snug text-[var(--color-text-2)]">
                      {t.label || "—"}
                    </span>
                    {t.at != null && (
                      <span className="font-mono text-[9.5px] text-[var(--color-faint)]">
                        {fmtTickTime(t.at)}
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {/* jump-to-latest pill — appears when autoscroll is paused or viewport is
          off-bottom; while you read up it wears a count of what landed below. */}
      {showJump && (
        <button
          type="button"
          onClick={jumpToLatest}
          title={newBelow > 0 ? `${newBelow} new — scroll to bottom` : "scroll to bottom"}
          className={`glass-strong absolute bottom-24 right-5 z-20 flex h-9 items-center justify-center gap-1.5 rounded-full text-[var(--color-text-2)] shadow-[var(--osai-shadow-pop)] transition-colors hover:text-[var(--color-accent)] hover:shadow-[var(--osai-glow-soft)] ${
            newBelow > 0 ? "px-3.5" : "w-9"
          }`}
        >
          {newBelow > 0 && (
            <span className="font-mono text-[11px] font-medium tabular-nums text-[var(--color-accent)]">
              {newBelow} new
            </span>
          )}
          <ArrowDown size={15} />
        </button>
      )}
      <div className="shrink-0 border-t border-[var(--color-border)]/50 bg-gradient-to-t from-[var(--color-bg)] via-[var(--color-bg)]/95 to-[var(--color-bg)]/70 px-5 pb-3.5 pt-2 backdrop-blur-md">
        <div className="chat-col mx-auto">
          {/* context readout — out of the cramped composer, model-aware window
              (opus 4.8 = 1M, sonnet/haiku = 200K, codex = 272K) */}
          {(usage.messages > 0 || ctxTokens != null || tokenHistory.length >= 3) && (
            <div className="mb-1.5 flex items-center gap-3 px-1 font-mono text-[10.5px] tabular-nums text-[var(--color-faint)]">
              {/* per-turn token sparkline — the result turns already carry
                  tokens; this is the session's rhythm at a glance */}
              {tokenHistory.length >= 3 && <TokenSparkline values={tokenHistory} />}
              <span className="ml-auto flex min-w-0 items-center gap-2">
              {/* cumulative session readout — messages · output tokens · age (no $). */}
              {usage.messages > 0 ? (
                (() => {
                  const age = formatAge(usage.startedAt, Date.now());
                  return (
                    <span
                      className="truncate text-[var(--color-muted)]"
                      title={`${usage.messages} message${usage.messages === 1 ? "" : "s"} · ${usage.tokens.toLocaleString()} output tokens written this session${age ? ` · started ${age} ago` : ""}`}
                    >
                      {usage.messages} msg{usage.messages === 1 ? "" : "s"}
                      {usage.tokens > 0 ? ` · ${formatTokens(usage.tokens)} out` : ""}
                      {(() => {
                        // real-money engines only — sub-billed CLIs stay $-free
                        if (["claude", "codex", "opencode"].includes(model.engine ?? "claude")) return "";
                        const cost = turns.reduce(
                          (a, t) => a + (t.kind === "result" && typeof t.cost === "number" ? t.cost : 0),
                          0,
                        );
                        return cost >= 0.0005 ? ` · $${cost.toFixed(4)}` : "";
                      })()}
                      {age && age !== "just now" ? ` · ${age}` : ""}
                    </span>
                  );
                })()
              ) : null}
              {/* (the ctx chip retired — the composer's FILAMENT is the ambient
                  context meter now; hover its edge for the full card.) */}
              </span>
            </div>
          )}
          {isComposerCollapsed ? (
            <button
              type="button"
              onClick={() => setComposerCollapsed(false)}
              title="show composer"
              className="flex min-h-10 w-full items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-panel-2)]/80 px-3 py-2 text-left text-[12px] text-[var(--color-text-2)] shadow-xl shadow-black/25 backdrop-blur transition-colors hover:text-[var(--color-text)]"
            >
              <span className="flex min-w-0 items-center gap-2">
                <CornerDownLeft size={14} className="shrink-0 text-[var(--color-accent)]" />
                <span className="truncate">composer hidden</span>
              </span>
              <span className="shrink-0 font-mono text-[10px] text-[var(--color-faint)]">
                {hasDraft ? "draft saved" : activeRun ? "run active" : "open"}
              </span>
            </button>
          ) : (
            composer
          )}
        </div>
      </div>
    </div>
    {previewImage && (
      <ImagePreview
        image={previewImage}
        onClose={() => setPreviewImage(null)}
        onRemove={() => { removeImage(previewImage.id); setPreviewImage(null); }}
      />
    )}
    {goalDraft !== null && (
      <GoalEditorOverlay
        value={goalDraft}
        onChange={setGoalDraft}
        onCommit={(v) => { setGoal(v.trim()); setGoalDraft(null); }}
        onCancel={() => setGoalDraft(null)}
      />
    )}
    </PaneDropZone>
    </ChatSubmitContext.Provider>
    </ChatFileOpenContext.Provider>
    </ChatCwdContext.Provider>
  );
}

/** Tiny per-turn token trace (last ≤24 result turns): faint polyline, latest
 *  point accented. Pure render — the bounded history memo lives in the pane. */
function TokenSparkline({ values }: { values: number[] }) {
  const W = 56;
  const H = 14;
  const P = 2;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = Math.max(1, max - min);
  const pts = values.map((v, i) => {
    const x = P + (i * (W - 2 * P)) / Math.max(1, values.length - 1);
    const y = H - P - ((v - min) / span) * (H - 2 * P);
    return [x, y] as const;
  });
  const last = pts[pts.length - 1];
  return (
    <span
      className="inline-flex items-center gap-1.5"
      title={`tokens per turn (last ${values.length}) · latest ${values[values.length - 1].toLocaleString()}`}
    >
      <svg width={W} height={H} aria-hidden className="shrink-0">
        <polyline
          points={pts.map(([x, y]) => `${x},${y}`).join(" ")}
          fill="none"
          stroke="var(--color-faint)"
          strokeWidth="1"
          strokeLinejoin="round"
        />
        <circle cx={last[0]} cy={last[1]} r="1.5" fill="var(--color-accent)" />
      </svg>
      <span className="text-[var(--color-faint)]/80">tok/turn</span>
    </span>
  );
}


// ── sub-views ────────────────────────────────────────────────────────────────

/**
 * Codex-style activity group: one subtle, hairline-free line — "Worked for Xs ›"
 * (or a live "Working… m:ss" with a shimmer while the turn is in flight) — that
 * collapses an entire run of tool calls. Click to expand the tight step list;
 * each step is one line (icon + verb + truncated target). Any files the steps
 * wrote (Write/Edit/NotebookEdit) surface as artifact cards beneath the list.
 */
/** The live run's phase spine: think → write → act → done. */
const RUN_RAIL = ["think", "write", "act", "done"] as const;
function runPhaseIndex(p: RunPhase): number {
  switch (p) {
    case "thinking":
      return 0;
    case "writing":
      return 1;
    case "acting":
    case "waiting":
      return 2;
    default:
      return 3; // completed / failed / interrupted
  }
}

function RunRail({ phase }: { phase: RunPhase }) {
  const idx = runPhaseIndex(phase);
  return (
    <span className="ml-2 inline-flex items-center gap-1" title={`run phase: ${phase}`}>
      {RUN_RAIL.map((step, i) => (
        <span key={step} className="inline-flex items-center gap-1">
          {i > 0 && (
            <span
              className={`h-px w-3 transition-colors duration-300 ${
                i <= idx ? "bg-[var(--color-accent)]/40" : "bg-[var(--color-border)]"
              }`}
            />
          )}
          <span
            className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
              i === idx
                ? "osai-node-live bg-[var(--color-accent)]"
                : i < idx
                  ? "bg-[var(--color-accent)]/45"
                  : "border border-[var(--color-border-strong)]"
            }`}
          />
        </span>
      ))}
      <span className="ml-1.5 font-mono text-[10px] lowercase text-[var(--color-faint)]">{phase}</span>
    </span>
  );
}

/** Memoized: on a parent re-render (typing in the composer, a per-second `now`
 *  tick during a live turn elsewhere), an UNCHANGED activity group skips its whole
 *  render — including its internal useMemos (deriveFleet, artifacts, todo/step
 *  split) and the step map. Props are stabilized at the call site: `tools` /
 *  `childrenByAgent` come from memoized state, `elapsedMs`/`phase` are held flat
 *  for non-live groups, and replay is a stable (seg + callback) pair instead of a
 *  fresh closure. (ActivityGroupImpl is hoisted → safe to reference here.) */
const ActivityGroup = memo(ActivityGroupImpl);

function ActivityGroupImpl({
  tools,
  childrenByAgent,
  durationMs,
  live,
  elapsedMs,
  phase,
  forceOpen = false,
  replaySeg,
  onReplaySeg,
}: {
  tools: ToolTurn[];
  /** GLOBAL parent→children map (from the whole turn), so an Agent row owns ALL
   *  its children even ones that streamed into a later group. */
  childrenByAgent: Map<string, ToolTurn[]>;
  durationMs?: number;
  live: boolean;
  elapsedMs: number;
  /** live run phase — drives the think→write→act→done spine in the header. */
  phase?: RunPhase;
  /** find-in-chat: a hit lives in this group — reveal it regardless of toggle. */
  forceOpen?: boolean;
  /** run cinema: the segment offset to replay from (finished groups only). A
   *  stable number + the stable `onReplaySeg` keep this group's props memo-clean. */
  replaySeg?: number;
  onReplaySeg?: (seg: number) => void;
}) {
  // expanded while the turn is live (so you watch tools run in real time), then
  // auto-collapses to "Worked for Xs ›" when done — unless the user toggled it.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const open = forceOpen || (userToggled ?? live);

  // Sub-agent children are already pulled out of `tools` upstream (they live in
  // the global childrenByAgent map), so `tools` here is exactly what renders at
  // this group's level: the main agent's own calls + the Agent rows. Each Agent
  // row pulls its children (wherever they arrived) from the global map.
  const fleet = useMemo(() => deriveFleet(tools, childrenByAgent), [tools, childrenByAgent]);

  // dedup artifacts by path (an Edit + later Write on the same file → one card).
  // a sub-agent's edits show inline in its nested rows, so they don't pile up here.
  const artifacts = useMemo(() => {
    const seen = new Map<string, Artifact>();
    for (const t of tools) {
      const a = artifactFromTool(t);
      if (a) seen.set(a.path, a);
    }
    return [...seen.values()];
  }, [tools]);

  // The CURRENT todo list = the LAST TodoWrite call's snapshot (each call carries
  // the whole list with updated statuses). We surface it as ONE prominent, live
  // panel at the top of the group instead of a pile of collapsed "Planned" steps —
  // so you watch items tick off as the agent completes them (the claude-code feel).
  // Superseded snapshots aren't re-listed; the todo turns are pulled out of the
  // step list below.
  const todoTurn = useMemo(() => {
    for (let i = tools.length - 1; i >= 0; i--) {
      const t = tools[i];
      if (
        t.name.toLowerCase() === "todowrite" &&
        Array.isArray((t.input as Record<string, unknown> | undefined)?.todos)
      ) {
        return t;
      }
    }
    return null;
  }, [tools]);
  const stepTools = useMemo(
    () => tools.filter((t) => t.name.toLowerCase() !== "todowrite"),
    [tools],
  );

  // a sub-agent (Task) → a nested AgentStep carrying its children (recursive, so
  // deeper fan-outs nest too); every other tool → a leaf ActivityStep.
  const renderNode = (t: ToolTurn): React.ReactNode =>
    isAgentTurn(t) ? (
      <AgentStep
        turn={t}
        childTools={childrenByAgent.get(t.id) ?? []}
        live={live}
        renderChild={renderNode}
      />
    ) : (
      <ActivityStep turn={t} live={live} />
    );

  const n = tools.length;
  const label = live
    ? `Working… ${fmtClock(elapsedMs)}`
    : durationMs != null
      ? `Worked for ${fmtDuration(durationMs)}`
      : `${n} step${n === 1 ? "" : "s"}`;

  return (
    <div
      className={`group/actg relative flex flex-col overflow-hidden rounded-xl border transition-colors ${
        live
          ? "border-[color-mix(in_srgb,var(--color-accent)_24%,transparent)]"
          : "border-[var(--color-border)]"
      } bg-[color-mix(in_srgb,var(--color-panel)_40%,transparent)]`}
    >
      <button
        type="button"
        onClick={() => setUserToggled(!open)}
        className="group/act flex w-full items-center gap-2 px-3 py-1.5 text-left font-sans text-[12.5px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text-2)]"
      >
        {live ? (
          <Loader2 size={13} className="shrink-0 animate-spin text-[var(--color-accent)]" />
        ) : (
          <Terminal size={12} className="shrink-0 text-[var(--color-faint)]" />
        )}
        {live ? <CadencedShimmer>{label}</CadencedShimmer> : <span>{label}</span>}
        {live && phase && <RunRail phase={phase} />}
        {/* step count only complements a "Worked for Xs" label — when there's no
            duration the label IS the step count, so don't print it twice
            (the "2 steps · 2 steps" dup). */}
        {!live && durationMs != null && n > 0 && (
          <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--color-faint)] tabular-nums transition-opacity group-hover/actg:opacity-0">
            {n} step{n === 1 ? "" : "s"}
          </span>
        )}
        <ChevronDown
          size={12}
          className={`shrink-0 text-[var(--color-faint)] transition-transform ${open ? "" : "-rotate-90"} ${
            !live && durationMs != null && n > 0 ? "" : "ml-auto"
          }`}
        />
        {/* replay (run cinema) — sibling-positioned via the absolute span so
            it never nests a button inside this button; reveals on hover. */}
      </button>
      {/* replay (run cinema) — absolutely positioned at the group's top-right so
          it never reserves vertical space in flow (the invisible-but-present
          block used to wedge a ~20px gap under every collapsed group). Reveals
          on hover / keyboard focus. */}
      {!live && replaySeg != null && onReplaySeg && (
        <button
          type="button"
          onClick={() => onReplaySeg(replaySeg)}
          title="replay this run (run cinema)"
          className="absolute top-1.5 right-8 flex h-5 w-fit items-center gap-1 rounded px-1.5 font-mono text-[10px] text-[var(--color-faint)] opacity-0 transition-opacity hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)] focus-visible:opacity-100 group-hover/actg:opacity-100"
        >
          ▶ replay
        </button>
      )}

      {open && n > 0 && (
        <div className="flex flex-col gap-0.5 border-t border-[var(--color-border)] px-3 py-2">
          {/* the LIVE task list — always shown (not behind a step toggle), updates
              in place as the agent checks items off. */}
          {todoTurn && (
            <div className="mb-1.5 flex flex-col gap-1">
              <div className="flex items-center gap-1.5 font-sans text-[11px] font-medium text-[var(--color-text-2)]">
                <ListChecks size={13} className="shrink-0 text-[var(--color-accent)]" />
                Tasks
              </div>
              <TodoList todos={(todoTurn.input as Record<string, unknown>).todos as Array<Record<string, unknown>>} />
            </div>
          )}
          {/* live fleet glance while a fan-out is in flight; the nested Agent rows
              below are the permanent record. */}
          {live && fleet.length > 0 && <FleetView agents={fleet} />}
          {stepTools.map((t) => (
            <div key={t.id}>{renderNode(t)}</div>
          ))}
        </div>
      )}

      {artifacts.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-[var(--color-border)] px-3 py-2">
          {artifacts.map((a) => (
            <FileCard key={a.path} artifact={a} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Memoized: a step's props (its `turn` object ref + the `live` flag) are stable
 *  across a parent re-render, so React bails out of re-rendering every historical
 *  tool step on each `now` tick, hover, or subscription-driven render. That
 *  reconciliation was the dominant per-render cost in long, tool-heavy transcripts
 *  — multiplied by every open chat pane (the "2-3 long chats → laggy" report).
 *  content-visibility already skips off-screen PAINT; this skips their re-render.
 *  (ActivityStepImpl is hoisted, so referencing it here before its declaration is
 *  safe.) */
const ActivityStep = memo(ActivityStepImpl);

/** One activity step: tool icon + verb + truncated target, expandable to its
 *  full input detail (Bash command, Edit diff, Todo checklist, or args) + result.
 *  While the turn is live, the currently-running step (no result yet) auto-opens
 *  so you watch the work happen — exactly the claude-code feel. */
function ActivityStepImpl({ turn, live }: { turn: ToolTurn; live: boolean }) {
  const Icon = toolIcon(turn.name);
  const verb = toolVerb(turn.name);
  const { label, full } = toolTarget(turn);
  const running = turn.result == null;
  const hasResult = turn.result != null && turn.result.trim().length > 0;
  const detail = toolDetail(turn);
  const expandable = hasResult || detail != null;
  // the real, model-emitted file path this tool acted on → deterministic open.
  const filePath = toolFilePath(turn);
  const openInPane = useChatFileOpener();

  // running step opens itself while the turn is live, and an errored step always
  // opens (you want to see what broke); otherwise user-controlled. (AI Elements
  // `Tool` lifecycle: auto-expand on running, error.)
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const open = userToggled ?? ((live && running) || turn.isError === true);

  return (
    <div className="group/step flex flex-col">
      <div className="flex w-full items-center gap-2 rounded-md py-0.5 pr-1">
      <button
        type="button"
        onClick={() => expandable && setUserToggled(!open)}
        title={full || undefined}
        className={`flex min-w-0 flex-1 items-center gap-2 text-left ${
          expandable ? "cursor-pointer" : "cursor-default"
        }`}
      >
        <Icon size={13} className="shrink-0 text-[var(--color-faint)]" />
        <span className="shrink-0 font-sans text-[12px] text-[var(--color-text-2)]">
          {verb}
        </span>
        {label && (
          <span className="truncate font-mono text-[11.5px] text-[var(--color-muted)]">
            {label}
          </span>
        )}
        <span className="flex-1" />
      </button>
        {filePath && (
          <button
            type="button"
            title={`open ${filePath} in pane`}
            onClick={(e) => {
              e.stopPropagation();
              openInPane(filePath);
            }}
            className="shrink-0 grid h-5 w-5 place-items-center rounded text-[var(--color-faint)] opacity-0 transition-opacity hover:bg-[var(--color-panel)] hover:text-[var(--color-accent)] group-hover/step:opacity-100"
          >
            <FileText size={12} />
          </button>
        )}
        {running ? (
          <Loader2 size={11} className="shrink-0 animate-spin text-[var(--color-faint)]" />
        ) : turn.isError ? (
          <X size={12} className="shrink-0 text-[var(--color-danger)]" />
        ) : expandable ? (
          <button
            type="button"
            onClick={() => setUserToggled(!open)}
            className="shrink-0"
          >
            <ChevronRight
              size={12}
              className={`text-[var(--color-faint)] transition-transform ${open ? "rotate-90" : ""}`}
            />
          </button>
        ) : null}
      </div>
      {open && (
        <div className="mb-1 ml-[7px] flex flex-col gap-1.5 border-l border-[var(--color-border)] pl-3 pt-1">
          {detail}
          {hasResult && (
            <div className="relative">
              <pre
                className={`max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-panel)]/60 px-2.5 py-2 pr-7 font-mono text-[11px] leading-relaxed ${
                  turn.isError ? "text-[var(--color-danger)]" : "text-[var(--color-muted)]"
                }`}
              >
                {turn.result}
              </pre>
              <CopyButton
                text={turn.result ?? ""}
                size={11}
                title="copy output"
                className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Renders the rich INPUT detail for a tool — the part claude code shows inline:
 *  the Bash command, an Edit's diff, a TodoWrite checklist, or the raw args.
 *  Returns null when the target label already says everything (e.g. a plain Read). */
function toolDetail(turn: ToolTurn): React.ReactNode {
  const name = turn.name.toLowerCase();
  const inp = turn.input ?? {};
  const str = (k: string) =>
    typeof inp[k] === "string" ? (inp[k] as string) : undefined;

  if (
    name === "bash" ||
    name === "powershell" ||
    name === "bashoutput" ||
    name === "exec_command" ||
    name === "write_stdin"
  ) {
    const cmd = str("command") ?? str("cmd") ?? str("chars");
    if (!cmd) return null;
    return (
      <div className="relative">
        <pre className="overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 pr-7 font-mono text-[11px] leading-relaxed text-[var(--color-text-2)]">
          <span className="select-none text-[var(--color-accent)]">$ </span>
          {cmd}
        </pre>
        <CopyButton
          text={cmd}
          size={11}
          title="copy command"
          className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded text-[var(--color-faint)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
        />
      </div>
    );
  }

  if (name === "edit" || name === "multiedit") {
    const edits =
      name === "multiedit" && Array.isArray(inp.edits)
        ? (inp.edits as Array<Record<string, unknown>>)
        : [{ old_string: inp.old_string, new_string: inp.new_string }];
    const blocks = edits
      .map((e, i) => {
        const oldS = typeof e.old_string === "string" ? e.old_string : "";
        const newS = typeof e.new_string === "string" ? e.new_string : "";
        if (!oldS && !newS) return null;
        return <DiffBlock key={i} oldText={oldS} newText={newS} />;
      })
      .filter(Boolean);
    return blocks.length > 0 ? <>{blocks}</> : null;
  }

  if (name === "todowrite" && Array.isArray(inp.todos)) {
    return <TodoList todos={inp.todos as Array<Record<string, unknown>>} />;
  }

  if (name === "write") {
    const content = str("content");
    if (!content) return null;
    const preview = content.split("\n").slice(0, 24).join("\n");
    const more = content.split("\n").length - 24;
    return (
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-text-2)]">
        {preview}
        {more > 0 && (
          <span className="text-[var(--color-faint)]">{`\n… +${more} more lines`}</span>
        )}
      </pre>
    );
  }

  if (name === "task" || name === "agent" || name === "subagent" || name === "sub-agent") {
    const prompt = str("prompt");
    if (!prompt) return null;
    return (
      <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 font-sans text-[11.5px] leading-relaxed text-[var(--color-muted)]">
        {prompt.length > 600 ? prompt.slice(0, 600) + "…" : prompt}
      </div>
    );
  }

  // notebook cell edit → show the new source (like Write), so a notebook change
  // isn't a black box next to a plain-file diff.
  if (name === "notebookedit") {
    const src = str("new_source") ?? str("source") ?? str("content");
    if (!src) return null;
    const preview = src.split("\n").slice(0, 24).join("\n");
    const more = src.split("\n").length - 24;
    return (
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-text-2)]">
        {preview}
        {more > 0 && <span className="text-[var(--color-faint)]">{`\n… +${more} more lines`}</span>}
      </pre>
    );
  }

  // Generic completeness net — ANY other tool (MCP calls, Skill, ExitPlanMode's
  // raw input, or a tool we've never seen) still shows its full parameters as
  // pretty JSON, so no tool call is an opaque row. Trivial/empty inputs fall
  // through to null (the row's target line already carries them).
  const keys = Object.keys(inp);
  if (keys.length > 0) {
    let json: string;
    try {
      json = JSON.stringify(inp, null, 2);
    } catch {
      json = String(inp);
    }
    if (!json || json === "{}" || json === "null") return null;
    const clipped = json.length > 2000 ? `${json.slice(0, 2000)}\n…` : json;
    return (
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-bg)] px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-text-2)]">
        {clipped}
      </pre>
    );
  }

  return null;
}

/** Collapsible context-compaction segment card (P2). Claude folds the running
 *  context into a summary; this marks the boundary inline — a quiet divider with
 *  the token savings, expanding to the trigger, before/after tokens, duration and
 *  the recap the model now carries forward. Built from a `system`/`compact_boundary`
 *  event + the synthetic summary that follows (see detectCompaction / compactionSummary). */
function CompactionCard({
  turn,
  forceOpen,
}: {
  turn: Extract<Turn, { kind: "compaction" }>;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const expanded = open || Boolean(forceOpen);
  const { preTokens: pre, postTokens: post } = turn;
  const savedPct =
    pre != null && post != null && pre > 0 ? Math.round((1 - post / pre) * 100) : null;
  const fmtTok = (n?: number) =>
    n == null ? "?" : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
  const headline =
    pre != null && post != null
      ? `${fmtTok(pre)} → ${fmtTok(post)} tokens${savedPct != null ? ` · saved ${savedPct}%` : ""}`
      : "context compacted";
  return (
    <div className="my-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-2.5 text-[11px] text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)]"
        title={expanded ? "hide compaction details" : "show what was compacted"}
        aria-expanded={expanded}
      >
        <span className="h-px flex-1 bg-[var(--color-border)]" />
        <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
          <History size={11} className="text-[var(--color-accent)]" />
          compacted · {headline}
          {turn.trigger ? ` · ${turn.trigger}` : ""}
          <ChevronRight
            size={11}
            className={`transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </span>
        <span className="h-px flex-1 bg-[var(--color-border)]" />
      </button>
      <div className="disclose" data-open={expanded}>
        <div>
          <div className="glass mt-2 rounded-lg px-3 py-2.5 text-[11.5px] leading-relaxed text-[var(--color-text-2)]">
            <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10.5px] text-[var(--color-muted)]">
              {turn.trigger && <span>trigger: {turn.trigger}</span>}
              {pre != null && <span>before: {pre.toLocaleString()}</span>}
              {post != null && <span>after: {post.toLocaleString()}</span>}
              {pre != null && post != null && <span>saved: {(pre - post).toLocaleString()}</span>}
              {turn.durationMs != null && <span>took: {(turn.durationMs / 1000).toFixed(1)}s</span>}
            </div>
            {turn.summary ? (
              <div className="max-h-72 overflow-auto whitespace-pre-wrap break-words">
                {turn.summary}
              </div>
            ) : (
              <div className="italic text-[var(--color-faint)]">
                summary not captured — the conversation continues from the compacted context.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** A red/green diff for an Edit's old → new strings. Long sides cap to a preview
 *  with a "+N more lines" tail (opcode/claude-code-webui pattern) so a big edit
 *  doesn't flood the transcript; click the tail to reveal the rest. */
const DIFF_PREVIEW = 6;
/** A real interleaved line diff (context + removed + added) for an Edit's
 *  old → new strings, with a +adds/-dels stat (P4). Replaces the old all-red-then-
 *  all-green dump. Long diffs cap to a preview with a "show more" tail. */
function DiffBlock({
  oldText,
  newText,
  embedded = false,
}: {
  oldText: string;
  newText: string;
  /** Inside a ChangeCard the card owns the frame + stat, so drop our own. */
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const diff = useMemo(() => refineDiff(lineDiff(oldText, newText)), [oldText, newText]);
  const { adds, dels } = diffStat(diff);
  const collapsible = diff.length > DIFF_PREVIEW;
  const head = collapsible ? diff.slice(0, DIFF_PREVIEW) : diff;
  const tail = collapsible ? diff.slice(DIFF_PREVIEW) : [];

  const row = (l: DiffLine, key: string) => {
    const isDel = l.kind === "del";
    const isAdd = l.kind === "add";
    const lineBg = isDel
      ? "bg-[var(--color-danger)]/10"
      : isAdd
        ? "bg-[var(--color-success)]/10"
        : "";
    const lineText = isDel
      ? "text-[var(--color-danger)]"
      : isAdd
        ? "text-[var(--color-success)]"
        : "text-[var(--color-text-2)]";
    const segBg = isDel ? "bg-[var(--color-danger)]/30" : "bg-[var(--color-success)]/30";
    const sign = isDel ? "-" : isAdd ? "+" : " ";
    return (
      <div key={key} className={`whitespace-pre-wrap break-words px-2.5 ${lineBg} ${lineText}`}>
        <span className="select-none opacity-50">{sign} </span>
        {l.segments
          ? l.segments.map((s, si) =>
              s.changed ? (
                <span key={si} className={`rounded-[2px] ${segBg}`}>
                  {s.text}
                </span>
              ) : (
                <span key={si}>{s.text}</span>
              ),
            )
          : l.text || " "}
      </div>
    );
  };

  const rows = (
    <pre className="overflow-x-auto font-mono text-[11px] leading-relaxed">
      {head.map((l, i) => row(l, `h${i}`))}
      {tail.length > 0 && (
        <div className="disclose" data-open={open}>
          <div>{tail.map((l, i) => row(l, `t${i}`))}</div>
        </div>
      )}
      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="block w-full px-2.5 py-1 text-left text-[10.5px] italic text-[var(--color-faint)] transition-colors hover:text-[var(--color-muted)]"
        >
          {open ? "collapse" : `expand · +${tail.length} more line${tail.length === 1 ? "" : "s"}`}
        </button>
      )}
    </pre>
  );
  if (embedded) return rows;
  return (
    <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-bg)]">
      <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-2.5 py-1 font-mono text-[10.5px]">
        <span className="text-[var(--color-success)]">+{adds}</span>
        <span className="text-[var(--color-danger)]">-{dels}</span>
      </div>
      {rows}
    </div>
  );
}

/** Renders a TodoWrite checklist — pending / in-progress / done, with a
 *  "N of M done" progress footer. claude-code-webui / AI Elements `Task` style. */
function TodoList({ todos }: { todos: Array<Record<string, unknown>> }) {
  const done = todos.filter((t) => String(t.status) === "completed").length;
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel)_50%,transparent)] px-2.5 py-2">
      {todos.map((t, i) => {
        const status = String(t.status ?? "pending");
        const content =
          (typeof t.content === "string" && t.content) ||
          (typeof t.activeForm === "string" && t.activeForm) ||
          "";
        const active =
          status === "in_progress" && typeof t.activeForm === "string"
            ? (t.activeForm as string)
            : null;
        return (
          <div key={i} className="flex items-start gap-2 font-sans text-[11.5px] leading-relaxed">
            {status === "completed" ? (
              <Check size={13} className="mt-0.5 shrink-0 text-[var(--color-success)]" />
            ) : status === "in_progress" ? (
              <Loader2 size={13} className="mt-0.5 shrink-0 animate-spin text-[var(--color-accent)]" />
            ) : (
              <Square size={13} className="mt-0.5 shrink-0 text-[var(--color-faint)]" />
            )}
            <span className="flex min-w-0 flex-col">
              <span
                className={
                  status === "completed"
                    ? "text-[var(--color-faint)] line-through"
                    : status === "in_progress"
                      ? "text-[var(--color-text)]"
                      : "text-[var(--color-muted)]"
                }
              >
                {content}
              </span>
              {active && active !== content && (
                <span className="text-[10.5px] italic text-[var(--color-faint)]">
                  {active}
                </span>
              )}
            </span>
          </div>
        );
      })}
      {todos.length > 0 && (
        <div className="mt-1.5 flex items-center gap-2 border-t border-[var(--color-border)] pt-1.5">
          {/* progress meter — same accent→glow bar language as the app's other
              meters (context filament, pet bond) so the checklist reads native. */}
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)]">
            <div
              className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--osai-accent-2))] transition-[width] duration-500"
              style={{ width: `${Math.round((done / todos.length) * 100)}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-[10px] tabular-nums text-[var(--color-faint)]">
            {done}/{todos.length}
          </span>
        </div>
      )}
    </div>
  );
}

/** Clean artifact card for a file a turn produced (Codex "Open in…"). Click →
 *  open as an in-app viewer pane (image/pdf/text preview); falls back to the OS
 *  app only if no pane opener is wired. Icon keyed by file type. */
function FileCard({ artifact }: { artifact: Artifact }) {
  const openInPane = useChatFileOpener();
  const Icon =
    artifact.kind === "img"
      ? ImageIcon
      : artifact.kind === "pdf" || artifact.kind === "doc"
        ? FileType
        : artifact.kind === "code"
          ? FileCode
          : FileText;
  // surface failures instead of swallowing them — a denied scope or missing
  // file briefly flips the label to the reason so it's debuggable, not silent.
  const [err, setErr] = useState<string | null>(null);
  const openWith = (mode: "editor" | "viewer" | "files") => {
    setErr(null);
    const ok =
      mode === "editor"
        ? openEditorFileInPane(artifact.path, artifact.name)
        : mode === "viewer"
          ? openViewerFileInPane(artifact.path, artifact.name)
          : revealFileInPane(artifact.path, artifact.name);
    if (ok) return;
    openPath(artifact.path).catch((e) => {
      setErr(String(e));
      console.error("openPath failed:", artifact.path, e);
    });
  };
  const open = () => {
    setErr(null);
    // absolute path (claude file_path) → open directly; a relative one (some
    // codex apply_patch paths) → resolve against the session cwd first. Both
    // route through the same paneBus open primitive as FilesPane.
    if (artifact.path.startsWith("/") || artifact.path.startsWith("~/")) {
      if (openFileInPane(artifact.path, artifact.name)) return;
      openPath(artifact.path).catch((e) => {
        setErr(String(e));
        console.error("openPath failed:", artifact.path, e);
      });
      return;
    }
    openInPane(artifact.path);
  };
  return (
    <div
      title={err ? `${err} — ${artifact.path}` : `open ${artifact.path}`}
      className={`group/file flex max-w-full items-center gap-2.5 rounded-lg border bg-[var(--color-panel-2)]/55 px-3 py-2 text-left backdrop-blur-md transition-colors ${
        err
          ? "border-[var(--color-danger)]/50"
          : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
      }`}
    >
      <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <Icon size={14} />
        </span>
        <span className="min-w-0 flex flex-col">
          <span className="truncate font-mono text-[12px] text-[var(--color-text)]">
            {artifact.name}
          </span>
          <span
            className={`font-sans text-[10.5px] ${
              err
                ? "text-[var(--color-danger)]"
                : "text-[var(--color-faint)] group-hover/file:text-[var(--color-muted)]"
            }`}
          >
            {err ? "couldn’t open — see tooltip" : "open"}
          </span>
        </span>
      </button>
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover/file:opacity-100">
        <ArtifactActionButton label="editor" icon={<Pencil size={12} />} onClick={() => openWith("editor")} />
        <ArtifactActionButton label="viewer" icon={<FileType size={12} />} onClick={() => openWith("viewer")} />
        <ArtifactActionButton label="files" icon={<Folder size={12} />} onClick={() => openWith("files")} />
      </span>
    </div>
  );
}

/** Prominent, always-visible card for a file the AI edited or created (P4). Lives
 *  in the transcript flow (not the collapsed activity group), so the change + its
 *  diff are visible without a click; the header opens the file in a pane. Replaces
 *  the old buried "Edited X ›" row + the separate "open" artifact card (the dup). */
function ChangeCard({ turn }: { turn: ToolTurn }) {
  const openInPane = useChatFileOpener();
  const [err, setErr] = useState<string | null>(null);
  const name0 = turn.name.toLowerCase();
  const inp = turn.input ?? {};
  const path =
    (typeof inp.file_path === "string" && inp.file_path) ||
    (typeof inp.path === "string" && inp.path) ||
    (typeof inp.notebook_path === "string" && inp.notebook_path) ||
    "";
  const name = path ? baseName(path) : turn.name;
  const verb = name0 === "write" ? "created" : "edited";
  const { adds, dels } = editStat(turn);

  const edits =
    name0 === "multiedit" && Array.isArray(inp.edits)
      ? (inp.edits as Array<Record<string, unknown>>).map((e) => ({
          oldS: typeof e.old_string === "string" ? e.old_string : "",
          newS: typeof e.new_string === "string" ? e.new_string : "",
        }))
      : name0 === "write"
        ? []
        : [
            {
              oldS: typeof inp.old_string === "string" ? inp.old_string : "",
              newS: typeof inp.new_string === "string" ? inp.new_string : "",
            },
          ];
  const writeContent =
    name0 === "write" && typeof inp.content === "string" ? inp.content : "";
  const writeLines = writeContent ? writeContent.split("\n") : [];

  const open = () => {
    if (!path) return;
    setErr(null);
    if (path.startsWith("/") || path.startsWith("~/")) {
      if (openFileInPane(path, name)) return;
      openPath(path).catch((e) => setErr(String(e)));
      return;
    }
    openInPane(path);
  };

  return (
    <div className="osai-spotlight glass overflow-hidden rounded-xl" onMouseMove={spotlightMove}>
      <button
        type="button"
        onClick={open}
        title={err ? `${err} — ${path}` : path ? `open ${path}` : undefined}
        className="group/chg flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-[var(--color-panel-2)]/50"
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
          <FileCode size={13} />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2">
          <span className="truncate font-mono text-[12px] text-[var(--color-text)]">{name}</span>
          <span className="shrink-0 font-sans text-[10.5px] text-[var(--color-faint)]">
            {err ? "couldn’t open" : verb}
          </span>
        </span>
        <span className="shrink-0 font-mono text-[10.5px]">
          {adds > 0 && <span className="text-[var(--color-success)]">+{adds}</span>}
          {adds > 0 && dels > 0 && <span className="px-1 text-[var(--color-faint)]">·</span>}
          {dels > 0 && <span className="text-[var(--color-danger)]">-{dels}</span>}
        </span>
        <span className="shrink-0 font-sans text-[10.5px] text-[var(--color-faint)] opacity-0 transition-opacity group-hover/chg:opacity-100">
          open ›
        </span>
      </button>
      <div className="border-t border-[var(--color-border)] bg-[var(--color-bg)]">
        {writeContent ? (
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[11px] leading-relaxed text-[var(--color-text-2)]">
            {writeLines.slice(0, 40).join("\n")}
            {writeLines.length > 40 && (
              <span className="text-[var(--color-faint)]">{`\n… +${writeLines.length - 40} more lines`}</span>
            )}
          </pre>
        ) : (
          edits
            .filter((e) => e.oldS || e.newS)
            .map((e, i) => (
              <div key={i} className={i > 0 ? "border-t border-[var(--color-border)]" : ""}>
                <DiffBlock oldText={e.oldS} newText={e.newS} embedded />
              </div>
            ))
        )}
      </div>
    </div>
  );
}

/** P4d — a roll-up of every file the AI edited/created this chat. Collapsed to a
 *  one-line chip; expands to the file list, each row opening the file in a pane. */
function ChangedFilesBar({
  files,
}: {
  files: Array<{ path: string; name: string; edits: number; adds: number; dels: number }>;
}) {
  const [open, setOpen] = useState(false);
  const openInPane = useChatFileOpener();
  const totalAdds = files.reduce((s, f) => s + f.adds, 0);
  const totalDels = files.reduce((s, f) => s + f.dels, 0);
  const openFile = (path: string, name: string) => {
    if (path.startsWith("/") || path.startsWith("~/")) {
      if (openFileInPane(path, name)) return;
      openPath(path).catch(() => {});
      return;
    }
    openInPane(path);
  };
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)]/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left font-sans text-[12px] text-[var(--color-text-2)] transition-colors hover:bg-[var(--color-panel-2)]"
      >
        <FileCode size={13} className="shrink-0 text-[var(--color-accent)]" />
        <span className="font-medium">
          {files.length} file{files.length === 1 ? "" : "s"} changed
        </span>
        <span className="ml-auto shrink-0 font-mono text-[10.5px]">
          {totalAdds > 0 && <span className="text-[var(--color-success)]">+{totalAdds}</span>}
          {totalAdds > 0 && totalDels > 0 && <span className="px-1 text-[var(--color-faint)]">·</span>}
          {totalDels > 0 && <span className="text-[var(--color-danger)]">-{totalDels}</span>}
        </span>
        <ChevronRight
          size={13}
          className={`shrink-0 text-[var(--color-faint)] transition-transform ${open ? "rotate-90" : ""}`}
        />
      </button>
      <div className="disclose" data-open={open}>
        <div className="border-t border-[var(--color-border)]">
          {files.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => openFile(f.path, f.name)}
              title={`open ${f.path}`}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors hover:bg-[var(--color-panel-2)]"
            >
              <span className="truncate font-mono text-[11.5px] text-[var(--color-text)]">{f.name}</span>
              {f.edits > 1 && (
                <span className="shrink-0 font-sans text-[10px] text-[var(--color-faint)]">×{f.edits}</span>
              )}
              <span className="ml-auto shrink-0 font-mono text-[10.5px]">
                {f.adds > 0 && <span className="text-[var(--color-success)]">+{f.adds}</span>}
                {f.adds > 0 && f.dels > 0 && <span className="px-1 text-[var(--color-faint)]">·</span>}
                {f.dels > 0 && <span className="text-[var(--color-danger)]">-{f.dels}</span>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ArtifactActionButton({
  label,
  icon,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="grid h-6 w-6 place-items-center rounded text-[var(--color-muted)] hover:bg-[var(--color-panel)] hover:text-[var(--color-text)]"
    >
      {icon}
    </button>
  );
}

const HELP_TEXT = `**OSAI chat**

- type to talk to claude — streams token by token
- \`/\` opens commands · \`@\` mentions files from the working dir
- **plan** chip → plan-first on the next message
- **goal** pill → context kept across turns until cleared
- ${chord("J")} dictates into the composer
- stop (■) interrupts mid-turn; the session survives
- hover a message to copy or regenerate`;

