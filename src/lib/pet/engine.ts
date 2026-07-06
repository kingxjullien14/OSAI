/** The pet's SOUL — a pure, deterministic state machine (P0 of the
 *  living-cockpit plan, misc/PLAN-living-cockpit.md).
 *
 *  Approved concept: desk-creature body × tamagotchi soul × companion-agent
 *  garnish. This module is the soul: needs (energy · fullness · spirits) fed
 *  by REAL signals — the owner's activity minutes, streaks, agent outcomes,
 *  the clock — plus direct care (feed / play / pet). Everything derived
 *  (mood, life stage, flavor, what the body should be doing) is computed,
 *  never stored.
 *
 *  PURE by contract: no Date.now(), no localStorage, no tauri — every fn
 *  takes `now` and returns a new soul. Adapters (store.ts, the overlay,
 *  the pane) own I/O. Design rules:
 *  - Neglect makes the pet SAD, never dead: needs have self-care floors
 *    (it forages, it naps) and long absences clamp to bounded decay.
 *  - Care spam gives diminishing returns (cooldowns), so the bond rewards
 *    rhythm, not clicking.
 *  - Bond only rises — it's trust, not a meter to babysit. */

// ── shapes ───────────────────────────────────────────────────────────────────

export interface PetNeeds {
  /** 0..100 — rest. Burns while you work alongside it, recovers on rest/sleep. */
  energy: number;
  /** 0..100 — food. Slow metabolism; feeding tops it up. */
  fullness: number;
  /** 0..100 — morale. Streaks, wins and play lift it; failures dent it. */
  spirits: number;
}

export type PetSurface = "terminal" | "chat" | "browser" | "files" | "notes";

export type PetMood =
  | "ecstatic"
  | "happy"
  | "content"
  | "hungry"
  | "sleepy"
  | "grumpy"
  | "sick";

export type PetStage = "hatchling" | "sprout" | "adept" | "elder";

/** What the body should be doing — the rig (P1/P2) animates from this. */
export type PetActivityState =
  | "idle"
  | "wander"
  | "sleep"
  | "eat"
  | "play"
  | "celebrate"
  | "startled";

export interface PetSoul {
  version: 1;
  /** first adoption (ms). Migrated pets inherit their first-seen time. */
  bornAt: number;
  needs: PetNeeds;
  /** 0..100, monotonic — grows through care + shared activity. */
  bond: number;
  /** accumulated minutes of shared time per surface — flavor comes from this. */
  affinity: Record<PetSurface, number>;
  /** last time decay was applied (ms). */
  lastTick: number;
  /** care cooldown anchors (ms epoch; 0 = never). */
  last: { fedAt: number; playedAt: number; pettedAt: number };
  totals: { fed: number; played: number; petted: number; celebrations: number; startles: number };
}

/** One tick's worth of world input — adapters aggregate since the last tick. */
export interface PetSignals {
  now: number;
  /** minutes the owner was actively using the app since the last tick. */
  activeMinutes?: number;
  /** current day-streak (pulse) — a small daily pride boost. */
  streakDays?: number;
  /** shared minutes per surface since last tick (drives affinity/flavor). */
  surfaceMinutes?: Partial<Record<PetSurface, number>>;
  /** agent outcomes since last tick. */
  agentFinished?: number;
  agentFailed?: number;
  /** adapter-computed (engine stays clock-free): local night hours. */
  isNight?: boolean;
}

export interface PetCare {
  kind: "feed" | "play" | "pet";
  now: number;
}

// ── tuning (exported so tests + the room UI can show honest numbers) ─────────

export const TUNING = {
  /** per-hour drifts */
  energyRestPerHour: 8, // recovery when idle/asleep
  energyBurnPerActiveHour: 6, // working together costs energy
  fullnessBurnPerHour: 2.5,
  spiritsDriftPerHour: 2, // toward the 55 baseline
  spiritsBaseline: 55,
  /** self-care floors — neglect saddens, never kills */
  fullnessFloor: 12,
  energyFloor: 15,
  /** absences longer than this decay as if it were this long */
  maxAbsenceHours: 72,
  /** care effects + cooldowns (minutes) */
  feedAmount: 30,
  feedCooldownMin: 25,
  playSpirits: 14,
  playEnergyCost: 8,
  playCooldownMin: 15,
  petSpirits: 5,
  petCooldownMin: 5,
  /** diminishing returns inside a cooldown window */
  cooldownYield: 0.25,
  /** bond growth (monotonic) */
  bondPerCare: 0.6,
  bondPerSharedHour: 0.5,
  bondDailyCareCap: 4, // care-sourced bond per day, max
  /** stage gates: [minAgeDays, minBond] */
  stages: {
    sprout: [2, 8],
    adept: [7, 25],
    elder: [21, 55],
  } as Record<Exclude<PetStage, "hatchling">, [number, number]>,
  /** flavor needs this share of total affinity + adept stage */
  flavorShare: 0.4,
} as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));

// ── lifecycle ────────────────────────────────────────────────────────────────

export function createSoul(now: number, opts: { bornAt?: number } = {}): PetSoul {
  return {
    version: 1,
    bornAt: opts.bornAt ?? now,
    needs: { energy: 80, fullness: 70, spirits: 65 },
    bond: 0,
    affinity: { terminal: 0, chat: 0, browser: 0, files: 0, notes: 0 },
    lastTick: now,
    last: { fedAt: 0, playedAt: 0, pettedAt: 0 },
    totals: { fed: 0, played: 0, petted: 0, celebrations: 0, startles: 0 },
  };
}

/** Advance time + absorb the world. Idempotent for `now <= lastTick`. */
export function tick(soul: PetSoul, signals: PetSignals): PetSoul {
  const now = signals.now;
  if (now <= soul.lastTick) return soul;
  const elapsedH = Math.min((now - soul.lastTick) / HOUR, TUNING.maxAbsenceHours);
  const activeH = Math.min((signals.activeMinutes ?? 0) / 60, elapsedH);
  const restH = elapsedH - activeH;

  const needs = { ...soul.needs };

  // energy: burns with shared work, recovers at rest (faster overnight)
  needs.energy +=
    restH * TUNING.energyRestPerHour * (signals.isNight ? 1.5 : 1) -
    activeH * TUNING.energyBurnPerActiveHour;

  // fullness: metabolism, with a self-foraging floor
  needs.fullness -= elapsedH * TUNING.fullnessBurnPerHour;

  // spirits: drift toward baseline, then the day's events move it
  const drift = clamp(elapsedH * TUNING.spiritsDriftPerHour, 0, Math.abs(needs.spirits - TUNING.spiritsBaseline));
  needs.spirits += needs.spirits < TUNING.spiritsBaseline ? drift : -drift;
  needs.spirits += Math.min(signals.streakDays ?? 0, 10) * 0.4;
  needs.spirits += Math.min(signals.agentFinished ?? 0, 5) * 2;
  needs.spirits -= Math.min(signals.agentFailed ?? 0, 5) * 3;

  needs.energy = clamp(needs.energy, TUNING.energyFloor);
  needs.fullness = clamp(needs.fullness, TUNING.fullnessFloor);
  needs.spirits = clamp(needs.spirits);

  // affinity: shared minutes accumulate per surface
  const affinity = { ...soul.affinity };
  for (const [surface, mins] of Object.entries(signals.surfaceMinutes ?? {})) {
    if (surface in affinity && typeof mins === "number" && mins > 0) {
      affinity[surface as PetSurface] += mins;
    }
  }

  // bond: shared active time counts (care handled in applyCare)
  const bond = clamp(soul.bond + activeH * TUNING.bondPerSharedHour);

  const totals = { ...soul.totals };
  totals.celebrations += Math.max(0, signals.agentFinished ?? 0);
  totals.startles += Math.max(0, signals.agentFailed ?? 0);

  return { ...soul, needs, affinity, bond, totals, lastTick: now };
}

/** Direct care. Inside the cooldown window the effect shrinks to
 *  `cooldownYield` — rhythm beats spam. Bond care-gains cap per day. */
export function applyCare(soul: PetSoul, care: PetCare): PetSoul {
  const needs = { ...soul.needs };
  const last = { ...soul.last };
  const totals = { ...soul.totals };
  const cooldownMin =
    care.kind === "feed"
      ? TUNING.feedCooldownMin
      : care.kind === "play"
        ? TUNING.playCooldownMin
        : TUNING.petCooldownMin;
  const anchor =
    care.kind === "feed" ? last.fedAt : care.kind === "play" ? last.playedAt : last.pettedAt;
  const fresh = care.now - anchor >= cooldownMin * 60_000;
  const yieldFactor = fresh ? 1 : TUNING.cooldownYield;

  if (care.kind === "feed") {
    needs.fullness = clamp(needs.fullness + TUNING.feedAmount * yieldFactor);
    last.fedAt = care.now;
    totals.fed += 1;
  } else if (care.kind === "play") {
    needs.spirits = clamp(needs.spirits + TUNING.playSpirits * yieldFactor);
    needs.energy = clamp(needs.energy - TUNING.playEnergyCost, TUNING.energyFloor);
    last.playedAt = care.now;
    totals.played += 1;
  } else {
    needs.spirits = clamp(needs.spirits + TUNING.petSpirits * yieldFactor);
    last.pettedAt = care.now;
    totals.petted += 1;
  }

  // care bond, capped per day: derive today's care count from anchors
  const bondGain = fresh ? TUNING.bondPerCare : TUNING.bondPerCare * TUNING.cooldownYield;
  const bond = clamp(soul.bond + Math.min(bondGain, TUNING.bondDailyCareCap));

  return { ...soul, needs, last, totals, bond };
}

// ── derived ──────────────────────────────────────────────────────────────────

export function moodOf(soul: PetSoul, ctx: { isNight?: boolean } = {}): PetMood {
  const { energy, fullness, spirits } = soul.needs;
  if (fullness <= TUNING.fullnessFloor + 2 && energy <= TUNING.energyFloor + 5) return "sick";
  if (energy < 25 || (ctx.isNight && energy < 55)) return "sleepy";
  if (fullness < 30) return "hungry";
  if (spirits < 28) return "grumpy";
  if (spirits > 85 && energy > 60 && fullness > 50) return "ecstatic";
  if (spirits > 65) return "happy";
  return "content";
}

export function stageOf(soul: PetSoul, now: number): PetStage {
  const ageDays = (now - soul.bornAt) / DAY;
  const meets = (gate: [number, number]) => ageDays >= gate[0] && soul.bond >= gate[1];
  if (meets(TUNING.stages.elder)) return "elder";
  if (meets(TUNING.stages.adept)) return "adept";
  if (meets(TUNING.stages.sprout)) return "sprout";
  return "hatchling";
}

/** Dominant surface once the pet is adept+ — the evolution's flavor. */
export function flavorOf(soul: PetSoul, now: number): PetSurface | null {
  const stage = stageOf(soul, now);
  if (stage === "hatchling" || stage === "sprout") return null;
  const entries = Object.entries(soul.affinity) as [PetSurface, number][];
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total <= 0) return null;
  const [best, minutes] = entries.reduce((a, b) => (b[1] > a[1] ? b : a));
  return minutes / total >= TUNING.flavorShare ? best : null;
}

/** What the body should be doing right now — the rig's steering input.
 *  Event reactions (celebrate/startled) are transient: the surfaces play them
 *  from live events; this is the steady-state fallback. Two hard rules from
 *  the owner's live test: night is BEDTIME regardless of energy (night rest
 *  recharges it, so an energy gate never fired — it partied till morning),
 *  and celebrate is never a steady state (an infinite celebration loop reads
 *  as a stuck animation) — joy shows as energetic wandering instead. */
export function suggestActivity(
  soul: PetSoul,
  ctx: { isNight?: boolean } = {},
): PetActivityState {
  const mood = moodOf(soul, ctx);
  if (mood === "sick" || mood === "sleepy") return "sleep";
  if (ctx.isNight) return "sleep";
  if (mood === "hungry") return "idle"; // begging near the dock, not roaming
  if (mood === "grumpy") return "idle";
  return soul.needs.energy > 45 ? "wander" : "idle";
}

// ── persistence guards (storage lives in store.ts) ───────────────────────────

/** Corruption-tolerant revival of a persisted soul. Null = start fresh. */
export function parseSoul(raw: unknown): PetSoul | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<PetSoul>;
  if (s.version !== 1 || typeof s.bornAt !== "number" || !s.needs) return null;
  const n = s.needs as Partial<PetNeeds>;
  const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
  const surfaces: PetSurface[] = ["terminal", "chat", "browser", "files", "notes"];
  const affinity = Object.fromEntries(
    surfaces.map((k) => [k, Math.max(0, num((s.affinity as Record<string, unknown> | undefined)?.[k], 0))]),
  ) as Record<PetSurface, number>;
  return {
    version: 1,
    bornAt: s.bornAt,
    needs: {
      energy: clamp(num(n.energy, 70)),
      fullness: clamp(num(n.fullness, 60)),
      spirits: clamp(num(n.spirits, 60)),
    },
    bond: clamp(num(s.bond, 0)),
    affinity,
    lastTick: num(s.lastTick, s.bornAt),
    last: {
      fedAt: num(s.last?.fedAt, 0),
      playedAt: num(s.last?.playedAt, 0),
      pettedAt: num(s.last?.pettedAt, 0),
    },
    totals: {
      fed: Math.max(0, num(s.totals?.fed, 0)),
      played: Math.max(0, num(s.totals?.played, 0)),
      petted: Math.max(0, num(s.totals?.petted, 0)),
      celebrations: Math.max(0, num(s.totals?.celebrations, 0)),
      startles: Math.max(0, num(s.totals?.startles, 0)),
    },
  };
}
