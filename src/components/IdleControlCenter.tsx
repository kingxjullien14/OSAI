/**
 * IdleControlCenter — the AIOS home screen, shown when no panes are open.
 *
 * Minimal in structure, premium in finish (Option B). One clear focal hierarchy:
 *
 *   clock  →  command line  →  usage glance  →  launch row
 *
 * A gorgeous hero clock + calm greeting is the centre of gravity. Below it the
 * one thing you touch: a composer-grade "start something…" input that seeds a
 * fresh chat with whatever you type. Claude + codex usage sit quiet to the right
 * of the clock (the shared UsageGlance ProviderBlock — ONE source with the
 * sidebar). One launch row near the bottom — recent projects + quick actions +
 * pinned chips + a thin status footer — is the "jump back into work" affordance.
 * A tiny ambient pet sits in the top-right corner as the one playful touch.
 *
 * Everything else the old control center carried (jarvis lane, notification
 * cards, the agent-ops grid, charts, the 8-metric vanity band, the duplicate
 * heatmap) is gone — that's pane material, opened on purpose, not home-at-rest
 * noise.
 *
 * Craft language is borrowed from the chat-pane composer (TerminalComposer):
 * the rounded glass surface (radius-xl), the focus glow + accent top-edge sheen,
 * the gradient accent send button, refined type hierarchy on the theme vars.
 *
 * The faint ambient drift + entrance fade respect Settings' reduce-motion
 * (`data-reduce-motion` on :root) via the shared App.css rules.
 *
 * TDZ note (this caused a black idle screen historically): every derived const
 * (`recent`, the count expressions, `weeks`) is declared at the top of the
 * component BEFORE any JSX or hook reads it — never forward-referenced. The data
 * loading lives one level up in IdleDashboard; this component is presentation +
 * the command-line local state only.
 */
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ArrowUp,
  Check,
  FolderGit2,
  Globe,
  History,
  Search,
  Sparkles,
  Terminal,
  X,
} from "lucide-react";

import type { AppDef } from "../App";
import { engineForProvider } from "../lib/chat";
import type { IdleRate, MemoryFocus } from "../lib/dashboard";
import type { RepoPulse } from "../lib/fs";
import { loadSettings } from "../lib/settings";
import type { ScheduledAgentSummary } from "../lib/scheduledAgents";
import type { AiosNotification } from "../lib/notifications";
import type { ProjectInfo } from "../lib/run";
import type { SidebarItem, SidebarState } from "../lib/sidebar";
import type { UsageExtras } from "../lib/stats";
import { AnimatePresence, m } from "motion/react";

import { ProviderBlock, useUsageRates } from "./dashboard/UsageGlance";
import { listChatHistory, chatHistoryMeta, type HistoryEntry } from "../lib/chatHistory";
import { type Workspace } from "../lib/workspaces";
import { type WorkSession } from "../lib/workSessions";
import { displayName, subscribe as subscribeSettings } from "../lib/settings";
import { chord } from "../lib/platform";
import { setPaletteMorphSource } from "../lib/paletteMorph";
import { BlurText } from "./fx/BlurText";
import { Confetti } from "./fx/Confetti";
import { DotPattern } from "./fx/DotPattern";
import { Ripple } from "./fx/Ripple";
import { Spotlight } from "./fx/Spotlight";
import { spotlightMove } from "./fx/spotlightGlow";
import { useFunFx } from "./fx/funFx";
import { useRotatingPlaceholder } from "./fx/useRotatingPlaceholder";
import { useVanish } from "./fx/useVanish";
import { subscribePetConfetti } from "../lib/pet";

const PetDashboardCompanion = lazy(() =>
  import("./PetPane").then((mod) => ({ default: mod.PetDashboardCompanion })),
);

export function IdleControlCenter({
  projects,
  sidebar,
  extras,
  rate,
  focus,
  pulse,
  scheduledAgents,
  notifications,
  onSpawn,
  onOpenProject,
  onOpenSidebarItem,
  onRevealSidebar,
  onOpenScheduledAgents,
  onOpenPet,
  onOpenPalette,
  onResumeLast,
  resumeLabel,
  resumeLayout,
  onResumeLayout,
  onTalkToJarvis,
  onApplyWorkspace,
  shapeByRoot,
  workSessions,
  onResumeSession,
  onRemoveSession,
  onDoneSession,
}: {
  projects: ProjectInfo[];
  sidebar: SidebarState;
  extras: UsageExtras | null;
  /** claude's 5h/7d/ctx — kept for the ctx glance; bars come from useUsageRates. */
  rate: IdleRate | null;
  focus: MemoryFocus | null;
  pulse: RepoPulse[];
  scheduledAgents: ScheduledAgentSummary[];
  notifications: AiosNotification[];
  onSpawn: (kind: AppDef["kind"], label: string) => void;
  onOpenProject: (p: ProjectInfo) => void;
  onOpenSidebarItem: (item: SidebarItem) => void;
  onRevealSidebar: () => void;
  onOpenScheduledAgents: () => void;
  onOpenPet: () => void;
  onOpenPalette: () => void;
  /** resume the most recent chat session (omitted when there are none). */
  onResumeLast?: () => void;
  resumeLabel?: string;
  /** "pick up where you left off" — panes to bring back; null hides the pill. */
  resumeLayout?: { count: number; labels: string[] } | null;
  onResumeLayout?: () => void;
  /** seed a fresh chat pane with the command-line text (spawns a chat). */
  onTalkToJarvis: (seed: string) => void;
  /** restore a saved workspace (named pane layout) from its launch-row chip. */
  onApplyWorkspace?: (ws: Workspace) => void;
  /** root → shape label for structured workspaces; RecentProjects shows a hint chip. */
  shapeByRoot?: Record<string, string>;
  /** Work Sessions for the "Continue working" rail + a one-click resume (Tier 1). */
  workSessions?: WorkSession[];
  onResumeSession?: (s: WorkSession) => void;
  onRemoveSession?: (id: string) => void;
  onDoneSession?: (id: string) => void;
}) {
  // ── derived state — declared BEFORE any JSX/hook that reads them (TDZ-safe) ──
  const recent = [...projects].sort((a, b) => b.mtime - a.mtime).slice(0, 5);
  const activeAgents = scheduledAgents.filter(
    (agent) => agent.health === "due" || agent.health === "scheduled",
  ).length;
  const unread = notifications.filter((item) => !item.read).length;
  const dirtyProjects = pulse.filter(
    (repo) => repo.dirty || repo.ahead || repo.behind,
  ).length;
  const { claude, codex, hasClaude, hasCodex } = useUsageRates();
  const hasUsage = hasClaude || hasCodex;

  // recent chats for the "pick up where you left off" card (durable history).
  const [recentChats, setRecentChats] = useState<HistoryEntry[]>([]);
  useEffect(() => {
    let alive = true;
    listChatHistory(6)
      .then((h) => alive && setRecentChats(h))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  // Props retained for the interface but no longer rendered on this surface —
  // the bottom status/ambient band + workspace/pinned chips were removed by
  // design (owner: "the bottom part feels out").
  void onApplyWorkspace;
  void onOpenSidebarItem;
  void onOpenScheduledAgents;
  void sidebar;
  void rate;
  void extras;
  void focus;

  // liveness 0..1 — the backdrop breathes with what the system is actually
  // doing (agents running, repos with unpushed work, unread signals). Idle
  // reads calm-dim; a busy cockpit warms up. Opacity-only (composite-cheap),
  // 2s ease so wake-ups breathe in rather than snap.
  const liveness = Math.min(
    1,
    activeAgents * 0.45 + Math.min(dirtyProjects, 3) * 0.12 + (unread > 0 ? 0.18 : 0),
  );

  // personality layer (W5-5): the ripple rides high liveness; confetti bursts
  // when the pet earns it (long clean run). Both gate on funFx + reduce-motion.
  const funFx = useFunFx();
  const [confettiKey, setConfettiKey] = useState(0);
  useEffect(() => subscribePetConfetti(() => setConfettiKey((k) => k + 1)), []);

  return (
    // .aios-stage = the same animated aurora ground the chat pane uses, so the
    // home and chat share one background (owner request). The drift blooms below
    // layer extra life on top, like the chat empty-hero.
    <div className="aios-stage relative flex h-full flex-col overflow-hidden">
      {/* masked dot grid — quiet texture under the hero (pure SVG, no motion) */}
      <DotPattern />
      {/* one-shot accent spotlight sweep on arrival, settling over the blobs */}
      <Spotlight />
      {/* drifting accent + cyan blooms — the aurora breathes; reduce-motion kills it */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ opacity: 0.6 + liveness * 0.4, transition: "opacity 2s ease-in-out" }}
      >
        <div
          className="aios-drift-a absolute h-[52vh] w-[52vh] rounded-full blur-[120px]"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 20%, transparent), transparent 70%)" }}
        />
        <div
          className="aios-drift-b absolute h-[44vh] w-[44vh] rounded-full blur-[120px]"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--aios-accent-2) 14%, transparent), transparent 70%)" }}
        />
      </div>

      {/* tiny ambient pet — top-right corner, low-key. Scaled down via
          .aios-pet-mini (hides the head/actions, shrinks the world). The whole
          tile is the click target → opens the full pet pane, since the inner
          inspect button is hidden in the mini variant. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenPet}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpenPet())}
        title="open the pet pane"
        className="aios-pet-mini aios-fade-in pointer-events-auto absolute right-5 top-5 z-20 hidden cursor-pointer sm:block"
        style={{ animationDelay: "260ms" }}
      >
        {/* liveness ripple behind + earned confetti over the companion tile */}
        {funFx && liveness > 0.4 && <Ripple />}
        <Suspense fallback={null}>
          <PetDashboardCompanion onOpenPet={onOpenPet} onTalkToJarvis={onTalkToJarvis} />
        </Suspense>
        <Confetti trigger={confettiKey} />
      </div>

      {/* one centred, scrollable deck: the hero (clock + command + usage) AND
          the launch row, centred as ONE group via min-h-full + justify-center.
          This scrolls cleanly when tall (top stays reachable — no clipped
          greeting) and keeps the launch row adjacent to the content instead of
          slammed to the bottom with a dead band above it. */}
      <div className="relative z-10 min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-8 px-7 py-7">
          {/* top strip — brand mark + live status (Mission Control) */}
          <div className="flex items-center gap-3">
            <span className="grid h-7 w-7 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_34%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] shadow-[var(--aios-glow-soft)]">
              <span className="h-2.5 w-2.5 rotate-45 rounded-[3px] bg-[linear-gradient(135deg,var(--color-accent),var(--aios-accent-2))] shadow-[0_0_7px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]" />
            </span>
            <span className="font-mono text-[13px] font-semibold tracking-[0.3em] text-[var(--color-text-2)]">AIOS</span>
            <span className="flex-1" />
            {activeAgents > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)]/40 px-2.5 py-1 font-mono text-[10.5px] text-[var(--color-text-2)] backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] shadow-[0_0_7px_var(--color-success-glow)]" />
                {activeAgents} live
              </span>
            )}
          </div>

          {/* hero — greeting + the one question, with the composer below */}
          <div className="flex flex-col items-center gap-5 pt-1">
            <div className="flex flex-col items-center gap-2 text-center">
              <Greeting />
              <h1 className="text-[28px] font-semibold tracking-tight text-[var(--color-text)]">
                what should we{" "}
                <span className="bg-[linear-gradient(120deg,var(--color-accent),var(--aios-accent-2))] bg-clip-text text-transparent">
                  work
                </span>{" "}
                on?
              </h1>
            </div>
            {resumeLayout && onResumeLayout && (
              <button
                type="button"
                onClick={onResumeLayout}
                title={resumeLayout.labels.join(" · ")}
                className="aios-fade-in pill press flex items-center gap-1.5"
                style={{ animationDelay: "70ms" }}
              >
                <History size={11} className="shrink-0 text-[var(--color-muted)]" />
                pick up where you left off
                <span className="font-mono text-[10px] text-[var(--color-faint)]">
                  {resumeLayout.count} pane{resumeLayout.count === 1 ? "" : "s"}
                </span>
              </button>
            )}
            <div className="w-full max-w-[640px]">
              <CommandLine
                onSeedChat={onTalkToJarvis}
                onOpenPalette={onOpenPalette}
                projects={projects}
                onOpenProject={onOpenProject}
                onSpawn={onSpawn}
              />
            </div>
          </div>

          {/* quick launch — glass tiles */}
          <div className="flex flex-col gap-3">
            <Eyebrow>quick launch</Eyebrow>
            <QuickActions
              onSpawn={onSpawn}
              onOpenPalette={onOpenPalette}
              onRevealSidebar={onRevealSidebar}
              onResumeLast={onResumeLast}
              resumeLabel={resumeLabel}
            />
          </div>

          {/* two columns — recent projects + pick-up-where-you-left-off (chats) */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="flex flex-col gap-3">
              <Eyebrow>recent projects</Eyebrow>
              <RecentProjects projects={recent} pulse={pulse} onOpen={onOpenProject} shapeByRoot={shapeByRoot} />
            </div>
            <div className="flex flex-col gap-3">
              <Eyebrow>continue working</Eyebrow>
              {workSessions && workSessions.some((s) => s.status !== "done") && onResumeSession ? (
                <ContinueWorking
                  sessions={workSessions}
                  onResume={onResumeSession}
                  onRemove={onRemoveSession}
                  onDone={onDoneSession}
                />
              ) : (
                <MiniHistory
                  chats={recentChats}
                  onOpen={(c) =>
                    onSpawn(
                      { type: "chat", resume: { id: c.id, title: c.title, engine: c.engine } } as AppDef["kind"],
                      c.title || "chat",
                    )
                  }
                />
              )}
            </div>
          </div>

          {/* usage — one glass card per provider (claude / codex / opencode) */}
          {hasUsage && (
            <div className="flex flex-col gap-3">
              <Eyebrow>usage</Eyebrow>
              <div className="grid gap-4 sm:grid-cols-2">
                {hasClaude && (
                  <div className="surface-card rounded-2xl p-4">
                    <ProviderBlock
                      name="claude"
                      fiveHour={claude!.fiveHour}
                      sevenDay={claude!.sevenDay}
                      models={claude!.models}
                      showRemaining
                    />
                  </div>
                )}
                {hasCodex && (
                  <div className="surface-card rounded-2xl p-4">
                    <ProviderBlock
                      name="codex"
                      fiveHour={codex!.fiveHour}
                      sevenDay={codex!.sevenDay}
                      models={codex!.models}
                      showRemaining
                    />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── greeting + clock ─────────────────────────────────────────────────────────

/** Time-of-day greeting + lowercased date. 30s tick — cheap, isolated. */
function Greeting() {
  const [now, setNow] = useState(() => new Date());
  const [name, setName] = useState(() => displayName("there"));
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);
  // pick up the onboarding/Settings name live (single source: settings.userName).
  useEffect(() => subscribeSettings(() => setName(displayName("there"))), []);
  const h = now.getHours();
  const part =
    h < 5 ? "still up" : h < 12 ? "good morning" : h < 18 ? "good afternoon" : "good evening";
  // per-word blur-rise entrance (BlurText); the trailing word is the gradient
  // name node so it keeps its accent shimmer. Keyed by part+name so a time-of-
  // day flip or rename replays the entrance once (not on the 30s tick).
  const partWords = part.split(" ");
  const words: ReactNode[] = [
    ...partWords.map((w, i) => (i === partWords.length - 1 ? `${w},` : w)),
    <span key="name" className="aios-greet-name">
      {name}
    </span>,
  ];
  return (
    <div className="aios-fade-in flex flex-col items-center gap-1">
      <BlurText
        key={`${part}|${name}`}
        words={words}
        className="text-[15px] font-medium tracking-tight text-[var(--color-text-2)]"
      />
      <span className="font-mono text-[11px] tracking-[0.08em] text-[var(--color-muted)]">
        {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }).toLowerCase()}
      </span>
    </div>
  );
}

// ── command line — composer-grade seed-a-chat input ───────────────────────────

/** Last launched seed (↑ recall in the empty command line, depth 1). */
const LAST_SEED_KEY = "aios.home.lastSeed";

/** Rotating placeholder carousel — the line teaches its own grammar. */
const PHRASES = [
  "start something… ask, launch, or resume",
  "$ run a command in a terminal",
  "open a project by name",
  "/ for the command palette",
];

/**
 * The single primary action. Looks + feels like the chat-pane composer surface:
 * rounded glass (radius-xl), focus glow + accent top-edge sheen, accent caret,
 * gradient send button that lifts on hover. Submitting seeds a fresh chat pane
 * with the text; an empty submit (or the ⌘K kbd) opens the full command palette
 * so the input is never a dead end.
 */
function CommandLine({
  onSeedChat,
  onOpenPalette,
  projects,
  onOpenProject,
  onSpawn,
}: {
  onSeedChat: (seed: string) => void;
  onOpenPalette: () => void;
  projects: ProjectInfo[];
  onOpenProject: (p: ProjectInfo) => void;
  onSpawn: (kind: AppDef["kind"], label: string) => void;
}) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Aceternity placeholders-and-vanish, split across two fx hooks: the rotating
  // placeholder carousel (overlaid as an animated span, native placeholder
  // blanked) + the canvas dissolve on submit. Both reduce-motion-safe.
  const { canvasRef, vanishing, vanish } = useVanish(inputRef);
  const ph = useRotatingPlaceholder(PHRASES, value.trim().length === 0);

  // the home's primary affordance receives focus on arrival — type-to-start,
  // no click required (it never stole focus before).
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  // empty submit / the ⌘K kbd → the palette MORPHS out of this surface (FLIP):
  // record the rect; CommandPalette consumes it on its next mount.
  const openPaletteMorphed = useCallback(() => {
    const r = surfaceRef.current?.getBoundingClientRect();
    if (r) setPaletteMorphSource(r);
    onOpenPalette();
  }, [onOpenPalette]);

  // type-ahead intents — the line reads what you're typing and offers the
  // direct route: `$…` → a terminal, `/` → the palette, plain text → matching
  // recent projects. Chips, not interception: Enter still seeds a chat (the
  // line's contract) EXCEPT for the explicit `$`/`/` prefixes where a chat
  // seed is clearly not the intent; Tab (or click) takes the top chip.
  const intents = useMemo(() => {
    const text = value.trim();
    if (!text) return [] as { id: string; icon: ReactNode; label: string; hint?: string; run: () => void }[];
    const out: { id: string; icon: ReactNode; label: string; hint?: string; run: () => void }[] = [];
    if (text.startsWith("$")) {
      const cmd = text.slice(1).trim();
      out.push({
        id: "term",
        icon: <Terminal size={11} className="shrink-0 text-[var(--color-muted)]" />,
        label: cmd ? `run in a terminal: ${cmd}` : "open a terminal",
        run: () => {
          onSpawn(cmd ? ({ type: "shell", cmd } as AppDef["kind"]) : ({ type: "shell" } as AppDef["kind"]), cmd || "terminal");
          setValue("");
        },
      });
      return out;
    }
    if (text.startsWith("/")) {
      out.push({
        id: "palette",
        icon: <Search size={11} className="shrink-0 text-[var(--color-muted)]" />,
        label: "open the command palette",
        run: () => {
          onOpenPalette();
          setValue("");
        },
      });
      return out;
    }
    const q = text.toLowerCase();
    for (const p of projects) {
      if (!p.name.toLowerCase().includes(q)) continue;
      out.push({
        id: `proj:${p.root}`,
        icon: <FolderGit2 size={11} className="shrink-0 text-[var(--color-muted)]" />,
        label: `open ${p.name}`,
        hint: p.root,
        run: () => {
          onOpenProject(p);
          setValue("");
        },
      });
      if (out.length >= 2) break;
    }
    return out;
  }, [value, projects, onOpenProject, onOpenPalette, onSpawn]);

  const submit = useCallback(() => {
    const text = value.trim();
    if (!text) {
      openPaletteMorphed();
      return;
    }
    // explicit prefixes route to their intent — seeding a chat with "$ls"
    // or "/" is never what was meant.
    if ((text.startsWith("$") || text.startsWith("/")) && intents[0]) {
      intents[0].run();
      return;
    }
    try {
      localStorage.setItem(LAST_SEED_KEY, text);
    } catch {
      /* quota / unavailable — recall just won't work */
    }
    // dissolve the typed text (eye candy over the now-empty input) while the
    // chat seeds immediately — vanish is fire-and-forget + reduce-motion-safe.
    void vanish(text);
    onSeedChat(text);
    setValue("");
  }, [value, onSeedChat, openPaletteMorphed, intents, vanish]);

  // ↑ in the empty line recalls what you last launched (chat-style history,
  // depth 1 — the home is a launcher, not a transcript).
  const recallLast = useCallback(() => {
    try {
      const last = localStorage.getItem(LAST_SEED_KEY);
      if (last) setValue(last);
    } catch {
      /* unavailable */
    }
  }, []);

  const hasContent = value.trim().length > 0;
  // say WHICH agent this line launches — the engine the base provider resolves
  // to (the same one the seeded chat boots).
  const engineLabel = engineForProvider(loadSettings().chatProvider) ?? "claude";

  return (
    <form
      className="aios-fade-in w-full"
      style={{ animationDelay: "80ms" }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div
        ref={surfaceRef}
        className="group/cmd relative flex items-center gap-3 overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-gradient-to-b from-[var(--color-panel-2)]/80 to-[var(--color-panel-2)]/55 px-4 py-3 shadow-[var(--aios-shadow-pop)] backdrop-blur transition-all duration-300 focus-within:border-[var(--color-accent)]/60 focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_50%,transparent),0_18px_50px_-12px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
      >
        {/* accent sheen sweeping the top edge when focused — mirrors the composer */}
        <span className="pointer-events-none absolute inset-x-0 top-0 z-10 h-px bg-gradient-to-r from-transparent via-[var(--color-accent)] to-transparent opacity-0 transition-opacity duration-500 group-focus-within/cmd:opacity-80" />
        <Search
          size={17}
          className="shrink-0 text-[var(--color-muted)] transition-colors group-focus-within/cmd:text-[var(--color-accent)]"
        />
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" && !value) {
                e.preventDefault();
                recallLast();
              } else if (e.key === "Tab" && !e.shiftKey && intents[0]) {
                // Tab takes the top intent chip (Enter keeps the chat contract)
                e.preventDefault();
                intents[0].run();
              }
            }}
            spellCheck={false}
            /* native placeholder blanked — the rotating overlay below owns it */
            placeholder=""
            aria-label={ph.text}
            className="w-full bg-transparent font-sans text-[15px] leading-relaxed text-[var(--color-text)] caret-[var(--color-accent)] focus:outline-none"
            style={{ opacity: vanishing ? 0 : 1 }}
          />
          {/* rotating placeholder — animated overlay (AnimatePresence), shown
              only while empty; pointer-events-none so it never blocks the caret */}
          {value.length === 0 && !vanishing && (
            <AnimatePresence mode="wait">
              <m.span
                key={ph.index}
                aria-hidden
                className="aios-cmd-ph absolute inset-y-0 left-0 flex items-center font-sans text-[15px] leading-relaxed text-[var(--color-faint)]"
                initial={{ opacity: 0, y: "0.6em" }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: "-0.6em" }}
                transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
              >
                {ph.text}
              </m.span>
            </AnimatePresence>
          )}
          {/* vanish canvas — dissolving text on submit; sized to the input */}
          <canvas
            ref={canvasRef}
            className="aios-cmd-vanish absolute left-0 top-0"
            style={{ opacity: vanishing ? 1 : 0 }}
          />
        </div>
        {hasContent ? (
          <button
            type="submit"
            title="start a chat with this"
            className="group/send grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[var(--color-accent)] to-[color-mix(in_srgb,var(--color-accent)_62%,#000)] text-[var(--color-accent-fg)] shadow-[0_2px_12px_-2px_color-mix(in_srgb,var(--color-accent)_70%,transparent)] transition-all duration-200 hover:scale-110 hover:shadow-[0_4px_22px_-2px_var(--color-accent)] active:scale-90"
          >
            <ArrowUp size={16} className="transition-transform duration-200 group-hover/send:-translate-y-0.5" />
          </button>
        ) : (
          <kbd className="shrink-0 rounded-md border border-[var(--color-border)] bg-[var(--color-panel-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--color-muted)]">
            {chord("K")}
          </kbd>
        )}
      </div>
      {/* type-ahead intent chips — the direct route for what you're typing */}
      {intents.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center justify-center gap-1.5">
          {intents.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={it.run}
              title={it.hint}
              className="pill press aios-fade-in flex items-center gap-1.5"
            >
              {it.icon}
              <span className="max-w-[260px] truncate">{it.label}</span>
              {i === 0 && (
                <kbd className="rounded border border-[var(--color-border)] bg-[var(--color-panel-2)] px-1 font-mono text-[9px] text-[var(--color-faint)]">
                  tab
                </kbd>
              )}
            </button>
          ))}
        </div>
      )}
      {/* which agent this line launches — no more mystery composer */}
      <div className="mt-2 text-center font-mono text-[11px] text-[var(--color-faint)]">
        {engineLabel} · enter to start · ↑ last · $ terminal · {chord("K")} for everything
      </div>
    </form>
  );
}

// ── relative-time helper ──────────────────────────────────────────────────────
function ago(ts: number): string {
  if (!ts) return "";
  const ms = ts > 1e12 ? ts : ts * 1000;
  const rem = Date.now() - ms;
  if (rem < 60_000) return "now";
  const m = Math.floor(rem / 60_000);
  if (m < 60) return `${m}m`;
  const hh = Math.floor(m / 60);
  if (hh < 24) return `${hh}h`;
  return `${Math.floor(hh / 24)}d`;
}

// ── dashboard primitives (Mission Control) ──────────────────────────────────

/** Section eyebrow — a glowing tick + mono label + a fading rule. Sits ABOVE a
 *  glass card, matching the Mission Control mockup. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span className="h-[5px] w-[5px] shrink-0 rounded-[1px] bg-[var(--color-accent)] shadow-[var(--aios-glow-soft)]" />
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">{children}</span>
      <span className="h-px flex-1 bg-[linear-gradient(90deg,var(--color-border),transparent)]" />
    </div>
  );
}

/** Engine → its accent tint for the chat badge/icon (claude=accent, codex=cyan,
 *  opencode=green). Keeps the card colourful instead of flat grey. */
function engineTint(engine: string): string {
  const e = (engine || "").toLowerCase();
  if (e.includes("codex") || e.includes("gpt")) return "var(--aios-accent-2)";
  if (e.includes("opencode")) return "var(--color-success)";
  return "var(--color-accent)";
}

/** "pick up where you left off" — recent durable chats; click resumes the
 *  session in a fresh chat pane. The right column of the dashboard. */
function MiniHistory({
  chats,
  onOpen,
}: {
  chats: HistoryEntry[];
  onOpen: (c: HistoryEntry) => void;
}) {
  return (
    <div className="surface-card flex flex-col gap-0.5 rounded-2xl p-2.5">
      {chats.length === 0 ? (
        <div className="px-2 py-3 text-[12px] text-[var(--color-faint)]">no conversations yet</div>
      ) : (
        chats.slice(0, 4).map((c) => {
          const tint = engineTint(c.engine);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onOpen(c)}
              onMouseMove={spotlightMove}
              title={c.title}
              className="aios-spotlight group flex items-start gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] hover:bg-[var(--color-panel-2)]"
            >
              <span
                className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border"
                style={{
                  borderColor: `color-mix(in srgb, ${tint} 32%, transparent)`,
                  background: `color-mix(in srgb, ${tint} 12%, transparent)`,
                  color: tint,
                }}
              >
                <History size={12} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text)]">
                    {c.title || "untitled"}
                  </span>
                  <span
                    className="shrink-0 rounded border px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-wide"
                    style={{ borderColor: `color-mix(in srgb, ${tint} 38%, transparent)`, color: tint }}
                  >
                    {c.engine || "chat"}
                  </span>
                </span>
                {c.last_user && (
                  <span className="truncate text-[11.5px] text-[var(--color-text-2)]">{c.last_user}</span>
                )}
                <span className="font-mono text-[9.5px] text-[var(--color-faint)]">{ago(c.mtime)}</span>
              </span>
            </button>
          );
        })
      )}
    </div>
  );
}

/** "Continue working" — recent Work Sessions (goal + chat thread + panes). Click
 *  restores the deck + re-threads the chat. Replaces the recent-chats column when
 *  any session exists (falls back to that column otherwise). */
function ContinueWorking({
  sessions,
  onResume,
  onRemove,
  onDone,
}: {
  sessions: WorkSession[];
  onResume: (s: WorkSession) => void;
  onRemove?: (id: string) => void;
  onDone?: (id: string) => void;
}) {
  const visible = sessions.filter((s) => s.status !== "done").slice(0, 5);
  // per-session message count (summed across its bound chats' durable logs) —
  // a sub-friendly activity readout (no $ cost; meta has no token total).
  const [msgsById, setMsgsById] = useState<Record<string, number>>({});
  const metaKey = visible.map((s) => `${s.id}:${s.chatSessionIds.join(",")}`).join("|");
  useEffect(() => {
    let alive = true;
    Promise.all(
      visible.map(async (s) => {
        let msgs = 0;
        for (const id of s.chatSessionIds) {
          try {
            msgs += (await chatHistoryMeta(id)).message_count || 0;
          } catch {
            /* no durable log for this chat — skip */
          }
        }
        return [s.id, msgs] as const;
      }),
    ).then((pairs) => {
      if (alive) setMsgsById(Object.fromEntries(pairs.filter(([, n]) => n > 0)));
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaKey]);
  return (
    <div className="surface-card flex flex-col gap-0.5 rounded-2xl p-2.5">
      {visible.length === 0 ? (
        <div className="px-2 py-3 text-[12px] text-[var(--color-faint)]">no saved sessions yet</div>
      ) : (
        visible.map((s) => {
          const paneCount = s.panes.length + (s.chatSessionIds.length > 0 ? 1 : 0);
          const proj = s.projectRoot
            ? s.projectRoot.split(/[\\/]/).filter(Boolean).pop() ?? ""
            : "";
          return (
            <div
              key={s.id}
              onMouseMove={spotlightMove}
              className="aios-spotlight group flex items-center gap-1 rounded-lg border border-transparent pr-1 transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] hover:bg-[var(--color-panel-2)]"
            >
              <button
                type="button"
                onClick={() => onResume(s)}
                title={s.goal || s.title}
                className="flex min-w-0 flex-1 items-start gap-2.5 px-2 py-1.5 text-left"
              >
                <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_32%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-accent)]">
                  <History size={12} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-1.5">
                    <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text)]">
                      {s.title || "work session"}
                    </span>
                    {proj && (
                      <span className="shrink-0 truncate rounded border border-[var(--color-border)] px-1 py-0.5 font-mono text-[8.5px] uppercase tracking-wide text-[var(--color-muted)]">
                        {proj}
                      </span>
                    )}
                  </span>
                  {s.goal && (
                    <span className="truncate text-[11.5px] text-[var(--color-text-2)]">{s.goal}</span>
                  )}
                  <span className="font-mono text-[9.5px] text-[var(--color-faint)]">
                    {paneCount} pane{paneCount === 1 ? "" : "s"}
                    {msgsById[s.id] ? ` · ${msgsById[s.id]} msg${msgsById[s.id] === 1 ? "" : "s"}` : ""} ·{" "}
                    {ago(Math.floor(s.lastActiveAt / 1000))}
                  </span>
                </span>
              </button>
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                {onDone && (
                  <button
                    type="button"
                    onClick={() => onDone(s.id)}
                    title="mark done — archive from this list"
                    className="press grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-success)]"
                  >
                    <Check size={13} />
                  </button>
                )}
                {onRemove && (
                  <button
                    type="button"
                    onClick={() => onRemove(s.id)}
                    title="remove from continue-working"
                    className="press grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-danger)]"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}

// ── recent projects ────────────────────────────────────────────────────────────

function RecentProjects({
  projects,
  pulse,
  onOpen,
  shapeByRoot,
}: {
  projects: ProjectInfo[];
  /** git summary for these roots — already polled by IdleDashboard; rows
   *  surface it as a status dot (it used to be only a footer count). */
  pulse: RepoPulse[];
  onOpen: (p: ProjectInfo) => void;
  /** root → shape label for structured workspaces (split/environments); a hint
   *  chip that signals "opening this offers a component picker". */
  shapeByRoot?: Record<string, string>;
}) {
  const pulseFor = (root: string) => pulse.find((r) => r.root === root) ?? null;
  return (
    <div className="surface-card flex flex-col gap-0.5 rounded-2xl p-2.5">
      {projects.length === 0 ? (
        <div className="px-1 py-1.5 text-[12px] text-[var(--color-faint)]">no projects yet — add a scan root in settings</div>
      ) : (
        projects.map((p) => {
          const repo = pulseFor(p.root);
          const shape = shapeByRoot?.[p.root];
          const drift =
            repo && (repo.dirty > 0 || repo.ahead > 0 || repo.behind > 0)
              ? [
                  repo.branch,
                  repo.dirty > 0 ? `${repo.dirty} dirty` : "",
                  repo.ahead > 0 ? `↑${repo.ahead}` : "",
                  repo.behind > 0 ? `↓${repo.behind}` : "",
                ]
                  .filter(Boolean)
                  .join(" · ")
              : null;
          return (
            <button
              key={p.root}
              onClick={() => onOpen(p)}
              onMouseMove={spotlightMove}
              title={drift ? `open terminal in ${p.root}\n${drift}` : `open terminal in ${p.root}`}
              className="aios-spotlight group flex items-center gap-2.5 rounded-lg border border-transparent px-2 py-1.5 text-left transition-colors hover:border-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] hover:bg-[var(--color-panel-2)]"
            >
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_28%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-accent)]">
                <FolderGit2 size={12} />
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-text)]">
                {p.name}
              </span>
              {drift && (
                <span
                  className={`status-dot shrink-0 ${repo!.dirty > 0 ? "status-dot--idle" : "status-dot--dormant"}`}
                  style={{ width: 6, height: 6 }}
                  aria-label={drift}
                />
              )}
              {shape ? (
                <span
                  className="shrink-0 rounded-[4px] border border-[color-mix(in_srgb,var(--color-accent)_34%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-[var(--color-accent)]"
                  title="structured workspace — opens a component picker"
                >
                  {shape}
                </span>
              ) : (
                <span className="shrink-0 font-mono text-[9px] uppercase tracking-wider text-[color-mix(in_srgb,var(--color-accent)_65%,var(--color-faint))]">{p.kind}</span>
              )}
              <span className="shrink-0 font-mono text-[10px] text-[var(--color-muted)]">{ago(p.mtime)}</span>
            </button>
          );
        })
      )}
    </div>
  );
}

// ── quick actions ──────────────────────────────────────────────────────────────

function QuickActions({
  onSpawn,
  onOpenPalette,
  onRevealSidebar,
  onResumeLast,
  resumeLabel,
}: {
  onSpawn: (kind: AppDef["kind"], label: string) => void;
  onOpenPalette: () => void;
  onRevealSidebar: () => void;
  onResumeLast?: () => void;
  resumeLabel?: string;
}) {
  const actions: Array<{ label: string; hint: string; icon: ReactNode; run: () => void; title?: string }> = [
    { label: "new chat", hint: "ask aios", icon: <Sparkles size={17} />, run: () => onSpawn({ type: "chat" }, "chat") },
    { label: "terminal", hint: "shell", icon: <Terminal size={17} />, run: () => onSpawn({ type: "shell" }, "terminal") },
    { label: "files", hint: "browse", icon: <FolderGit2 size={17} />, run: () => onSpawn({ type: "files" } as AppDef["kind"], "files") },
    { label: "browser", hint: "web", icon: <Globe size={17} />, run: () => onSpawn({ type: "browser" } as AppDef["kind"], "browser") },
    { label: "history", hint: "resume", icon: <History size={17} />, run: () => onSpawn({ type: "history" } as AppDef["kind"], "history") },
  ];
  // unused-prop guard: these still feed other entry points; keep them referenced.
  void onOpenPalette;
  void onRevealSidebar;
  void onResumeLast;
  void resumeLabel;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {actions.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.run}
          onMouseMove={spotlightMove}
          title={action.title}
          className="aios-spotlight surface-card group flex flex-col gap-2.5 rounded-2xl p-3.5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--color-accent)_40%,transparent)] hover:shadow-[var(--aios-glow-soft)]"
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_22%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_12%,transparent)] text-[var(--color-accent)] transition-transform group-hover:scale-105">
            {action.icon}
          </span>
          <span className="text-[13px] font-medium text-[var(--color-text)]">{action.label}</span>
          <span className="font-mono text-[9.5px] text-[var(--color-faint)]">{action.hint}</span>
        </button>
      ))}
    </div>
  );
}

