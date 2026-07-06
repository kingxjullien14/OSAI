/** Shared chat formatting helpers — first slice of the ChatPane split
 *  (PLAN-odysseus-feel.md, W4). Pure functions only. */

/** Format a duration in ms as a compact human label: "2m 38s", "47s", "0.4s".
 *  (Moved verbatim from ChatPane so both keep one behavior.) */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}m ${s}s`;
}

/** Rough token estimate for streaming text (chars/4 — the usual heuristic). */
export function estTokens(text: string): number {
  return Math.max(1, Math.round(text.length / 4));
}

/** Format an elapsed-while-running timer as m:ss (Codex "Working… 0:42"). */
export function fmtClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/** basename for a path, for the @-mention picker labels. */
export function baseName(p: string): string {
  const clean = p.replace(/[\\/]+$/, "");
  return clean.split(/[\\/]/).filter(Boolean).pop() ?? p;
}

/** Truncate the middle of a string so both ends stay visible. */
export function ellipsizeMid(s: string, max = 52): string {
  if (s.length <= max) return s;
  const half = Math.floor((max - 1) / 2);
  return s.slice(0, half) + "…" + s.slice(s.length - half);
}
