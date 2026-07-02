// Response branching — the data model behind the chat's ‹N/M› response switcher.
//
// When you regenerate the last turn, the chat appends a fresh response with NO new
// user message in between (regenerate uses skipUserBubble). So a "variant" is one
// run of non-user turns following a user turn, delimited by `result` turns: the
// runs that share a preceding user turn are alternates of the same prompt.
//
// This is DISPLAY-LEVEL branching: it lets the UI show one answer at a time with a
// switcher instead of stacking re-rolls. It is derived purely from the turn order,
// so it reconstructs for free on reload (the durable store replays the same runs) —
// no extra persistence. The model's own context still contains every variant (they
// were all generated in one session); switching only changes what YOU see.

/** Minimal turn shape — only `kind` and `id` matter for segmentation. */
export interface BranchTurnLike {
  kind: string;
  id: string;
}

export interface VariantInfo {
  /** non-user turn id → the user turn it answers + its variant index. */
  byTurnId: Map<string, { userId: string; variant: number }>;
  /** user turn id → how many response variants it has (1 = no switcher). */
  countByUser: Map<string, number>;
}

/** Turns before any user message (system init etc.) bucket under this key. */
export const ROOT_USER = "__root__";

/**
 * Segment a transcript into response variants. Walks turns in order: each `user`
 * turn opens a new prompt; the non-user turns after it form variant 0; once a
 * `result` closes that run, the next non-user turn opens variant 1, and so on.
 * Pure + allocation-light; safe to call on every render (memoize on `turns`).
 */
export function computeResponseVariants(turns: BranchTurnLike[]): VariantInfo {
  const byTurnId = new Map<string, { userId: string; variant: number }>();
  const countByUser = new Map<string, number>();
  let userId = ROOT_USER;
  let variant = 0;
  let sawResult = false;
  for (const t of turns) {
    if (t.kind === "user") {
      userId = t.id;
      variant = 0;
      sawResult = false;
      continue;
    }
    // a non-user turn arriving after a completed run begins the next variant —
    // but ONLY under a real user prompt. Turns bucketed under ROOT (a transcript
    // whose leading user turns are missing, e.g. a replay truncated by the
    // buffer cap) are sequential context, never alternates: variant-ifying them
    // hid the whole conversation behind a phantom ‹N/M› switcher.
    if (sawResult) {
      if (userId !== ROOT_USER) variant += 1;
      sawResult = false;
    }
    byTurnId.set(t.id, { userId, variant });
    if (variant + 1 > (countByUser.get(userId) ?? 0)) {
      countByUser.set(userId, variant + 1);
    }
    if (t.kind === "result") sawResult = true;
  }
  return { byTurnId, countByUser };
}

/**
 * The active variant index for a user turn. Unset → the LATEST (count-1), so a
 * fresh regenerate is shown by default; an explicit pick is clamped into range
 * (a count that shrank/grew underneath a stale selection can't point out of bounds).
 */
export function activeVariantIndex(
  active: Record<string, number>,
  userId: string,
  count: number,
): number {
  if (count <= 0) return 0;
  const chosen = active[userId];
  if (chosen == null) return count - 1;
  return Math.max(0, Math.min(count - 1, chosen));
}

/**
 * The set of turn ids that should be HIDDEN — every turn belonging to a
 * non-active variant of a multi-variant prompt. Turns of single-variant prompts
 * (the common case) are never hidden.
 */
export function hiddenVariantTurnIds(
  info: VariantInfo,
  active: Record<string, number>,
): Set<string> {
  const hidden = new Set<string>();
  for (const [turnId, { userId, variant }] of info.byTurnId) {
    const count = info.countByUser.get(userId) ?? 1;
    if (count <= 1) continue;
    if (variant !== activeVariantIndex(active, userId, count)) hidden.add(turnId);
  }
  return hidden;
}
