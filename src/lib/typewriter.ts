/**
 * Smooth "typewriter" reveal for streamed chat text.
 *
 * The problem: models (and the network) deliver tokens in BURSTS — a whole
 * sentence lands at once, then a pause, then another. Rendering each burst
 * immediately reads as "spawn… pause… spawn", which feels laggy. Instead the
 * visible text is a PREFIX of the received text, and each animation frame reveals
 * a few more characters so the writing flows like typing.
 *
 * The reveal rate scales with the BACKLOG (chars received but not yet shown): a
 * big burst drains fast (so the reveal never falls behind the model), a trickle
 * types gently. That coupling is what produces the organic "fast here, slower
 * there" cadence on its own; a little per-frame jitter + a beat at sentence ends
 * (applied by the caller) finish the feel.
 *
 * Pure + framework-free so the rate curve is unit-testable; the React glue
 * (rAF loop, reduce-motion, punctuation dwell) lives in the useTypewriter hook.
 */
export const TYPEWRITER = {
  /** slowest reveal (chars/sec) — a gentle trickle when nearly caught up. */
  minCps: 45,
  /** fastest reveal (chars/sec) — drains a burst without a visible dump. */
  maxCps: 1400,
  /** while streaming, aim to clear the current backlog in ~this many seconds. */
  drainStreamingSec: 0.45,
  /** once the stream has ENDED, flush the remainder much faster. */
  drainFlushSec: 0.12,
  /** if a turn first renders with MORE chars than this (a reattach/replay
   *  buffer), show them at once and only type the live continuation. */
  instantOnMount: 220,
} as const;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Chars/sec to reveal given the current backlog and whether tokens still arrive.
 *  Scales with backlog (drain it over a fixed window) and clamps to [min, max]. */
export function revealCps(backlog: number, streaming: boolean): number {
  const drain = streaming ? TYPEWRITER.drainStreamingSec : TYPEWRITER.drainFlushSec;
  return clamp(backlog / drain, TYPEWRITER.minCps, TYPEWRITER.maxCps);
}

/**
 * How many characters to reveal THIS frame.
 *
 * `jitter` is a 0..1 value (e.g. `Math.random()`) that adds ±20% organic variance
 * around the rate; pass 0.5 for the neutral (deterministic) step. The result is
 * always ≥ 1 while there's a backlog (so it can't stall) and never overshoots it.
 */
export function revealStep(
  backlog: number,
  dtSec: number,
  streaming: boolean,
  jitter: number = 0.5,
): number {
  if (backlog <= 0) return 0;
  const cps = revealCps(backlog, streaming);
  const factor = 0.8 + clamp(jitter, 0, 1) * 0.4; // 0.8 .. 1.2
  const chars = cps * Math.max(0, dtSec) * factor;
  return clamp(Math.round(chars), 1, backlog);
}
