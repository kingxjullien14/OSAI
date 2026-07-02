/**
 * Pure session-usage aggregation for the ChatPane session HUD (Tier 3 — chat
 * power). Folds the turn array into a compact per-SESSION readout: messages,
 * cumulative tokens, and age — deliberately **without dollars** (the owner runs
 * on subscriptions, where $ figures are noise; the meter that matters is
 * messages + tokens + how long you've been at it).
 *
 * Pure + unit-tested so the math is solid independent of the live chat. The
 * per-turn token sparkline + the live "ctx" indicator already exist in ChatPane;
 * this is their session-level companion.
 */
import type { ChatTurn } from "./chatStream.ts";

export interface SessionUsage {
  /** user turns sent this session. */
  messages: number;
  /** result turns that produced a reply (non-empty footer/text). */
  responses: number;
  /** Σ of per-turn token counts (input+output+cache, as the result turns carry
   *  them) — a cumulative "processed this session" meter, not output-only. */
  tokens: number;
  /** the most recent result turn's tokens (≈ current context footprint). */
  lastTokens: number;
  /** earliest turn timestamp (unix ms), or null if no turn carried one. */
  startedAt: number | null;
}

/** Aggregate a transcript into its session usage. O(n), allocation-free. */
export function sessionUsage(turns: ChatTurn[]): SessionUsage {
  let messages = 0;
  let responses = 0;
  let tokens = 0;
  let lastTokens = 0;
  let startedAt: number | null = null;
  for (const t of turns) {
    if (t.kind === "user") messages += 1;
    if (
      (t.kind === "user" || t.kind === "assistant") &&
      typeof t.createdAt === "number" &&
      t.createdAt > 0
    ) {
      startedAt = startedAt == null ? t.createdAt : Math.min(startedAt, t.createdAt);
    }
    if (t.kind === "result") {
      if (typeof t.tokens === "number" && t.tokens > 0) {
        tokens += t.tokens;
        lastTokens = t.tokens;
      }
      if (typeof t.text === "string" && t.text.trim()) responses += 1;
    }
  }
  return { messages, responses, tokens, lastTokens, startedAt };
}

/** Compact token count: 980 → "980", 12_300 → "12.3K", 125_000 → "125K",
 *  4_500_000 → "4.5M". One decimal below 100 of each unit, whole above. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) {
    const k = n / 1000;
    return `${k < 100 ? k.toFixed(1) : Math.round(k)}K`;
  }
  const m = n / 1_000_000;
  return `${m < 100 ? m.toFixed(1) : Math.round(m)}M`;
}

/** Compact age from `startedAt` to `now`: "just now" / "5m" / "1h 20m" / "2d 4h".
 *  Returns "" when there's no start, or the clock is behind the start. */
export function formatAge(startedAt: number | null, now: number): string {
  if (startedAt == null || now < startedAt) return "";
  const sec = Math.floor((now - startedAt) / 1000);
  const min = Math.floor(sec / 60);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return remMin > 0 ? `${hr}h ${remMin}m` : `${hr}h`;
  const day = Math.floor(hr / 24);
  const remHr = hr % 24;
  return remHr > 0 ? `${day}d ${remHr}h` : `${day}d`;
}
