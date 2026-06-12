/** Run Cinema — replay a finished agent run as a paced timeline. The data was
 *  always there: runEvents.ts captures every reasoning beat, tool call, and
 *  completion with real timestamps (persisted per session). This overlay walks
 *  those events back at director's pace — long silences are clamped so replays
 *  stay watchable, the scrubber jumps anywhere, and the header carries the
 *  run's true stats. Pure client-side: no backend, no model context.
 *
 *  Pane-scoped (absolute inset-0 inside ChatPane), not a global modal — the
 *  replay belongs to the transcript it narrates. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Clapperboard, Pause, Play, X } from "lucide-react";

import type { RunEvent } from "../lib/runEvents";
import { trapTab } from "./ui";

const SPEEDS = [1, 4, 16] as const;
type Speed = (typeof SPEEDS)[number];

/** Clamp inter-event gaps so dead air skips and bursts stay legible. */
const gapMs = (events: RunEvent[], i: number, speed: Speed): number => {
  if (i <= 0) return 220;
  const raw = (events[i].at ?? 0) - (events[i - 1].at ?? 0);
  return Math.min(Math.max(raw / speed, 36), 1400);
};

const clip = (s: string, max = 360): string =>
  s.length > max ? `${s.slice(0, max)}…` : s;

const fmtClock = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

/** Visible events coalesced for rendering: consecutive message.delta frames
 *  merge into one growing reply block (per-frame rows would be confetti). */
type CinemaRow =
  | { kind: "reasoning"; key: string; text: string }
  | { kind: "reply"; key: string; text: string }
  | { kind: "action"; key: string; name: string; input: string }
  | { kind: "done"; key: string; output: string; isError: boolean }
  | { kind: "permission"; key: string; toolName: string }
  | { kind: "completed"; key: string; durationMs?: number; tokens?: number }
  | { kind: "failed"; key: string; message: string }
  | { kind: "interrupted"; key: string };

function toRows(events: RunEvent[], upTo: number): CinemaRow[] {
  const rows: CinemaRow[] = [];
  for (let i = 0; i < upTo && i < events.length; i++) {
    const ev = events[i];
    switch (ev.type) {
      case "reasoning": {
        const last = rows[rows.length - 1];
        if (last?.kind === "reasoning" && ev.streaming) last.text = clip(ev.text, 600);
        else rows.push({ kind: "reasoning", key: `r${i}`, text: clip(ev.text, 600) });
        break;
      }
      case "message.delta": {
        const last = rows[rows.length - 1];
        if (last?.kind === "reply") last.text = clip(last.text + ev.text, 900);
        else rows.push({ kind: "reply", key: `m${i}`, text: clip(ev.text, 900) });
        break;
      }
      case "action.started":
        rows.push({
          kind: "action",
          key: `a${i}`,
          name: ev.name,
          input: clip(JSON.stringify(ev.input ?? {}), 220),
        });
        break;
      case "action.completed":
        rows.push({
          kind: "done",
          key: `d${i}`,
          output: clip(ev.output, 280),
          isError: Boolean(ev.isError),
        });
        break;
      case "permission.requested":
        rows.push({ kind: "permission", key: `p${i}`, toolName: ev.toolName });
        break;
      case "run.completed":
        rows.push({ kind: "completed", key: `c${i}`, durationMs: ev.durationMs, tokens: ev.tokens });
        break;
      case "run.failed":
        rows.push({ kind: "failed", key: `f${i}`, message: clip(ev.message, 280) });
        break;
      case "run.interrupted":
        rows.push({ kind: "interrupted", key: `x${i}` });
        break;
    }
  }
  return rows;
}

export function RunCinema({
  events,
  startIndex = 0,
  onClose,
}: {
  events: RunEvent[];
  startIndex?: number;
  onClose: () => void;
}) {
  const [cursor, setCursor] = useState(() => Math.min(Math.max(startIndex, 0), events.length));
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState<Speed>(4);
  const bodyRef = useRef<HTMLDivElement>(null);

  // pacing loop — one timeout per advance, scaled by the REAL gaps.
  useEffect(() => {
    if (!playing) return;
    if (cursor >= events.length) {
      setPlaying(false);
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(
      () => setCursor((c) => Math.min(c + 1, events.length)),
      reduce ? 36 : gapMs(events, cursor, speed),
    );
    return () => window.clearTimeout(t);
  }, [playing, cursor, speed, events]);

  // follow the playhead
  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cursor]);

  const rows = useMemo(() => toRows(events, cursor), [events, cursor]);
  const totalMs = events.length > 1 ? (events[events.length - 1].at ?? 0) - (events[0].at ?? 0) : 0;
  const elapsedMs = cursor > 0 ? (events[cursor - 1].at ?? 0) - (events[0].at ?? 0) : 0;
  const lastCompleted = useMemo(() => {
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.type === "run.completed") return ev;
    }
    return null;
  }, [events]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="run cinema — replay this run"
      className="overlay-backdrop absolute inset-0 z-40 flex flex-col bg-[var(--color-bg)]/92 backdrop-blur-sm"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          onClose();
          return;
        }
        if (e.key === " ") {
          e.preventDefault();
          setPlaying((p) => !p);
          return;
        }
        trapTab(e, e.currentTarget);
      }}
      tabIndex={-1}
    >
      {/* header — what you're watching + its true cost */}
      <div className="flex shrink-0 items-center gap-2.5 border-b border-[var(--color-border)] px-4 py-2.5">
        <Clapperboard size={14} className="text-[var(--color-muted)]" />
        <span className="text-[13px] font-medium text-[var(--color-text)]">run cinema</span>
        <span className="font-mono text-[10.5px] text-[var(--color-faint)]">
          {events.length} events · {fmtClock(totalMs)}
          {lastCompleted?.tokens ? ` · ${lastCompleted.tokens.toLocaleString()} tok` : ""}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="close (esc)"
          className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
        >
          <X size={13} />
        </button>
      </div>

      {/* the replayed timeline */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <div className="mx-auto flex max-w-[42rem] flex-col gap-2">
          {rows.map((r) =>
            r.kind === "reasoning" ? (
              <div key={r.key} className="border-l border-[var(--color-border)] pl-3 font-sans text-[12px] italic leading-relaxed text-[var(--color-muted)]">
                {r.text}
              </div>
            ) : r.kind === "reply" ? (
              <div key={r.key} className="whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[var(--color-text)]">
                {r.text}
              </div>
            ) : r.kind === "action" ? (
              <div key={r.key} className="fade-in-up flex items-baseline gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)]/60 px-2.5 py-1.5">
                <ChevronRight size={11} className="shrink-0 translate-y-[1px] text-[var(--color-accent)]" />
                <span className="shrink-0 font-mono text-[11.5px] text-[var(--color-text-2)]">{r.name}</span>
                <span className="min-w-0 truncate font-mono text-[10px] text-[var(--color-faint)]">{r.input}</span>
              </div>
            ) : r.kind === "done" ? (
              <div key={r.key} className={`ml-4 flex items-baseline gap-2 font-mono text-[10.5px] ${r.isError ? "text-[var(--color-danger)]" : "text-[var(--color-faint)]"}`}>
                <Check size={10} className="shrink-0 translate-y-[1px]" />
                <span className="min-w-0 truncate">{r.output || "done"}</span>
              </div>
            ) : r.kind === "permission" ? (
              <div key={r.key} className="fade-in-up rounded-lg border border-[var(--color-accent)]/35 bg-[var(--color-accent-soft)] px-2.5 py-1.5 font-sans text-[11.5px] text-[var(--color-text)]">
                asked to run <span className="font-mono">{r.toolName}</span>
              </div>
            ) : r.kind === "completed" ? (
              <div key={r.key} className="my-1 text-center font-mono text-[10.5px] text-[var(--color-faint)]">
                — run completed{r.durationMs ? ` in ${fmtClock(r.durationMs)}` : ""}
                {r.tokens ? ` · ${r.tokens.toLocaleString()} tok` : ""} —
              </div>
            ) : r.kind === "failed" ? (
              <div key={r.key} className="rounded-lg border border-[var(--color-danger)]/35 px-2.5 py-1.5 font-sans text-[11.5px] text-[var(--color-danger)]">
                run failed — {r.message}
              </div>
            ) : (
              <div key={r.key} className="my-1 text-center font-mono text-[10.5px] text-[var(--color-faint)]">
                — interrupted —
              </div>
            ),
          )}
          {cursor >= events.length && (
            <div className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-faint)]">
              end of run
            </div>
          )}
        </div>
      </div>

      {/* transport — play/pause · speed · scrubber · clock */}
      <div className="flex shrink-0 items-center gap-3 border-t border-[var(--color-border)] px-4 py-2.5">
        <button
          type="button"
          onClick={() => {
            if (cursor >= events.length) setCursor(0);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? "pause (space)" : "play (space)"}
          className="grid h-7 w-7 place-items-center rounded-full bg-[var(--color-accent)] text-[var(--color-accent-fg)] transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? <Pause size={13} /> : <Play size={13} className="translate-x-[1px]" />}
        </button>
        <button
          type="button"
          onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
          className="pill press font-mono tabular-nums"
          title="playback speed"
        >
          {speed}×
        </button>
        <input
          type="range"
          min={0}
          max={events.length}
          value={cursor}
          onChange={(e) => setCursor(Number(e.target.value))}
          aria-label="scrub the run"
          className="h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-accent)]"
          style={{
            background: `linear-gradient(to right, var(--color-accent) ${
              events.length ? (cursor / events.length) * 100 : 0
            }%, var(--color-panel-2) ${events.length ? (cursor / events.length) * 100 : 0}%)`,
          }}
        />
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-[var(--color-faint)]">
          {fmtClock(elapsedMs)} / {fmtClock(totalMs)}
        </span>
      </div>
    </div>
  );
}
