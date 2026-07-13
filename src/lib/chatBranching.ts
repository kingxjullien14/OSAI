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

/** Minimal turn shape for segmentation. `kind`/`id` drive it; `parentId` marks a
 *  sub-agent child turn (excluded); `continuation` marks a result that closes a
 *  background-triggered run (a segment boundary, not a regenerate). */
export interface BranchTurnLike {
  kind: string;
  id: string;
  /** set on tool turns made BY a sub-agent — never counted as a top-level run. */
  parentId?: string;
  /** set on a `result` turn that closes a background/task-notification
   *  continuation — its run stacks as its own segment, not a ‹N/M› alternate. */
  continuation?: boolean;
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
 * Segment a transcript into response variants — the data behind the ‹N/M›
 * switcher. Two passes:
 *
 *  1. Group top-level turns into RUNS. A run is the non-user turns following a
 *     user turn (or a prior run), delimited by a `result`. Sub-agent child turns
 *     (`parentId`) are skipped entirely — a still-streaming sub-agent tool call is
 *     not a top-level response and must not open a phantom variant. Each run notes
 *     whether its closing result was a background CONTINUATION.
 *
 *  2. Bucket the runs. Successive runs under the SAME user prompt are regenerate
 *     alternates → variant 0,1,2… (the switcher). But a CONTINUATION run (a
 *     background agent finished and woke the model) and any ROOT run (turns before
 *     the first user prompt — e.g. a buffer-truncated replay) get their OWN
 *     single-variant bucket, so they always render, stacked, never hidden behind
 *     the previous prompt's switcher.
 *
 * This is what stops parallel/background sub-agents from fragmenting one reply
 * into phantom ‹2/2› alternates that hide each other. Pure; memoize on `turns`.
 */
export function computeResponseVariants(turns: BranchTurnLike[]): VariantInfo {
  const byTurnId = new Map<string, { userId: string; variant: number }>();
  const countByUser = new Map<string, number>();

  interface Run {
    userId: string;
    ids: string[];
    continuation: boolean;
  }
  const runs: Run[] = [];
  let userId = ROOT_USER;
  let cur: Run | null = null;
  for (const t of turns) {
    if (t.parentId) continue; // nested sub-agent work — never a top-level run
    if (t.kind === "user") {
      userId = t.id;
      cur = null; // a user turn closes any open run
      continue;
    }
    if (!cur) {
      cur = { userId, ids: [], continuation: false };
      runs.push(cur);
    }
    cur.ids.push(t.id);
    if (t.kind === "result") {
      if (t.continuation) cur.continuation = true;
      cur = null; // the result closes this run
    }
  }

  for (const run of runs) {
    if (run.continuation || run.userId === ROOT_USER) {
      // Standalone runs — background-agent continuations and any pre-first-user
      // context (truncated replay). They render on their own, stacked, and are
      // NEVER hidden. Bucket them under ROOT_USER at variant 0 so countByUser
      // stays 1 (no ‹N/M› switcher). This is what stops a background sub-agent
      // finishing from spawning a phantom ‹2/2› that hides the prior answer.
      for (const id of run.ids) byTurnId.set(id, { userId: ROOT_USER, variant: 0 });
      if (!countByUser.has(ROOT_USER)) countByUser.set(ROOT_USER, 1);
    } else {
      // Successive runs under the SAME user prompt are regenerate alternates.
      const variant = countByUser.get(run.userId) ?? 0;
      for (const id of run.ids) byTurnId.set(id, { userId: run.userId, variant });
      countByUser.set(run.userId, variant + 1);
    }
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
