/**
 * Pure helpers for the conversation time scrubber (P6) — the minimap rail's
 * marker styling, nearest-tick lookup (for drag/hover), day boundaries, and the
 * clock label for the hover/drag bubble. Kept pure + testable; the rail geometry
 * (offsetTop → frac) + DOM scrolling stay in ChatPane.
 *
 * `at` is a unix-MS timestamp (a turn's `createdAt`, populated from the store's
 * `_ts`), or null when unknown (older rows recorded before stamping).
 */

export interface MarkerStyle {
  /** CSS color var for the tick. */
  color: string;
  /** major markers (user/compaction/changes/errors) are taller + fuller. */
  major: boolean;
}

/** One source of truth for a minimap tick's look, by render-block kind + error. */
export function markerStyle(kind: string, err: boolean): MarkerStyle {
  if (err) return { color: "var(--color-danger)", major: true };
  switch (kind) {
    case "user":
      return { color: "var(--color-accent)", major: true };
    case "compaction":
      return { color: "var(--color-info)", major: true };
    case "change":
      return { color: "var(--color-success)", major: true };
    case "approval":
    case "ask":
      return { color: "var(--color-warning)", major: true };
    case "assistant":
      return { color: "var(--color-text-2)", major: false };
    default:
      return { color: "var(--color-border-strong)", major: false };
  }
}

/** The tick whose scroll fraction is closest to `frac` (for the drag bubble). */
export function nearestTick<T extends { frac: number }>(
  ticks: T[],
  frac: number,
): T | null {
  let best: T | null = null;
  let bestDist = Infinity;
  for (const t of ticks) {
    const d = Math.abs(t.frac - frac);
    if (d < bestDist) {
      bestDist = d;
      best = t;
    }
  }
  return best;
}

/** Indices of ticks that begin a new calendar day — for day markers on the rail.
 *  Ticks without a time are skipped (they don't anchor a day). */
export function dayBoundaries(ticks: Array<{ at: number | null }>): number[] {
  const out: number[] = [];
  let prevDay: string | null = null;
  ticks.forEach((t, i) => {
    if (t.at == null) return;
    const day = new Date(t.at).toDateString();
    if (prevDay !== null && day !== prevDay) out.push(i);
    prevDay = day;
  });
  return out;
}

/** Compact clock label for the hover/drag bubble: "3:42 PM" today, "Jun 16,
 *  3:42 PM" otherwise. Empty for an unknown time. */
export function fmtTickTime(at: number | null, nowMs: number = Date.now()): string {
  if (at == null) return "";
  const d = new Date(at);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === new Date(nowMs).toDateString()) return time;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${date}, ${time}`;
}
