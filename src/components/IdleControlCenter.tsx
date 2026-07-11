/**
 * IdleControlCenter — the HORIZON lock screen (L1–L3 + P5, living-cockpit;
 * owner picked sketch B: "i love B, but the working world, please make it
 * dynamic… busy but nice on the eyes… stars and all that. motions.").
 *
 * The composition is a landscape:
 *
 *   SKY (top ~63%)      aurora blooms · twinkling stars · drifting satellites
 *                       · the occasional shooting star. Lower-left, sitting ON
 *                       the horizon: date → a monumental mono clock → greeting.
 *                       Right, riding the line: the ONE glanceable status row
 *                       (agents · claude usage · streak · unread).
 *
 *   THE HORIZON         a full-width gradient line with a slow light-pulse
 *                       traveling along it. The glass spirit LIVES on it —
 *                       wandering the line, sleeping on it at night (P5
 *                       residency; click = its room; confetti lands here).
 *
 *   GROUND (bottom)     the working world, alive: parallax ridge glows,
 *                       fireflies drifting up — and the real controls:
 *                       quick-start dock (chat · terminal · notes, owner's
 *                       pick), the composer-grade command line center, and
 *                       the "continue" shelf right (resume-layout pill,
 *                       work sessions w/ done/remove, recent projects w/ git
 *                       drift dots + shape chips, overflow → projects pane).
 *
 * Everything moves, nothing scrolls: the layout is proportional (absolute
 * bands), so it fits any viewport without the old fit-scale hack. All motion
 * is transform/opacity-only CSS (osai-lock-* keyframes in App.css), stilled
 * by the reduce-motion guards.
 *
 * TDZ note (this caused a black idle screen historically): every derived
 * const is declared BEFORE any JSX/hook reads it — never forward-referenced.
 * Data loading lives one level up in IdleDashboard; this component is
 * presentation + the command-line local state only.
 */
import {
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
  Feather,
  FolderGit2,
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
import type { OsaiNotification } from "../lib/notifications";
import type { ProjectInfo } from "../lib/run";
import type { SidebarItem, SidebarState } from "../lib/sidebar";
import type { UsageExtras } from "../lib/stats";
import { AnimatePresence, m } from "motion/react";

import { type Workspace } from "../lib/workspaces";
import { type WorkSession } from "../lib/workSessions";
import { lastAccessFor, projectAccessTimes } from "../lib/projectRecents";
import { displayName, subscribe as subscribeSettings } from "../lib/settings";
import { chord } from "../lib/platform";
import { setPaletteMorphSource } from "../lib/paletteMorph";
import {
  flavorOf,
  moodOf,
  stageOf,
  suggestActivity,
  tick,
} from "../lib/pet/engine";
import { loadSoul, saveSoul, subscribeSoul } from "../lib/pet/store";
import { subscribePetConfetti, subscribePetReactions } from "../lib/pet";
import { BlurText } from "./fx/BlurText";
import { Confetti } from "./fx/Confetti";
import { Ripple } from "./fx/Ripple";
import { Spotlight } from "./fx/Spotlight";
import { spotlightMove } from "./fx/spotlightGlow";
import { useFunFx } from "./fx/funFx";
import { useRotatingPlaceholder } from "./fx/useRotatingPlaceholder";
import { useVanish } from "./fx/useVanish";
import { useUsageRates } from "./dashboard/UsageGlance";
import { PetBody, type PetPose } from "./pet/PetBody";

/** Where the sky ends and the working world begins (% of the stage height). */
const HORIZON = 63;

const isNightNow = () => {
  const h = new Date().getHours();
  return h < 7 || h >= 22;
};

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
  /** claude's 5h/7d/ctx — kept for the interface; bars come from useUsageRates. */
  rate: IdleRate | null;
  focus: MemoryFocus | null;
  pulse: RepoPulse[];
  scheduledAgents: ScheduledAgentSummary[];
  notifications: OsaiNotification[];
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
  /** "pick up where you left off" — panes to bring back; null hides the card. */
  resumeLayout?: { count: number; labels: string[] } | null;
  onResumeLayout?: () => void;
  /** seed a fresh chat pane with the command-line text (spawns a chat). */
  onTalkToJarvis: (seed: string) => void;
  /** restore a saved workspace (named pane layout) from its launch-row chip. */
  onApplyWorkspace?: (ws: Workspace) => void;
  /** root → shape label for structured workspaces; shelf rows show a hint chip. */
  shapeByRoot?: Record<string, string>;
  /** Work Sessions for the continue shelf + a one-click resume (Tier 1). */
  workSessions?: WorkSession[];
  onResumeSession?: (s: WorkSession) => void;
  onRemoveSession?: (id: string) => void;
  onDoneSession?: (id: string) => void;
}) {
  // ── derived state — declared BEFORE any JSX/hook that reads them (TDZ-safe) ──
  // "continue" ordering = REAL access recency (projects opened / panes spawned
  // with a cwd inside them), not fs mtime — agents editing files kept bumping
  // folders the owner never opened. Never-touched projects fall back to mtime.
  const accessTimes = projectAccessTimes();
  const recent = [...projects]
    .map((p) => ({ p, at: lastAccessFor(p.root, accessTimes) }))
    .sort((a, b) => b.at - a.at || b.p.mtime - a.p.mtime)
    .map((x) => x.p)
    .slice(0, 5);
  const activeAgents = scheduledAgents.filter(
    (agent) => agent.health === "due" || agent.health === "scheduled",
  ).length;
  const unread = notifications.filter((item) => !item.read).length;
  const dirtyProjects = pulse.filter(
    (repo) => repo.dirty || repo.ahead || repo.behind,
  ).length;

  // Props retained for the interface but not rendered on this surface.
  void onApplyWorkspace;
  void onOpenSidebarItem;
  void onRevealSidebar;
  void onResumeLast;
  void resumeLabel;
  void sidebar;
  void rate;
  void focus;

  // liveness 0..1 — the sky breathes with what the system is actually doing.
  const liveness = Math.min(
    1,
    activeAgents * 0.45 + Math.min(dirtyProjects, 3) * 0.12 + (unread > 0 ? 0.18 : 0),
  );

  // personality layer (W5-5): confetti bursts where the pet lives when it
  // earns one (long clean run); the ripple rides high liveness behind it.
  const funFx = useFunFx();
  const [confettiKey, setConfettiKey] = useState(0);
  useEffect(() => subscribePetConfetti(() => setConfettiKey((k) => k + 1)), []);

  // the ONE glanceable status row — usage from the same source as the sidebar.
  const { claude, hasClaude } = useUsageRates();
  const claudePct = hasClaude ? claude!.fiveHour.pct : null;
  const streak = extras?.currentStreak ?? 0;

  return (
    // .osai-stage = the same animated aurora ground the chat pane uses.
    <div className="osai-stage relative flex h-full flex-col overflow-hidden">
      {/* one-shot accent spotlight sweep on arrival */}
      <Spotlight />

      {/* aurora blooms — breathe with liveness; reduce-motion kills the drift */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        style={{ opacity: 0.6 + liveness * 0.4, transition: "opacity 2s ease-in-out" }}
      >
        <div
          className="osai-drift-a absolute h-[52vh] w-[52vh] rounded-full blur-[120px]"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 20%, transparent), transparent 70%)" }}
        />
        <div
          className="osai-drift-b absolute right-[-8%] top-[6%] h-[44vh] w-[44vh] rounded-full blur-[120px]"
          style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--osai-accent-2) 14%, transparent), transparent 70%)" }}
        />
      </div>

      {/* the sky — stars, satellites, a shooting star */}
      <SkyField />

      {/* clock block — lower-left, standing on the horizon */}
      <ClockBlock />

      {/* the one glanceable status row — riding the line, right side */}
      <div
        className="absolute right-[4%] z-[11] flex flex-wrap items-center justify-end gap-2"
        style={{ bottom: `${100 - HORIZON + 1.6}%` }}
      >
        {activeAgents > 0 && (
          <button
            type="button"
            onClick={onOpenScheduledAgents}
            title="open scheduled agents"
            className="press flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)]/55 px-2.5 py-1 font-mono text-[10.5px] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-success)] shadow-[0_0_7px_var(--color-success-glow)]" />
            {activeAgents} agent{activeAgents === 1 ? "" : "s"} live
          </button>
        )}
        {claudePct != null && (
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)]/55 px-2.5 py-1 font-mono text-[10.5px] text-[var(--color-text-2)]">
            claude 5h
            <span className="h-1 w-10 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text)_12%,transparent)]">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${Math.round(claudePct)}%`,
                  background:
                    claudePct >= 85 ? "var(--color-danger)" : claudePct >= 65 ? "var(--color-warning)" : "var(--color-accent)",
                }}
              />
            </span>
            {Math.round(claudePct)}%
          </span>
        )}
        {streak > 0 && (
          <button
            type="button"
            onClick={() => onSpawn({ type: "pulse" } as AppDef["kind"], "pulse")}
            title="open pulse"
            className="press flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)]/55 px-2.5 py-1 font-mono text-[10.5px] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]"
          >
            <span className="h-1.5 w-1.5 rotate-45 rounded-[1px] bg-[var(--osai-accent-2)] shadow-[0_0_7px_color-mix(in_srgb,var(--osai-accent-2)_70%,transparent)]" />
            {streak}-day streak
          </button>
        )}
        {unread > 0 && (
          <span className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-panel)]/55 px-2.5 py-1 font-mono text-[10.5px] text-[var(--color-text-2)]">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--color-warning)]" />
            {unread} unread
          </span>
        )}
      </div>

      {/* the resident — the glass spirit lives ON the horizon (P5) */}
      <HorizonPet
        onOpenPet={onOpenPet}
        confettiKey={confettiKey}
        showRipple={funFx && liveness > 0.4}
      />

      {/* ── the working world (ground band) ── */}
      <div className="absolute inset-x-0 bottom-0 z-[9] overflow-hidden" style={{ top: `${HORIZON}%` }}>
        {/* the horizon line + the light traveling along it */}
        <div className="osai-horizon-line absolute inset-x-0 top-0 h-px" />
        <div className="osai-horizon-flow absolute inset-x-0 top-0 h-[2px]" />

        {/* ground wash — the world below is a shade more solid than the sky */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, color-mix(in srgb, var(--color-panel) 30%, transparent), color-mix(in srgb, var(--color-bg) 72%, transparent))",
          }}
        />

        {/* parallax ridge glows — two soft terrain bands drifting at different speeds */}
        <div className="osai-lock-ridge-a pointer-events-none absolute -bottom-8 left-0 h-28 w-[200%]" />
        <div className="osai-lock-ridge-b pointer-events-none absolute -bottom-12 left-0 h-32 w-[200%]" />

        {/* fireflies — tiny sparks rising out of the working world */}
        {FLIES.map((f, i) => (
          <span
            key={i}
            aria-hidden
            className="osai-lock-fly pointer-events-none absolute bottom-0 rounded-full"
            style={{
              left: `${f.x}%`,
              width: f.s,
              height: f.s,
              background: f.c === "a" ? "var(--color-accent)" : "var(--osai-accent-2)",
              boxShadow: `0 0 6px ${f.c === "a" ? "color-mix(in srgb, var(--color-accent) 80%, transparent)" : "color-mix(in srgb, var(--osai-accent-2) 80%, transparent)"}`,
              ["--delay" as string]: `${f.delay}s`,
              ["--dur" as string]: `${f.dur}s`,
              ["--sway" as string]: `${f.sway}px`,
            }}
          />
        ))}

        {/* the real controls — dock · command line · continue shelf */}
        <div className="relative z-10 mx-auto flex h-full w-full max-w-[1280px] items-center gap-7 px-[4%]">
          <div className="hidden shrink-0 flex-col gap-2.5 sm:flex">
            <Eyebrow>quick start</Eyebrow>
            <LockDock onSpawn={onSpawn} />
          </div>

          <div className="min-w-0 flex-1">
            <div className="mx-auto w-full max-w-[560px]">
              <CommandLine
                onSeedChat={onTalkToJarvis}
                onOpenPalette={onOpenPalette}
                projects={projects}
                onOpenProject={onOpenProject}
                onSpawn={onSpawn}
              />
            </div>
          </div>

          <div className="hidden w-[300px] shrink-0 flex-col gap-2.5 lg:flex">
            <Eyebrow>continue</Eyebrow>
            <ContinueShelf
              projects={recent}
              pulse={pulse}
              shapeByRoot={shapeByRoot}
              onOpenProject={onOpenProject}
              resumeLayout={resumeLayout}
              onResumeLayout={onResumeLayout}
              sessions={workSessions}
              onResumeSession={onResumeSession}
              onRemoveSession={onRemoveSession}
              onDoneSession={onDoneSession}
              onAllProjects={() => onSpawn({ type: "projects" } as AppDef["kind"], "projects")}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ── the sky ───────────────────────────────────────────────────────────────────

/** Hand-placed starfield (deterministic — no per-render randomness): twinkling
 *  stars at staggered phases, two satellites crossing on long orbits, and one
 *  shooting star on a lazy ~15s cycle. Pure transform/opacity animation. */
const STARS: Array<{ x: number; y: number; s: number; d: number; dur: number; hi: number; glow?: boolean }> = [
  { x: 4, y: 8, s: 2, d: 0.0, dur: 4.4, hi: 0.75 },
  { x: 9, y: 26, s: 1.5, d: 1.2, dur: 5.1, hi: 0.5 },
  { x: 14, y: 13, s: 2, d: 2.6, dur: 4.0, hi: 0.65 },
  { x: 19, y: 34, s: 1.5, d: 0.8, dur: 5.8, hi: 0.45 },
  { x: 23, y: 7, s: 2.5, d: 1.9, dur: 4.6, hi: 0.85, glow: true },
  { x: 28, y: 21, s: 1.5, d: 3.4, dur: 5.2, hi: 0.5 },
  { x: 33, y: 11, s: 2, d: 0.4, dur: 4.2, hi: 0.7 },
  { x: 38, y: 30, s: 1.5, d: 2.2, dur: 6.0, hi: 0.4 },
  { x: 43, y: 5, s: 2, d: 1.5, dur: 4.8, hi: 0.6 },
  { x: 47, y: 18, s: 1.5, d: 3.0, dur: 5.4, hi: 0.5 },
  { x: 52, y: 9, s: 2.5, d: 0.6, dur: 4.4, hi: 0.9, glow: true },
  { x: 56, y: 27, s: 1.5, d: 2.8, dur: 5.0, hi: 0.45 },
  { x: 61, y: 14, s: 2, d: 1.1, dur: 4.6, hi: 0.65 },
  { x: 65, y: 33, s: 1.5, d: 3.6, dur: 5.6, hi: 0.4 },
  { x: 70, y: 6, s: 2, d: 0.2, dur: 4.2, hi: 0.7 },
  { x: 74, y: 22, s: 1.5, d: 1.7, dur: 5.2, hi: 0.5 },
  { x: 79, y: 12, s: 2.5, d: 2.4, dur: 4.8, hi: 0.85, glow: true },
  { x: 83, y: 29, s: 1.5, d: 0.9, dur: 5.8, hi: 0.45 },
  { x: 88, y: 8, s: 2, d: 3.2, dur: 4.4, hi: 0.7 },
  { x: 92, y: 24, s: 1.5, d: 1.4, dur: 5.4, hi: 0.5 },
  { x: 96, y: 15, s: 2, d: 2.0, dur: 4.6, hi: 0.6 },
  { x: 36, y: 42, s: 1.5, d: 2.9, dur: 6.2, hi: 0.35 },
  { x: 58, y: 44, s: 1.5, d: 0.7, dur: 6.4, hi: 0.35 },
  { x: 12, y: 46, s: 1.5, d: 1.8, dur: 6.0, hi: 0.35 },
];

/** Far, faint dust — a deep layer that gives the sky real depth. Lives inside
 *  the slow-drifting <StarDust> wrapper so it parallaxes against the brighter
 *  foreground stars. Deterministic (no per-render randomness), like STARS. */
const DUST: Array<{ x: number; y: number; s: number; d: number; dur: number }> = [
  { x: 3, y: 4, s: 1, d: 0.4, dur: 6.2 }, { x: 7, y: 15, s: 0.8, d: 2.1, dur: 7.0 },
  { x: 11, y: 38, s: 1, d: 1.3, dur: 6.6 }, { x: 16, y: 5, s: 0.8, d: 3.0, dur: 7.4 },
  { x: 21, y: 24, s: 1.2, d: 0.7, dur: 5.8 }, { x: 26, y: 47, s: 0.8, d: 2.6, dur: 7.8 },
  { x: 30, y: 3, s: 1, d: 1.8, dur: 6.4 }, { x: 34, y: 33, s: 0.8, d: 3.4, dur: 7.2 },
  { x: 41, y: 12, s: 1.2, d: 0.9, dur: 6.0 }, { x: 45, y: 40, s: 0.8, d: 2.3, dur: 7.6 },
  { x: 49, y: 25, s: 1, d: 1.5, dur: 6.8 }, { x: 53, y: 51, s: 0.8, d: 3.2, dur: 7.0 },
  { x: 59, y: 6, s: 1.2, d: 0.5, dur: 5.6 }, { x: 63, y: 37, s: 0.8, d: 2.8, dur: 7.4 },
  { x: 68, y: 19, s: 1, d: 1.1, dur: 6.2 }, { x: 72, y: 44, s: 0.8, d: 3.6, dur: 7.8 },
  { x: 77, y: 4, s: 1.2, d: 0.3, dur: 6.6 }, { x: 81, y: 31, s: 0.8, d: 2.0, dur: 7.2 },
  { x: 86, y: 16, s: 1, d: 1.6, dur: 6.0 }, { x: 90, y: 42, s: 0.8, d: 3.1, dur: 7.6 },
  { x: 94, y: 9, s: 1.2, d: 0.8, dur: 6.4 }, { x: 98, y: 28, s: 0.8, d: 2.4, dur: 7.0 },
  { x: 5, y: 52, s: 0.8, d: 1.9, dur: 8.0 }, { x: 38, y: 55, s: 0.8, d: 3.5, dur: 8.2 },
  { x: 66, y: 54, s: 0.8, d: 1.2, dur: 8.4 }, { x: 88, y: 53, s: 0.8, d: 2.7, dur: 8.0 },
  { x: 14, y: 29, s: 1, d: 0.6, dur: 6.8 }, { x: 56, y: 14, s: 1, d: 3.3, dur: 6.2 },
];

/** A few bright, four-point sparkle stars — the glint that makes a night sky
 *  read as jeweled. Placed clear of the moon (right ~88%) and the clock. */
const SPARKLES: Array<{ x: number; y: number; s: number; delay: number }> = [
  { x: 6, y: 12, s: 3, delay: 0 },
  { x: 52, y: 6, s: 2.5, delay: 1.6 },
  { x: 46, y: 16, s: 2, delay: 3.1 },
  { x: 70, y: 30, s: 2.5, delay: 2.2 },
  { x: 13, y: 44, s: 2, delay: 4.0 },
];

/** Meteor shower — near-parallel streaks radiating from the upper-right on
 *  staggered lazy cycles, so a shower drifts by every so often (never a
 *  constant rain). Same transform family as the old lone shooting star. */
const METEORS: Array<{ x: number; y: number; len: number; delay: number; dur: number }> = [
  { x: 92, y: 2, len: 90, delay: 0, dur: 7.0 },
  { x: 78, y: 8, len: 130, delay: 2.4, dur: 8.0 },
  { x: 96, y: 20, len: 70, delay: 4.1, dur: 6.5 },
  { x: 66, y: 4, len: 110, delay: 5.7, dur: 7.5 },
  { x: 84, y: 26, len: 95, delay: 1.3, dur: 8.5 },
  { x: 58, y: 13, len: 120, delay: 3.6, dur: 7.0 },
  { x: 99, y: 12, len: 80, delay: 6.8, dur: 6.8 },
  { x: 72, y: 30, len: 100, delay: 8.2, dur: 8.0 },
];

/** One designed asterism, drawn in a fixed 220×150 local space (so nothing
 *  distorts with the viewport). Faint links + glowing vertices, breathing in
 *  and out of view on a long cycle. */
const CONSTEL_PTS: Array<[number, number]> = [
  [18, 26], [64, 14], [104, 44], [150, 30], [196, 62], [128, 84], [74, 70],
];
const CONSTEL_LINKS: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [2, 6], [6, 5], [5, 4],
];

function SkyField() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-[5]" style={{ height: `${HORIZON}%` }}>
      {/* aurora curtains + a nebula bloom, painted behind the stars (screen-blend
          so they glow additively over the void) */}
      <AuroraSky />

      {/* deep parallax dust — the Milky Way's faint backing layer */}
      <StarDust />

      {/* the bright, hand-placed twinkling stars (the mid layer) */}
      {STARS.map((st, i) => (
        <span
          key={i}
          className="osai-lock-star absolute rounded-full"
          style={{
            left: `${st.x}%`,
            top: `${st.y}%`,
            width: st.s,
            height: st.s,
            background: "color-mix(in srgb, var(--color-text) 85%, var(--osai-accent-2))",
            boxShadow: st.glow ? "0 0 8px color-mix(in srgb, var(--osai-accent-2) 70%, transparent)" : undefined,
            ["--delay" as string]: `${st.d}s`,
            ["--dur" as string]: `${st.dur}s`,
            ["--hi" as string]: st.hi,
          }}
        />
      ))}

      {/* four-point sparkles + one constellation — the "designed" jewelry */}
      {SPARKLES.map((sp, i) => (
        <span
          key={i}
          className="osai-lock-sparkle absolute"
          style={{ left: `${sp.x}%`, top: `${sp.y}%`, width: sp.s, height: sp.s, ["--delay" as string]: `${sp.delay}s` }}
        />
      ))}
      <Constellation />

      {/* the moon — the sky's anchor: glowing halo, soft craters */}
      <Moon />

      {/* satellites — slow, straight, faint */}
      <span className="osai-lock-sat absolute left-0 top-[10%] h-[2px] w-[2px] rounded-full bg-[var(--color-text)] opacity-40" />
      <span
        className="osai-lock-sat absolute left-0 top-[24%] h-[2px] w-[2px] rounded-full bg-[var(--osai-accent-2)] opacity-30"
        style={{ animationDuration: "150s", animationDelay: "38s" }}
      />

      {/* the shower streaking across the top */}
      <MeteorShower />
    </div>
  );
}

/** The moon: a lit sphere (radial highlight + inset shadow for volume, stacked
 *  radial-gradients for craters) under a slow-breathing halo. */
function Moon() {
  return (
    <div aria-hidden className="osai-lock-moon absolute" style={{ right: "11%", top: "12%" }}>
      <span className="osai-lock-moon-halo absolute rounded-full" style={{ inset: -28 }} />
      <span className="osai-lock-moon-body relative block rounded-full" style={{ width: 62, height: 62 }} />
    </div>
  );
}

/** Two undulating aurora ribbons + a drifting nebula bloom (screen-blended). */
function AuroraSky() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="osai-lock-aurora osai-lock-aurora-a absolute" />
      <div className="osai-lock-aurora osai-lock-aurora-b absolute" />
      <div className="osai-lock-nebula absolute" />
    </div>
  );
}

/** Far dust in a very slowly drifting wrapper → parallax against the fore-stars. */
function StarDust() {
  return (
    <div className="osai-lock-skydrift absolute inset-0">
      {DUST.map((d, i) => (
        <span
          key={i}
          className="osai-lock-star absolute rounded-full"
          style={{
            left: `${d.x}%`,
            top: `${d.y}%`,
            width: d.s,
            height: d.s,
            background: "color-mix(in srgb, var(--color-text) 62%, var(--osai-accent-2))",
            ["--delay" as string]: `${d.d}s`,
            ["--dur" as string]: `${d.dur}s`,
            ["--hi" as string]: 0.34,
          }}
        />
      ))}
    </div>
  );
}

function MeteorShower() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {METEORS.map((m, i) => (
        <span
          key={i}
          className="osai-lock-meteor absolute"
          style={{ left: `${m.x}%`, top: `${m.y}%`, width: m.len, ["--delay" as string]: `${m.delay}s`, ["--dur" as string]: `${m.dur}s` }}
        />
      ))}
    </div>
  );
}

function Constellation() {
  return (
    <div className="osai-lock-constellation absolute" style={{ left: "21%", top: "7%", width: 220, height: 150 }}>
      <svg width="220" height="150" viewBox="0 0 220 150" fill="none">
        {CONSTEL_LINKS.map(([a, b], i) => (
          <line key={i} x1={CONSTEL_PTS[a][0]} y1={CONSTEL_PTS[a][1]} x2={CONSTEL_PTS[b][0]} y2={CONSTEL_PTS[b][1]} />
        ))}
        {CONSTEL_PTS.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.9 : 1.2} />
        ))}
      </svg>
    </div>
  );
}

// ── clock block — date · monumental clock · greeting ─────────────────────────

function ClockBlock() {
  const [now, setNow] = useState(() => new Date());
  const [name, setName] = useState(() => displayName("there"));
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15_000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => subscribeSettings(() => setName(displayName("there"))), []);

  const h = now.getHours();
  const part =
    h < 5 ? "still up" : h < 12 ? "good morning" : h < 18 ? "good afternoon" : "good evening";
  const partWords = part.split(" ");
  const words: ReactNode[] = [
    ...partWords.map((w, i) => (i === partWords.length - 1 ? `${w},` : w)),
    <span key="name" className="osai-greet-name">
      {name}
    </span>,
  ];
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");

  return (
    <div
      className="osai-fade-in pointer-events-none absolute z-[11] flex flex-col gap-1"
      style={{ left: "4.5%", bottom: `${100 - HORIZON + 2.2}%` }}
    >
      <span className="font-mono text-[11px] uppercase tracking-[0.32em] text-[var(--color-muted)]">
        {now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }).toLowerCase()}
      </span>
      <span
        className="font-mono font-semibold leading-[0.92] tracking-[-0.02em] text-[var(--color-text)] [font-variant-numeric:tabular-nums]"
        style={{
          fontSize: "clamp(56px, 10.5vw, 148px)",
          textShadow: "0 0 38px color-mix(in srgb, var(--color-accent) 40%, transparent)",
        }}
      >
        {hh}:{mm}
      </span>
      <BlurText
        key={`${part}|${name}`}
        words={words}
        className="text-[15px] font-medium tracking-tight text-[var(--color-text-2)]"
      />
    </div>
  );
}

// ── the resident — the spirit on the horizon (P5) ────────────────────────────

/** The glass spirit walks the horizon line: soul-steered (wanders when
 *  energetic, sleeps ON the line at night), celebrate/startle reactions from
 *  the pet bus, a "needs you" whisper when it's struggling. Click = its room.
 *  Same perf contract as the workspace overlay: the wander loop mutates the
 *  wrapper transform directly — zero per-frame renders. */
function HorizonPet({
  onOpenPet,
  confettiKey,
  showRipple,
}: {
  onOpenPet: () => void;
  confettiKey: number;
  showRipple: boolean;
}) {
  const [soul, setSoul] = useState(loadSoul);
  useEffect(() => subscribeSoul(setSoul), []);
  const soulRef = useRef(soul);
  soulRef.current = soul;

  // metabolism keeps moving while the lock screen is up (no active minutes —
  // the workspace overlay owns focus/affinity sampling; ticks are idempotent).
  useEffect(() => {
    const advance = () => {
      const next = tick(soulRef.current, { now: Date.now(), isNight: isNightNow() });
      if (next !== soulRef.current) saveSoul(next);
    };
    advance();
    const t = setInterval(advance, 60_000);
    return () => clearInterval(t);
  }, []);

  const [override, setOverride] = useState<{ pose: PetPose; until: number } | null>(null);
  const playPose = useCallback((pose: PetPose, ms: number) => {
    setOverride({ pose, until: Date.now() + ms });
    window.setTimeout(
      () => setOverride((cur) => (cur && Date.now() >= cur.until ? null : cur)),
      ms + 40,
    );
  }, []);
  useEffect(
    () =>
      subscribePetReactions((r) => {
        if (r === "celebrate") playPose("celebrate", 2_800);
        else if (r === "wince") playPose("startled", 2_400);
      }),
    [playPose],
  );

  const [steady, setSteady] = useState<PetPose>(() =>
    suggestActivity(soulRef.current, { isNight: isNightNow() }),
  );
  useEffect(() => {
    const recompute = () => setSteady(suggestActivity(soulRef.current, { isNight: isNightNow() }));
    recompute();
    const t = setInterval(recompute, 30_000);
    return () => clearInterval(t);
  }, [soul]);
  const pose: PetPose = override && Date.now() < override.until ? override.pose : steady;
  const poseRef = useRef(pose);
  poseRef.current = pose;

  // wander the line — style-mutating rAF, bounds from the live stage width.
  const stripRef = useRef<HTMLDivElement | null>(null);
  const elRef = useRef<HTMLDivElement | null>(null);
  const xRef = useRef(0.62); // fraction of the strip width (starts right of center)
  const facingRef = useRef<1 | -1>(-1);
  const [facing, setFacing] = useState<1 | -1>(-1);
  const pauseUntilRef = useRef(0);
  // first paint: place the pet from the measured strip width (the inline
  // style guess uses vw, which drifts from the stage width once the sidebar
  // is open — one corrective write keeps xRef and the visual in agreement).
  useEffect(() => {
    const strip = stripRef.current;
    const el = elRef.current;
    if (strip && el) {
      el.style.transform = `translateX(${xRef.current * Math.max(strip.clientWidth, 1)}px)`;
    }
  }, []);
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const SPEED = 26; // px/s — a lazier stroll than the workspace floor
    const loop = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      const strip = stripRef.current;
      const el = elRef.current;
      if (strip && el && poseRef.current === "wander" && t >= pauseUntilRef.current) {
        const w = Math.max(strip.clientWidth, 1);
        let x = xRef.current * w + facingRef.current * SPEED * dt;
        const min = w * 0.03;
        const max = w * 0.97 - 54;
        if (x <= min || x >= max) {
          facingRef.current = (facingRef.current * -1) as 1 | -1;
          setFacing(facingRef.current);
          x = Math.max(min, Math.min(max, x));
        } else if (Math.random() < dt / 8) {
          // stroll in beats: every ~8s, pause to take the view in
          pauseUntilRef.current = t + 1_800 + Math.random() * 3_600;
          if (Math.random() < 0.3) {
            facingRef.current = (facingRef.current * -1) as 1 | -1;
            setFacing(facingRef.current);
          }
        }
        xRef.current = x / w;
        el.style.transform = `translateX(${x}px)`;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const isNight = isNightNow();
  const mood = moodOf(soul, { isNight });
  const needsYou = mood === "sick" || mood === "grumpy" || mood === "hungry";
  const now = Date.now();

  return (
    <div ref={stripRef} className="absolute inset-x-0 z-[12]" style={{ top: `${HORIZON}%` }}>
      <div
        ref={elRef}
        role="button"
        tabIndex={0}
        onClick={onOpenPet}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), onOpenPet())}
        title={`${mood} — open its room`}
        className="absolute bottom-0 cursor-pointer"
        style={{ width: 54, height: 54, transform: "translateX(62vw)" }}
      >
        {showRipple && <Ripple />}
        {needsYou && (
          <span className="absolute -top-5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-2 py-0.5 font-mono text-[9px] text-[var(--color-text-2)] shadow-[var(--osai-shadow-pop)]">
            needs you
          </span>
        )}
        <PetBody
          size={54}
          mood={mood}
          pose={pose}
          stage={stageOf(soul, now)}
          flavor={flavorOf(soul, now)}
          facing={facing}
        />
        <Confetti trigger={confettiKey} />
      </div>
    </div>
  );
}

// ── the working world's furniture ─────────────────────────────────────────────

/** Fireflies — deterministic drift specs (x%, size, stagger, sway). */
const FLIES: Array<{ x: number; s: number; delay: number; dur: number; sway: number; c: "a" | "b" }> = [
  { x: 6, s: 3, delay: 0, dur: 11, sway: 26, c: "b" },
  { x: 15, s: 2, delay: 3.2, dur: 13, sway: -18, c: "a" },
  { x: 24, s: 2.5, delay: 6.5, dur: 12, sway: 22, c: "b" },
  { x: 34, s: 2, delay: 1.6, dur: 14, sway: -24, c: "a" },
  { x: 45, s: 2, delay: 8.4, dur: 12, sway: 16, c: "b" },
  { x: 55, s: 2.5, delay: 4.8, dur: 13, sway: -20, c: "a" },
  { x: 66, s: 2, delay: 2.4, dur: 11, sway: 24, c: "b" },
  { x: 76, s: 2.5, delay: 7.2, dur: 14, sway: -16, c: "b" },
  { x: 86, s: 2, delay: 5.6, dur: 12, sway: 20, c: "a" },
  { x: 94, s: 2, delay: 9.6, dur: 13, sway: -22, c: "b" },
];

/** The ground band's shared pill material — the SAME surface family as the
 *  command line (border-strong, panel gradient, radius-2xl, pop shadow), so
 *  dock, shelf and composer read as one scale (owner: "the different sizes
 *  feel weird"). */
const GROUND_PILL =
  "osai-spotlight press group flex items-center gap-2.5 rounded-2xl border border-[var(--color-border-strong)] bg-gradient-to-b from-[var(--color-panel-2)]/80 to-[var(--color-panel-2)]/55 shadow-[var(--osai-shadow-pop)] backdrop-blur transition-all duration-150 hover:-translate-y-0.5 hover:text-[var(--color-text)]";

/** The quick-start dock — exactly the three the owner asked for, cut from
 *  the command bar's cloth (same height, same material). */
function LockDock({ onSpawn }: { onSpawn: (kind: AppDef["kind"], label: string) => void }) {
  const actions: Array<{ label: string; icon: ReactNode; run: () => void }> = [
    { label: "chat", icon: <Sparkles size={16} />, run: () => onSpawn({ type: "chat" } as AppDef["kind"], "chat") },
    { label: "terminal", icon: <Terminal size={16} />, run: () => onSpawn({ type: "shell" } as AppDef["kind"], "terminal") },
    { label: "notes", icon: <Feather size={16} />, run: () => onSpawn({ type: "notes" } as AppDef["kind"], "notes") },
  ];
  return (
    <div className="flex items-center gap-2.5">
      {actions.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.run}
          onMouseMove={spotlightMove}
          className={`${GROUND_PILL} px-4 py-3 text-[13.5px] text-[var(--color-text-2)]`}
        >
          <span className="text-[var(--color-accent)] transition-transform group-hover:scale-110">{a.icon}</span>
          {a.label}
        </button>
      ))}
    </div>
  );
}

/** The continue shelf — one compact surface: the resume-layout card, live work
 *  sessions (with done/remove on hover), then recent projects to fill; the
 *  footer link overflows into the projects pane. */
function ContinueShelf({
  projects,
  pulse,
  shapeByRoot,
  onOpenProject,
  resumeLayout,
  onResumeLayout,
  sessions,
  onResumeSession,
  onRemoveSession,
  onDoneSession,
  onAllProjects,
}: {
  projects: ProjectInfo[];
  pulse: RepoPulse[];
  shapeByRoot?: Record<string, string>;
  onOpenProject: (p: ProjectInfo) => void;
  resumeLayout?: { count: number; labels: string[] } | null;
  onResumeLayout?: () => void;
  sessions?: WorkSession[];
  onResumeSession?: (s: WorkSession) => void;
  onRemoveSession?: (id: string) => void;
  onDoneSession?: (id: string) => void;
  onAllProjects: () => void;
}) {
  const liveSessions = (sessions ?? []).filter((s) => s.status !== "done");
  const sessionRows = onResumeSession ? liveSessions.slice(0, 2) : [];
  const slotsLeft = Math.max(0, 4 - sessionRows.length - (resumeLayout && onResumeLayout ? 1 : 0));
  const projectRows = projects.slice(0, slotsLeft);
  const pulseFor = (root: string) => pulse.find((r) => r.root === root) ?? null;

  // pills, not a card box (owner: "in pills like the quick actions, and that
  // projects box is too high") — each row is its own GROUND_PILL, same
  // material + scale as the dock and the command line.
  return (
    <div className="flex flex-col items-stretch gap-2">
      {resumeLayout && onResumeLayout && (
        <button
          type="button"
          onClick={onResumeLayout}
          onMouseMove={spotlightMove}
          title={resumeLayout.labels.join(" · ")}
          className={`${GROUND_PILL} px-4 py-2.5`}
        >
          <History size={15} className="shrink-0 text-[var(--osai-accent-2)]" />
          <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-text)]">
            pick up where you left off
          </span>
          <span className="shrink-0 font-mono text-[9.5px] text-[var(--color-faint)]">
            {resumeLayout.count} pane{resumeLayout.count === 1 ? "" : "s"}
          </span>
        </button>
      )}

      {sessionRows.map((s) => {
        const paneCount = s.panes.length + (s.chatSessionIds.length > 0 ? 1 : 0);
        return (
          <div key={s.id} onMouseMove={spotlightMove} className={`${GROUND_PILL} pl-4 pr-2 py-2.5`}>
            <button
              type="button"
              onClick={() => onResumeSession?.(s)}
              title={s.goal || s.title}
              className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
            >
              <History size={15} className="shrink-0 text-[var(--color-accent)]" />
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-text)]">
                {s.title || "work session"}
              </span>
              <span className="shrink-0 font-mono text-[9.5px] text-[var(--color-faint)]">
                {paneCount}p · {ago(Math.floor(s.lastActiveAt / 1000))}
              </span>
            </button>
            <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              {onDoneSession && (
                <button
                  type="button"
                  onClick={() => onDoneSession(s.id)}
                  title="mark done"
                  className="press grid place-items-center rounded-md p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-success)]"
                >
                  <Check size={12} />
                </button>
              )}
              {onRemoveSession && (
                <button
                  type="button"
                  onClick={() => onRemoveSession(s.id)}
                  title="remove"
                  className="press grid place-items-center rounded-md p-1 text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel)] hover:text-[var(--color-danger)]"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        );
      })}

      {projectRows.map((p) => {
        const repo = pulseFor(p.root);
        const shape = shapeByRoot?.[p.root];
        // show WHEN YOU last opened it (the sort key) — fs mtime lies when an
        // agent has been editing files in there; fall back for never-opened.
        const openedAt = lastAccessFor(p.root);
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
            onClick={() => onOpenProject(p)}
            onMouseMove={spotlightMove}
            title={drift ? `open ${p.root}\n${drift}` : `open ${p.root}`}
            className={`${GROUND_PILL} px-4 py-2.5`}
          >
            <FolderGit2 size={15} className="shrink-0 text-[var(--color-accent)]" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--color-text)]">{p.name}</span>
            {drift && (
              <span
                className={`status-dot shrink-0 ${repo!.dirty > 0 ? "status-dot--idle" : "status-dot--dormant"}`}
                style={{ width: 6, height: 6 }}
                aria-label={drift}
              />
            )}
            {shape && (
              <span
                className="shrink-0 rounded-[4px] border border-[color-mix(in_srgb,var(--color-accent)_34%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] px-1 py-px font-mono text-[8.5px] uppercase tracking-wide text-[var(--color-accent)]"
                title="structured workspace — opens a component picker"
              >
                {shape}
              </span>
            )}
            <span className="shrink-0 font-mono text-[9.5px] text-[var(--color-muted)]">
              {ago(openedAt || p.mtime)}
            </span>
          </button>
        );
      })}

      {projectRows.length === 0 && sessionRows.length === 0 && !(resumeLayout && onResumeLayout) && (
        <div className="px-2 py-2 text-[11.5px] text-[var(--color-faint)]">
          nothing to pick back up yet — the world is quiet
        </div>
      )}

      <button
        type="button"
        onClick={onAllProjects}
        className="press self-end rounded-md px-2 py-0.5 font-mono text-[10px] text-[var(--color-faint)] transition-colors hover:text-[var(--color-text-2)]"
      >
        all projects →
      </button>
    </div>
  );
}

// ── command line — composer-grade seed-a-chat input ───────────────────────────

/** Last launched seed (↑ recall in the empty command line, depth 1). */
const LAST_SEED_KEY = "osai.home.lastSeed";

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
      className="osai-fade-in w-full"
      style={{ animationDelay: "80ms" }}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div
        ref={surfaceRef}
        className="group/cmd relative flex items-center gap-3 overflow-hidden rounded-2xl border border-[var(--color-border-strong)] bg-gradient-to-b from-[var(--color-panel-2)]/80 to-[var(--color-panel-2)]/55 px-4 py-3 shadow-[var(--osai-shadow-pop)] backdrop-blur transition-all duration-300 focus-within:border-[var(--color-accent)]/60 focus-within:shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent)_50%,transparent),0_18px_50px_-12px_color-mix(in_srgb,var(--color-accent)_45%,transparent)]"
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
                className="osai-cmd-ph absolute inset-y-0 left-0 flex items-center font-sans text-[15px] leading-relaxed text-[var(--color-faint)]"
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
            className="osai-cmd-vanish absolute left-0 top-0"
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
              className="pill press osai-fade-in flex items-center gap-1.5"
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

// ── small shared bits ─────────────────────────────────────────────────────────

/** Relative-time helper. */
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

/** Section eyebrow — a glowing tick + mono label + a fading rule. */
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-0.5">
      <span className="h-[5px] w-[5px] shrink-0 rounded-[1px] bg-[var(--color-accent)] shadow-[var(--osai-glow-soft)]" />
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-[var(--color-faint)]">{children}</span>
      <span className="h-px flex-1 bg-[linear-gradient(90deg,var(--color-border),transparent)]" />
    </div>
  );
}
