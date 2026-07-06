/** The pet's VOICE (P4, living-cockpit) — the decider for when the roaming
 *  spirit may say something, and what the lines are.
 *
 *  A chatty pet is Clippy; the contract is that a bubble stays an EVENT:
 *  - one line per few minutes GLOBALLY (whatever the source),
 *  - long per-kind cooldowns on top,
 *  - hard silence in quiet mode, while asleep, and while being carried.
 *
 *  PURE by the tested-module rule: no Date.now(), no storage, no tauri —
 *  every decision takes `now`; the overlay owns I/O + rendering. */

import type { PetMood } from "./engine";

export type PetVoiceKind = "bus" | "error" | "done" | "usage" | "need";

export interface PetVoiceState {
  /** last time ANY line was shown (global gap anchor). */
  lastAnyAt: number;
  /** last time per kind (cooldown anchors). */
  lastByKind: Partial<Record<PetVoiceKind, number>>;
}

export const VOICE_TUNING = {
  /** global: at most one line per this many minutes, across all kinds. */
  minGapMin: 3,
  /** per-kind cooldowns (minutes). */
  cooldownMin: {
    bus: 5, // lib/pet.ts lines (already source-limited; this is a floor)
    error: 8,
    done: 15,
    usage: 30,
    need: 45,
  } satisfies Record<PetVoiceKind, number>,
} as const;

export interface PetVoiceCtx {
  now: number;
  /** notification quiet mode — the pet respects it like the bell does. */
  quiet?: boolean;
  /** asleep pets don't talk (night hours ride on this via the pose). */
  asleep?: boolean;
  /** mid-grab / mid-toss is not a time to chat. */
  carried?: boolean;
}

export function createVoiceState(): PetVoiceState {
  return { lastAnyAt: 0, lastByKind: {} };
}

/** Gate a line. Returns the updated state when the line may be shown, or
 *  null when suppressed — suppression burns NO anchors, so a line denied by
 *  quiet mode doesn't eat the budget of the next allowed one. */
export function tryVoice(
  state: PetVoiceState,
  kind: PetVoiceKind,
  ctx: PetVoiceCtx,
): PetVoiceState | null {
  if (ctx.quiet || ctx.asleep || ctx.carried) return null;
  if (ctx.now - state.lastAnyAt < VOICE_TUNING.minGapMin * 60_000) return null;
  const last = state.lastByKind[kind] ?? 0;
  if (ctx.now - last < VOICE_TUNING.cooldownMin[kind] * 60_000) return null;
  return { lastAnyAt: ctx.now, lastByKind: { ...state.lastByKind, [kind]: ctx.now } };
}

// ── the lines ────────────────────────────────────────────────────────────────

const trimTitle = (t: string) => (t.length > 34 ? `${t.slice(0, 33)}…` : t);

/** A care nudge — only for moods where care actually helps. Sleepy pets just
 *  go to sleep (nagging about it would be noise), and good moods stay quiet. */
export function needLine(mood: PetMood): string | null {
  switch (mood) {
    case "hungry":
      return "getting hungry over here — got a snack?";
    case "sick":
      return "not feeling great… check on me?";
    case "grumpy":
      return "spirits are low. a quick game?";
    default:
      return null;
  }
}

/** Usage pace line — provider + window + the honest number. */
export function usageLine(
  provider: string,
  window: "5h" | "7d",
  pct: number,
  level: "warning" | "danger",
): string {
  const p = Math.round(pct);
  return level === "danger"
    ? `${provider} ${window} at ${p}% — slow down a little`
    : `${provider} ${window} running hot (${p}%)`;
}

export function agentDoneLine(title?: string): string {
  return title ? `“${trimTitle(title)}” finished ✓` : "a run just finished ✓";
}

export function agentErrorLine(title?: string): string {
  return title ? `“${trimTitle(title)}” hit trouble — look?` : "something failed — want a look?";
}
