/** The DESK CREATURE (P2, living-cockpit): the glass spirit roams the
 *  workspace floor. It wanders, pauses, sleeps at night, celebrates finished
 *  agent runs, startles at errors — and it can be picked up and TOSSED
 *  (pointer-capture physics: dangle while held, spin on release, squash on
 *  landing). Left-click pets it; right-click is care + its room.
 *
 *  P4 gave it a VOICE: rare, useful speech bubbles (a finished run, an
 *  error, usage pace, a care need) with click-to-jump. lib/pet/voice.ts is
 *  the pure decider (global gap + per-kind cooldowns + quiet/asleep/carried
 *  silences); the petVoice setting turns the whole thing off.
 *
 *  Perf contract (same as FloatingWindow): the roam/physics loops mutate the
 *  wrapper's transform directly — React re-renders only on pose/mood/soul
 *  changes, never per frame. */
import { useCallback, useEffect, useRef, useState } from "react";

import {
  applyCare,
  moodOf,
  stageOf,
  flavorOf,
  suggestActivity,
  tick,
  type PetSurface,
} from "../../lib/pet/engine";
import { loadSoul, saveSoul, subscribeSoul } from "../../lib/pet/store";
import {
  agentDoneLine,
  agentErrorLine,
  createVoiceState,
  needLine,
  tryVoice,
  usageLine,
  type PetVoiceKind,
} from "../../lib/pet/voice";
import { subscribePetBubbles } from "../../lib/pet";
import { claudeRate } from "../../lib/dashboard";
import { usagePaceRisk } from "../../lib/usagePace";
import {
  subscribeNotifications,
  listNotifications,
  type OsaiNotification,
} from "../../lib/notifications";
import { loadSettings, subscribe as subscribeSettings } from "../../lib/settings";
import { PaneMenu, type PaneMenuEntry } from "../PaneMenu";
import { PetBody, type PetPose } from "./PetBody";

const SIZE = 60;
const FLOOR = 10; // px above the viewport bottom
const SPEED = 34; // px/s wander pace
const GRAVITY = 2400; // px/s² for the toss arc
const TICK_MS = 60_000;

const isNightNow = () => {
  const h = new Date().getHours();
  return h < 7 || h >= 22;
};

export function PetOverlay({
  activeSurface,
  onOpenRoom,
  onOpenTarget,
}: {
  /** which surface the owner is on right now (affinity signal); null = none. */
  activeSurface: PetSurface | null;
  onOpenRoom: () => void;
  /** deep-link opener for click-to-jump speech (App's openNotificationTarget). */
  onOpenTarget?: (item: OsaiNotification) => void;
}) {
  const [soul, setSoul] = useState(loadSoul);
  useEffect(() => subscribeSoul(setSoul), []);
  const soulRef = useRef(soul);
  soulRef.current = soul;

  const [enabled, setEnabled] = useState(() => loadSettings().petRoam);
  useEffect(() => subscribeSettings((s) => setEnabled(s.petRoam)), []);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [voiceOn, setVoiceOn] = useState(() => loadSettings().petVoice);
  useEffect(() => subscribeSettings((s) => setVoiceOn(s.petVoice)), []);
  const voiceOnRef = useRef(voiceOn);
  voiceOnRef.current = voiceOn;

  // transient pose (reactions/care) overrides the steady activity
  const [override, setOverride] = useState<{ pose: PetPose; until: number } | null>(null);
  const [steady, setSteady] = useState<PetPose>(() => suggestActivity(soul, { isNight: isNightNow() }));
  useEffect(() => {
    const recompute = () =>
      setSteady(suggestActivity(soulRef.current, { isNight: isNightNow() }));
    recompute();
    const t = setInterval(recompute, 30_000);
    return () => clearInterval(t);
  }, [soul]);

  const playPose = useCallback((pose: PetPose, ms: number) => {
    setOverride({ pose, until: Date.now() + ms });
    window.setTimeout(
      () => setOverride((cur) => (cur && Date.now() >= cur.until ? null : cur)),
      ms + 40,
    );
  }, []);

  // ── world signals → soul ticks ────────────────────────────────────────────
  const focusSecondsRef = useRef(0);
  const surfaceRef = useRef<PetSurface | null>(activeSurface);
  surfaceRef.current = activeSurface;
  const surfaceSecondsRef = useRef<Partial<Record<PetSurface, number>>>({});
  useEffect(() => {
    const sample = setInterval(() => {
      if (!document.hasFocus()) return;
      focusSecondsRef.current += 5;
      const s = surfaceRef.current;
      if (s) surfaceSecondsRef.current[s] = (surfaceSecondsRef.current[s] ?? 0) + 5;
    }, 5_000);
    const apply = setInterval(() => {
      const surfaceMinutes = Object.fromEntries(
        Object.entries(surfaceSecondsRef.current).map(([k, v]) => [k, (v ?? 0) / 60]),
      );
      const next = tick(soulRef.current, {
        now: Date.now(),
        activeMinutes: focusSecondsRef.current / 60,
        surfaceMinutes,
        isNight: isNightNow(),
      });
      focusSecondsRef.current = 0;
      surfaceSecondsRef.current = {};
      saveSoul(next);
    }, TICK_MS);
    return () => {
      clearInterval(sample);
      clearInterval(apply);
    };
  }, []);

  // (the agent-outcome notification adapter lives below the voice block —
  //  it feeds BOTH poses and speech, and deps must follow declaration order.)
  const lastSeenRef = useRef<string | null>(listNotifications()[0]?.id ?? null);

  // ── roam + physics (style-mutating loops; no per-frame renders) ───────────
  const elRef = useRef<HTMLDivElement | null>(null);
  const posRef = useRef({ x: 120, y: 0 }); // y = lift above the floor line
  const facingRef = useRef<1 | -1>(1);
  const [facing, setFacing] = useState<1 | -1>(1);
  const heldRef = useRef(false);
  const tossRef = useRef<{ vx: number; vy: number } | null>(null);
  const pauseUntilRef = useRef(0);

  const pose: PetPose =
    override && Date.now() < override.until ? override.pose : steady;
  const poseRef = useRef(pose);
  poseRef.current = pose;

  const paint = useCallback(() => {
    const el = elRef.current;
    if (!el) return;
    el.style.transform = `translate(${posRef.current.x}px, ${-posRef.current.y}px)`;
  }, []);

  // ── the voice (P4): rare useful speech, hard rate-limited ────────────────
  const voiceRef = useRef(createVoiceState());
  const [speech, setSpeech] = useState<{
    id: number;
    text: string;
    jump?: () => void;
    align: "left" | "center" | "right";
  } | null>(null);
  const speechSeqRef = useRef(0);
  const speechTimerRef = useRef<number | null>(null);

  const say = useCallback((kind: PetVoiceKind, text: string, jump?: () => void) => {
    if (!enabledRef.current || !voiceOnRef.current) return;
    const next = tryVoice(voiceRef.current, kind, {
      now: Date.now(),
      quiet: loadSettings().notificationQuietMode,
      asleep: poseRef.current === "sleep",
      carried: heldRef.current || tossRef.current != null,
    });
    if (!next) return;
    voiceRef.current = next;
    // keep the bubble on-screen when it talks near a wall
    const x = posRef.current.x;
    const align = x < 150 ? "left" : x > window.innerWidth - 210 ? "right" : "center";
    setSpeech({ id: ++speechSeqRef.current, text, jump, align });
    pauseUntilRef.current = performance.now() + 8_200; // it stops walking to talk
    if (speechTimerRef.current != null) window.clearTimeout(speechTimerRef.current);
    speechTimerRef.current = window.setTimeout(() => setSpeech(null), 8_000);
  }, []);
  useEffect(
    () => () => {
      if (speechTimerRef.current != null) window.clearTimeout(speechTimerRef.current);
    },
    [],
  );

  // voice source: the chat/terminal pet bus (lines are already source-limited
  // — low context, long clean finish; tryVoice is a floor on top).
  useEffect(() => subscribePetBubbles((b) => say("bus", b.text)), [say]);

  // voice source: usage pace — checked lazily every 5 minutes. claudeRate has
  // its own disk cache + 429 backoff so this stays cheap; the first check
  // waits a full interval so app-boot is never chatty.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const check = () => {
      void claudeRate()
        .then((r) => {
          if (!alive || !r) return;
          const spans: Array<{ window: "5h" | "7d"; pct: number; level: "warning" | "danger" }> = [];
          for (const [win, span, windowSeconds] of [
            ["5h", r.fiveHour, 5 * 3600],
            ["7d", r.sevenDay, 7 * 24 * 3600],
          ] as const) {
            const risk = usagePaceRisk({ pct: span.pct, resetsAt: span.resetsAt, windowSeconds });
            if (risk && span.pct != null) spans.push({ window: win, pct: span.pct, level: risk.level });
          }
          const worst = spans.find((s) => s.level === "danger") ?? spans[0];
          if (worst) say("usage", usageLine("claude", worst.window, worst.pct, worst.level));
        })
        .catch(() => {
          /* usage hiccups (429s etc.) are not the pet's business */
        });
    };
    const t = setInterval(check, 5 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [enabled, say]);

  // voice source: its own needs — a rare care nudge; click opens the room.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      const line = needLine(moodOf(soulRef.current, { isNight: isNightNow() }));
      if (line) say("need", line, onOpenRoom);
    }, 10 * 60_000);
    return () => clearInterval(t);
  }, [enabled, say, onOpenRoom]);

  // agent outcomes → reactions + spirit moves + speech (click = jump there).
  // The companion garnish's root: the pet visibly cares about real work.
  useEffect(
    () =>
      subscribeNotifications((items) => {
        const newest = items[0];
        if (!newest || newest.id === lastSeenRef.current) return;
        lastSeenRef.current = newest.id;
        if (newest.read) return;
        const now = Date.now();
        const jump = onOpenTarget ? () => onOpenTarget(newest) : undefined;
        if (newest.level === "error") {
          saveSoul(tick(soulRef.current, { now, agentFailed: 1 }));
          playPose("startled", 2_600);
          say("error", agentErrorLine(newest.title), jump);
        } else if (newest.kind === "chat.done" || newest.level === "success") {
          saveSoul(tick(soulRef.current, { now, agentFinished: 1 }));
          playPose("celebrate", 3_600);
          say("done", agentDoneLine(newest.title), jump);
        }
      }),
    [playPose, say, onOpenTarget],
  );

  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const loop = (t: number) => {
      const dt = Math.min((t - last) / 1000, 0.05);
      last = t;
      const maxX = Math.max(8, window.innerWidth - SIZE - 8);

      if (tossRef.current) {
        // ballistic arc after a throw
        const v = tossRef.current;
        posRef.current.x += v.vx * dt;
        posRef.current.y += v.vy * dt;
        v.vy -= GRAVITY * dt;
        if (posRef.current.x < 8 || posRef.current.x > maxX) {
          v.vx *= -0.55;
          posRef.current.x = Math.max(8, Math.min(maxX, posRef.current.x));
        }
        if (posRef.current.y <= 0) {
          posRef.current.y = 0;
          tossRef.current = null;
          playPose("land", 620);
        }
        paint();
      } else if (!heldRef.current && poseRef.current === "wander" && t >= pauseUntilRef.current) {
        posRef.current.x += facingRef.current * SPEED * dt;
        if (posRef.current.x <= 8 || posRef.current.x >= maxX) {
          facingRef.current = (facingRef.current * -1) as 1 | -1;
          setFacing(facingRef.current);
          posRef.current.x = Math.max(8, Math.min(maxX, posRef.current.x));
        } else if (Math.random() < dt / 7) {
          // wander in beats: every ~7s, take a breather (and maybe turn)
          pauseUntilRef.current = t + 1_500 + Math.random() * 3_000;
          if (Math.random() < 0.35) {
            facingRef.current = (facingRef.current * -1) as 1 | -1;
            setFacing(facingRef.current);
          }
        }
        paint();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [paint, playPose]);

  // ── grab / toss / pet ─────────────────────────────────────────────────────
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      const el = elRef.current;
      if (!el) return;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        /* best-effort */
      }
      const startX = e.clientX;
      const startY = e.clientY;
      const grabDX = e.clientX - posRef.current.x;
      let moved = false;
      const recent: { x: number; y: number; t: number }[] = [];
      const onMove = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
        if (!moved) {
          moved = true;
          heldRef.current = true;
          tossRef.current = null;
          playPose("held", 60_000);
        }
        posRef.current.x = ev.clientX - grabDX;
        // lift = how far above the floor line the cursor is (pet hangs at it)
        posRef.current.y = Math.max(0, window.innerHeight - FLOOR - SIZE / 2 - ev.clientY);
        recent.push({ x: ev.clientX, y: ev.clientY, t: performance.now() });
        if (recent.length > 6) recent.shift();
        paint();
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        if (!moved) {
          // a click = a pat
          saveSoul(applyCare(soulRef.current, { kind: "pet", now: Date.now() }));
          playPose("celebrate", 1_400);
          return;
        }
        heldRef.current = false;
        const a = recent[0];
        const b = recent[recent.length - 1];
        const dt = a && b ? Math.max((b.t - a.t) / 1000, 0.016) : 1;
        const vx = a && b ? (b.x - a.x) / dt : 0;
        const vy = a && b ? -(b.y - a.y) / dt : 0;
        if (posRef.current.y > 2 || Math.abs(vx) > 60) {
          tossRef.current = { vx: vx * 0.9, vy: Math.max(vy * 0.9, -200) };
          playPose("tossed", 60_000);
        } else {
          setOverride(null);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [paint, playPose],
  );

  const care = useCallback(
    (kind: "feed" | "play") => {
      saveSoul(applyCare(soulRef.current, { kind, now: Date.now() }));
      playPose(kind === "feed" ? "eat" : "play", kind === "feed" ? 1_600 : 2_400);
    },
    [playPose],
  );

  if (!enabled) return null;

  const isNight = isNightNow();
  const mood = moodOf(soul, { isNight });
  const menuItems: PaneMenuEntry[] = [
    { key: "feed", label: "Feed", hint: "fullness +", onSelect: () => care("feed") },
    { key: "play", label: "Play", hint: "spirits + · energy −", onSelect: () => care("play") },
    {
      key: "pet",
      label: "Pet",
      onSelect: () => {
        saveSoul(applyCare(soulRef.current, { kind: "pet", now: Date.now() }));
        playPose("celebrate", 1_400);
      },
    },
    { key: "sep", separator: true },
    { key: "room", label: "Open its room", onSelect: onOpenRoom },
  ];

  return (
    <>
      <div
        ref={elRef}
        onPointerDown={onPointerDown}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        title={`${mood} · ${stageOf(soul, Date.now())}`}
        className="fixed left-0 z-[55] cursor-grab select-none active:cursor-grabbing"
        style={{
          bottom: FLOOR,
          width: SIZE,
          height: SIZE,
          transform: `translate(${posRef.current.x}px, 0px)`,
          touchAction: "none",
        }}
      >
        {/* speech — a solid glass chip riding the follower box (it tracks the
            pet for free). Click = jump to the source; stopPropagation keeps
            the click from reading as a grab or a pat. */}
        {speech && (
          <button
            key={speech.id}
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onContextMenu={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              speech.jump?.();
              setSpeech(null);
            }}
            title={speech.jump ? "jump there" : undefined}
            className={`modal-in absolute bottom-[calc(100%+8px)] z-10 w-max max-w-[230px] rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-2.5 py-1.5 text-left text-[11px] leading-snug text-[var(--color-text-2)] shadow-[var(--osai-shadow-pop)] ${
              speech.align === "left"
                ? "left-0"
                : speech.align === "right"
                  ? "right-0"
                  : "left-1/2 -translate-x-1/2"
            } ${speech.jump ? "cursor-pointer transition-colors hover:text-[var(--color-text)]" : "cursor-default"}`}
          >
            {speech.text}
          </button>
        )}
        <PetBody
          size={SIZE}
          mood={mood}
          pose={pose}
          stage={stageOf(soul, Date.now())}
          flavor={flavorOf(soul, Date.now())}
          facing={facing}
        />
      </div>
      {menu && <PaneMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </>
  );
}
