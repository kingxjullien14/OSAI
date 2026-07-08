/** The pet's ROOM (P3, living-cockpit) — the glass spirit at home.
 *
 *  Rebuilt around the P0 soul + P1 rig: the room is a VIEW of the persisted
 *  soul (needs · bond · stage · affinity · totals) plus direct care. It never
 *  owns the world-signal sampling — the roaming overlay does that — but it
 *  does advance pure metabolism while open (tick with no active minutes is
 *  idempotent against the overlay's richer ticks), so the bars are honest
 *  even when roaming is off.
 *
 *  Liveness still lands here: the chat/terminal pet bus (lib/pet.ts) keeps
 *  feeding reactions (finished run → celebrate, error → wince) and the
 *  occasional useful speech bubble; the room plays them over the steady pose.
 *  (On the idle home the spirit lives on the horizon line itself — see
 *  IdleControlCenter's HorizonPet.) */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Pencil } from "lucide-react";

import {
  applyCare,
  flavorOf,
  moodOf,
  stageOf,
  suggestActivity,
  tick,
  TUNING,
  type PetMood,
  type PetSoul,
  type PetStage,
  type PetSurface,
} from "../lib/pet/engine";
import { loadPetName, loadSoul, savePetName, saveSoul, subscribeSoul } from "../lib/pet/store";
import {
  subscribePetBubbles,
  subscribePetReactions,
  type PetBubble,
} from "../lib/pet";
import { PetBody, type PetPose } from "./pet/PetBody";

const DAY = 24 * 3_600_000;

const isNightNow = () => {
  const h = new Date().getHours();
  return h < 7 || h >= 22;
};

const MOOD_LINE: Record<PetMood, string> = {
  ecstatic: "having the best day",
  happy: "in good spirits",
  content: "humming along",
  hungry: "eyeing the snack drawer",
  sleepy: "fighting a nap",
  grumpy: "a little sulky",
  sick: "under the weather",
};

const STAGE_LABEL: Record<PetStage, string> = {
  hatchling: "hatchling",
  sprout: "sprout",
  adept: "adept",
  elder: "elder",
};

const SURFACE_LABEL: Record<PetSurface, string> = {
  terminal: "the terminal",
  chat: "the chat",
  browser: "the browser",
  files: "the files",
  notes: "the notes",
};

function bondLevel(bond: number): string {
  if (bond >= 85) return "soul-bound";
  if (bond >= 55) return "inseparable";
  if (bond >= 25) return "trusted";
  if (bond >= 8) return "warming up";
  return "new friend";
}

/** Minutes of cooldown left before a care kind gives full effect again. */
function cooldownLeft(soul: PetSoul, kind: "feed" | "play" | "pet", now: number): number {
  const [anchor, mins] =
    kind === "feed"
      ? [soul.last.fedAt, TUNING.feedCooldownMin]
      : kind === "play"
        ? [soul.last.playedAt, TUNING.playCooldownMin]
        : [soul.last.pettedAt, TUNING.petCooldownMin];
  return Math.max(0, Math.ceil((anchor + mins * 60_000 - now) / 60_000));
}

/** Milestone keepsakes — the room's shelf. Earned from the soul's real
 *  history (totals + bond + age); nothing here is a grind meter. */
function keepsakesOf(soul: PetSoul, now: number) {
  const t = soul.totals;
  const ageDays = (now - soul.bornAt) / DAY;
  return [
    { key: "first-meal", label: "first meal", hint: "shared one snack", earned: t.fed >= 1 },
    { key: "house-chef", label: "house chef", hint: "25 meals together", earned: t.fed >= 25 },
    { key: "playmate", label: "playmate", hint: "played 10 times", earned: t.played >= 10 },
    { key: "beloved", label: "beloved", hint: "petted 50 times", earned: t.petted >= 50 },
    { key: "shipmate", label: "shipmate", hint: "cheered 10 finished runs", earned: t.celebrations >= 10 },
    { key: "storm-tested", label: "storm-tested", hint: "weathered 5 failures with you", earned: t.startles >= 5 },
    { key: "week-one", label: "week one", hint: "seven days old", earned: ageDays >= 7 },
    { key: "old-friend", label: "old friend", hint: "thirty days old", earned: ageDays >= 30 },
    { key: "bonded", label: "bonded", hint: "bond reached 25", earned: soul.bond >= 25 },
    { key: "inseparable", label: "inseparable", hint: "bond reached 55", earned: soul.bond >= 55 },
  ];
}

/** Next stage gate, for the journey card. Null once elder. */
function nextStageOf(stage: PetStage): { stage: PetStage; days: number; bond: number } | null {
  if (stage === "hatchling") return { stage: "sprout", days: TUNING.stages.sprout[0], bond: TUNING.stages.sprout[1] };
  if (stage === "sprout") return { stage: "adept", days: TUNING.stages.adept[0], bond: TUNING.stages.adept[1] };
  if (stage === "adept") return { stage: "elder", days: TUNING.stages.elder[0], bond: TUNING.stages.elder[1] };
  return null;
}

function needTone(value: number): string {
  if (value >= 60) return "var(--color-success)";
  if (value >= 30) return "var(--color-warning)";
  return "var(--color-danger)";
}

const CARE_BTN =
  "inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2.5 py-1.5 text-[11px] text-[var(--color-text-2)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-text)]";

/** Shared soul plumbing for the room + the companion: live soul, steady pose
 *  (recomputed on a cadence), transient pose overrides, and the pet-bus
 *  reaction adapter (celebrate / wince → poses). */
function useLivingSoul() {
  const [soul, setSoul] = useState(loadSoul);
  useEffect(() => subscribeSoul(setSoul), []);
  const soulRef = useRef(soul);
  soulRef.current = soul;

  const [override, setOverride] = useState<{ pose: PetPose; until: number } | null>(null);
  const playPose = useCallback((pose: PetPose, ms: number) => {
    setOverride({ pose, until: Date.now() + ms });
    window.setTimeout(
      () => setOverride((cur) => (cur && Date.now() >= cur.until ? null : cur)),
      ms + 40,
    );
  }, []);

  const [steady, setSteady] = useState<PetPose>(() =>
    suggestActivity(soulRef.current, { isNight: isNightNow() }),
  );
  useEffect(() => {
    const recompute = () => setSteady(suggestActivity(soulRef.current, { isNight: isNightNow() }));
    recompute();
    const t = setInterval(recompute, 30_000);
    return () => clearInterval(t);
  }, [soul]);

  // the chat/terminal pet bus → transient poses (the room stays alive even
  // when the roaming overlay is off).
  useEffect(
    () =>
      subscribePetReactions((r) => {
        if (r === "celebrate") playPose("celebrate", 2_800);
        else if (r === "wince") playPose("startled", 2_400);
      }),
    [playPose],
  );

  const pose: PetPose = override && Date.now() < override.until ? override.pose : steady;
  return { soul, soulRef, pose, playPose };
}

function CareActions({
  soul,
  onCare,
  compactNotes = false,
}: {
  soul: PetSoul;
  onCare: (kind: "feed" | "play" | "pet") => void;
  compactNotes?: boolean;
}) {
  // re-render each minute so the cooldown notes count down honestly
  const [, setBeat] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setBeat((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);
  const now = Date.now();
  const rows: Array<{ kind: "feed" | "play" | "pet"; label: string; effect: string }> = [
    { kind: "feed", label: "feed", effect: `+${TUNING.feedAmount} fullness` },
    { kind: "play", label: "play", effect: `+${TUNING.playSpirits} spirits · −${TUNING.playEnergyCost} energy` },
    { kind: "pet", label: "pet", effect: `+${TUNING.petSpirits} spirits` },
  ];
  return (
    <div className="flex flex-wrap items-start gap-2">
      {rows.map((r) => {
        const left = cooldownLeft(soul, r.kind, now);
        return (
          <div key={r.kind} className="flex flex-col gap-0.5">
            <button type="button" className={CARE_BTN} onClick={() => onCare(r.kind)}>
              {r.label}
            </button>
            {!compactNotes && (
              <span className="text-[9.5px] leading-tight text-[var(--color-muted)]">
                {left > 0 ? `resting ${left}m · smaller effect` : r.effect}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RoomCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel)_60%,transparent)] p-3">
      <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">{label}</div>
      {children}
    </section>
  );
}

function NeedBar({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-[var(--color-text-2)]">{label}</span>
        <span className="text-[var(--color-muted)]">{Math.round(value)} / 100</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)]">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{ width: `${Math.round(value)}%`, background: needTone(value) }}
        />
      </div>
      <span className="text-[9.5px] leading-tight text-[var(--color-muted)]">{hint}</span>
    </div>
  );
}

export function PetPane() {
  const { soul, soulRef, pose, playPose } = useLivingSoul();
  const now = Date.now();
  const isNight = isNightNow();
  const mood = moodOf(soul, { isNight });
  const stage = stageOf(soul, now);
  const flavor = flavorOf(soul, now);

  // metabolism keeps moving while the room is open (no active minutes here —
  // the overlay owns the focus/affinity sampling, so nothing double-counts).
  useEffect(() => {
    const advance = () => {
      const next = tick(soulRef.current, { now: Date.now(), isNight: isNightNow() });
      if (next !== soulRef.current) saveSoul(next);
    };
    advance();
    const t = setInterval(advance, 60_000);
    return () => clearInterval(t);
  }, [soulRef]);

  // occasional useful one-liner from the pet bus (low context, failed run…)
  const [bubble, setBubble] = useState<PetBubble | null>(null);
  useEffect(() => {
    let timer: number | null = null;
    const unsub = subscribePetBubbles((b) => {
      setBubble(b);
      if (timer != null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setBubble(null), 7_000);
    });
    return () => {
      unsub();
      if (timer != null) window.clearTimeout(timer);
    };
  }, []);

  const care = useCallback(
    (kind: "feed" | "play" | "pet") => {
      saveSoul(applyCare(soulRef.current, { kind, now: Date.now() }));
      playPose(kind === "feed" ? "eat" : kind === "play" ? "play" : "celebrate", kind === "pet" ? 1_400 : 2_200);
    },
    [playPose, soulRef],
  );

  // name — kept outside the soul (pure engine stays shape-stable)
  const [name, setName] = useState(loadPetName);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState("");
  const commitName = () => {
    const trimmed = draftName.trim();
    savePetName(trimmed);
    setName(trimmed);
    setEditingName(false);
  };

  const ageDays = Math.max(0, Math.floor((now - soul.bornAt) / DAY));
  const nextStage = nextStageOf(stage);
  const keepsakes = keepsakesOf(soul, now);
  const earned = keepsakes.filter((k) => k.earned).length;

  const affinityEntries = (Object.entries(soul.affinity) as [PetSurface, number][])
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);
  const affinityTotal = affinityEntries.reduce((a, [, v]) => a + v, 0);

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3">
      {/* ── the room itself ── */}
      <section
        className="relative shrink-0 overflow-hidden rounded-2xl border border-[var(--color-border)]"
        style={{
          minHeight: 240,
          background: `linear-gradient(180deg, color-mix(in srgb, var(--color-panel) ${pose === "sleep" ? 88 : 72}%, transparent), color-mix(in srgb, var(--color-panel) 45%, transparent))`,
        }}
      >
        {/* ambient depth */}
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute -left-10 -top-14 h-44 w-44 rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--color-accent) 18%, transparent), transparent 70%)" }}
          />
          <div
            className="absolute -bottom-16 -right-8 h-48 w-48 rounded-full blur-3xl"
            style={{ background: "radial-gradient(circle, color-mix(in srgb, var(--osai-accent-2) 14%, transparent), transparent 70%)" }}
          />
        </div>

        {/* floor */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-9 border-t border-[var(--color-border)]"
          style={{ background: "color-mix(in srgb, var(--color-panel) 55%, transparent)" }}
        />

        {/* speech bubble (pet bus) */}
        {bubble && (
          <div
            key={bubble.id}
            className="modal-in pointer-events-none absolute left-1/2 top-2 z-10 max-w-[240px] -translate-x-1/2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel)] px-2.5 py-1.5 text-center text-[11px] leading-snug text-[var(--color-text-2)] shadow-[var(--osai-shadow-pop)]"
          >
            {bubble.text}
          </div>
        )}

        {/* the spirit, standing on the floor — click = pat */}
        <button
          type="button"
          title="pat"
          onClick={() => care("pet")}
          className="absolute bottom-1 left-1/2 -translate-x-1/2 cursor-pointer"
        >
          <PetBody size={150} mood={mood} pose={pose} stage={stage} flavor={flavor} />
        </button>

        {/* name plate */}
        <div className="absolute left-3 top-2.5">
          <div className="text-[10px] uppercase tracking-[0.14em] text-[var(--color-muted)]">the resident</div>
          {editingName ? (
            <input
              autoFocus
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitName();
                if (e.key === "Escape") setEditingName(false);
              }}
              onBlur={commitName}
              maxLength={24}
              placeholder="name your spirit"
              className="mt-0.5 w-[150px] rounded-md border border-[var(--color-border-strong)] bg-[var(--color-panel-2)] px-1.5 py-0.5 text-[13px] text-[var(--color-text)] outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraftName(name);
                setEditingName(true);
              }}
              className="group mt-0.5 flex items-center gap-1.5 text-[14px] font-medium text-[var(--color-text)]"
              title="rename"
            >
              {name || "name your spirit"}
              <Pencil size={11} className="opacity-0 transition-opacity group-hover:opacity-60" />
            </button>
          )}
          <div className="mt-0.5 text-[11px] text-[var(--color-text-2)]">{MOOD_LINE[mood]}</div>
        </div>

        {/* status chips */}
        <div className="absolute right-3 top-2.5 flex flex-col items-end gap-1 text-[10px]">
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-0.5 text-[var(--color-text-2)]">
            {STAGE_LABEL[stage]}
            {flavor ? ` · ${SURFACE_LABEL[flavor].replace("the ", "")} spirit` : ""}
          </span>
          <span className="rounded-full border border-[var(--color-border)] bg-[var(--color-panel-2)] px-2 py-0.5 text-[var(--color-muted)]">
            day {ageDays + 1}
            {isNight ? " · night" : ""}
          </span>
        </div>
      </section>

      {/* ── stats + care ── */}
      <div className="grid shrink-0 gap-3 md:grid-cols-2">
        <RoomCard label="vitals">
          <div className="flex flex-col gap-2.5">
            <NeedBar label="energy" value={soul.needs.energy} hint="rest refills it — working together burns it" />
            <NeedBar label="fullness" value={soul.needs.fullness} hint="a slow metabolism; it forages rather than starve" />
            <NeedBar label="spirits" value={soul.needs.spirits} hint="finished runs and play lift it; failures dent it" />
          </div>
        </RoomCard>

        <RoomCard label="care">
          <CareActions soul={soul} onCare={care} />
          <p className="mt-2 text-[10px] leading-snug text-[var(--color-muted)]">
            rhythm beats spam — inside a cooldown the effect shrinks to a quarter. you can also just
            grab it off the floor and toss it around; it doesn't mind.
          </p>
        </RoomCard>

        <RoomCard label="bond & journey">
          <div className="flex items-baseline justify-between text-[11px]">
            <span className="text-[var(--color-text-2)]">{bondLevel(soul.bond)}</span>
            <span className="text-[var(--color-muted)]">bond {Math.round(soul.bond)} / 100</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{
                width: `${Math.round(soul.bond)}%`,
                background: "linear-gradient(90deg, var(--color-accent), var(--osai-accent-2))",
              }}
            />
          </div>
          <p className="mt-2 text-[10px] leading-snug text-[var(--color-muted)]">
            {nextStage
              ? `next: ${STAGE_LABEL[nextStage.stage]} — from day ${nextStage.days} with bond ${nextStage.bond}. bond only ever grows: care + time spent working together.`
              : "final form — it's seen everything with you."}
          </p>
        </RoomCard>

        <RoomCard label="favorite places">
          {affinityTotal <= 0 ? (
            <p className="text-[11px] leading-snug text-[var(--color-muted)]">
              still exploring — it picks up affinity from wherever you two spend time. once one place
              clearly wins, its evolution takes that flavor.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {affinityEntries.slice(0, 4).map(([surface, mins]) => (
                <div key={surface} className="flex items-center gap-2 text-[11px]">
                  <span className="w-16 shrink-0 text-[var(--color-text-2)]">{surface}</span>
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--color-text)_10%,transparent)]">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.max(4, Math.round((mins / affinityTotal) * 100))}%`,
                        background: "var(--osai-accent-2)",
                      }}
                    />
                  </div>
                  <span className="w-10 shrink-0 text-right text-[10px] text-[var(--color-muted)]">
                    {mins >= 90 ? `${Math.round(mins / 60)}h` : `${Math.round(mins)}m`}
                  </span>
                </div>
              ))}
              <p className="mt-1 text-[10px] leading-snug text-[var(--color-muted)]">
                {flavor
                  ? `it grew into a ${SURFACE_LABEL[flavor].replace("the ", "")} spirit — ${SURFACE_LABEL[flavor]} is home.`
                  : "no single place dominates yet — a clear favorite shapes its adept form."}
              </p>
            </div>
          )}
        </RoomCard>
      </div>

      {/* ── keepsakes ── */}
      <RoomCard label={`keepsakes · ${earned} of ${keepsakes.length}`}>
        <div className="flex flex-wrap gap-1.5">
          {keepsakes.map((k) => (
            <span
              key={k.key}
              title={k.hint}
              className={
                k.earned
                  ? "rounded-full border border-[var(--color-border-strong)] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] px-2 py-0.5 text-[10px] text-[var(--color-text)]"
                  : "rounded-full border border-dashed border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] opacity-70"
              }
            >
              {k.label}
            </span>
          ))}
        </div>
        <p className="mt-2 text-[10px] leading-snug text-[var(--color-muted)]">
          earned from its real history with you — meals, play, runs cheered, storms weathered.
        </p>
      </RoomCard>
    </div>
  );
}

/* (PetDashboardCompanion retired with the Horizon lock screen — the spirit
   lives ON the idle home's horizon line now; see IdleControlCenter's
   HorizonPet. The room above is the pet's one full surface.) */
