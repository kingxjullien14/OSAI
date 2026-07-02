/**
 * Pure helpers for the History pane + management (P5). Date bucketing for the
 * browse list, and the selection math for "clean up older than N months
 * (keeping starred)" + trash retention. Kept pure so they're unit-testable
 * without the Tauri backend.
 *
 * All timestamps from the backend are unix SECONDS (mtime / deleted_at); `nowMs`
 * is JS `Date.now()` milliseconds.
 */

export type DateGroup = "today" | "yesterday" | "this week" | "this month" | "older";

export const DATE_GROUP_ORDER: DateGroup[] = [
  "today",
  "yesterday",
  "this week",
  "this month",
  "older",
];

const DAY_MS = 86_400_000;

/** Bucket a unix-SECONDS timestamp into a coarse date group relative to now. */
export function dateGroup(mtimeSec: number, nowMs: number): DateGroup {
  const now = new Date(nowMs);
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime();
  const t = mtimeSec * 1000;
  if (t >= startOfToday) return "today";
  if (t >= startOfToday - DAY_MS) return "yesterday";
  if (t >= startOfToday - 7 * DAY_MS) return "this week";
  if (t >= startOfToday - 30 * DAY_MS) return "this month";
  return "older";
}

/** Group entries (mtime in unix SECONDS) by date bucket, preserving input order
 *  within each group. Returns groups in chronological order; empties dropped. */
export function groupByDate<T extends { mtime: number }>(
  entries: T[],
  nowMs: number,
): Array<{ group: DateGroup; entries: T[] }> {
  const buckets = new Map<DateGroup, T[]>();
  for (const e of entries) {
    const g = dateGroup(e.mtime, nowMs);
    const arr = buckets.get(g);
    if (arr) arr.push(e);
    else buckets.set(g, [e]);
  }
  return DATE_GROUP_ORDER.filter((g) => buckets.has(g)).map((g) => ({
    group: g,
    entries: buckets.get(g)!,
  }));
}

/** The unix-SECONDS cutoff for "older than N months"; entries with
 *  `mtime < cutoff` are older. */
export function monthsAgoCutoff(nowMs: number, months: number): number {
  const d = new Date(nowMs);
  d.setMonth(d.getMonth() - months);
  return Math.floor(d.getTime() / 1000);
}

/** Ids to delete in a "clean up older than <cutoff>" sweep. With `keepStarred`,
 *  starred entries are spared even when old (the D5 "exclude starred" option). */
export function selectForCleanup<
  T extends { id: string; mtime: number; starred?: boolean },
>(entries: T[], cutoffSec: number, keepStarred: boolean): string[] {
  return entries
    .filter((e) => e.mtime < cutoffSec && !(keepStarred && e.starred))
    .map((e) => e.id);
}

/** Trash records past the retention window (`deletedAt` in unix SECONDS). */
export function expiredTrash<T extends { id: string; deletedAt: number }>(
  records: T[],
  nowMs: number,
  retentionDays: number,
): string[] {
  const cutoff = Math.floor(nowMs / 1000) - retentionDays * 86_400;
  return records.filter((r) => r.deletedAt < cutoff).map((r) => r.id);
}
