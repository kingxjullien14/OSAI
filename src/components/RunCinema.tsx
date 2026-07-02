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
import {
  Check,
  ChevronRight,
  Clapperboard,
  Pause,
  Play,
  RotateCcw,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";

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

  // key beats only (actions / permission / terminal) → color-coded tick markers
  // on the scrubber, a navigable map of the run (reasoning + deltas are too dense
  // to mark — they'd be confetti).
  const ticks = useMemo(() => {
    if (events.length < 2) return [];
    const out: { frac: number; color: string }[] = [];
    events.forEach((ev, i) => {
      const color =
        ev.type === "action.started"
          ? "var(--color-accent)"
          : ev.type === "permission.requested"
            ? "var(--color-highlight)"
            : ev.type === "run.completed"
              ? "var(--color-success)"
              : ev.type === "run.failed" || ev.type === "run.interrupted"
                ? "var(--color-danger)"
                : "";
      if (color) out.push({ frac: i / events.length, color });
    });
    return out;
  }, [events]);

  // manual stepping pauses the auto-play so the two never fight over the cursor.
  const step = (delta: number) => {
    setPlaying(false);
    setCursor((c) => Math.min(Math.max(c + delta, 0), events.length));
  };
  const pct = events.length ? (cursor / events.length) * 100 : 0;
  const ended = cursor >= events.length;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="run cinema — replay this run"
      className="overlay-backdrop absolute inset-0 z-40 flex flex-col bg-[var(--color-bg)]/90 backdrop-blur-2xl"
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
        if (e.key === "ArrowRight") {
          e.preventDefault();
          step(1);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          step(-1);
          return;
        }
        if (e.key === "Home") {
          e.preventDefault();
          setPlaying(false);
          setCursor(0);
          return;
        }
        if (e.key === "End") {
          e.preventDefault();
          setPlaying(false);
          setCursor(events.length);
          return;
        }
        trapTab(e, e.currentTarget);
      }}
      tabIndex={-1}
    >
      {/* header — what you're watching + its true cost (frosted, lit edge) */}
      <div className="relative flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel)_55%,transparent)] px-4 py-2.5 backdrop-blur-md">
        <span className="grid h-7 w-7 place-items-center rounded-lg border border-[color-mix(in_srgb,var(--color-accent)_34%,transparent)] bg-[color-mix(in_srgb,var(--color-accent)_14%,transparent)] text-[var(--color-accent)] shadow-[var(--aios-glow-soft)]">
          <Clapperboard size={14} />
        </span>
        <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-[var(--color-text-2)]">
          run cinema
        </span>
        <div className="flex items-center gap-1.5 font-mono text-[10px] tabular-nums text-[var(--color-faint)]">
          <span className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5">{events.length} events</span>
          <span className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5">{fmtClock(totalMs)}</span>
          {lastCompleted?.tokens ? (
            <span className="rounded-md border border-[var(--color-border)] px-1.5 py-0.5">
              {lastCompleted.tokens.toLocaleString()} tok
            </span>
          ) : null}
        </div>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="close (esc)"
          className="grid h-6 w-6 place-items-center rounded-md text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
        >
          <X size={13} />
        </button>
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--color-accent)_45%,transparent),transparent)]"
        />
      </div>

      {/* the replayed timeline — a glowing spine threads the beats */}
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="relative mx-auto flex max-w-[42rem] flex-col gap-2 pl-5">
          {/* the spine */}
          <div
            aria-hidden
            className="pointer-events-none absolute bottom-0 left-[6px] top-1 w-px bg-[linear-gradient(180deg,transparent,color-mix(in_srgb,var(--color-accent)_30%,transparent),transparent)]"
          />
          {rows.map((r) =>
            r.kind === "reasoning" ? (
              <div key={r.key} className="relative border-l-2 border-[color-mix(in_srgb,var(--color-accent)_28%,transparent)] pl-3 font-sans text-[12px] italic leading-relaxed text-[var(--color-muted)]">
                {r.text}
              </div>
            ) : r.kind === "reply" ? (
              <div key={r.key} className="relative whitespace-pre-wrap font-sans text-[13px] leading-relaxed text-[var(--color-text)]">
                {r.text}
              </div>
            ) : r.kind === "action" ? (
              <div key={r.key} className="surface-card fade-in-up relative flex items-baseline gap-2 rounded-xl px-2.5 py-1.5 backdrop-blur">
                <span aria-hidden className="absolute -left-[18px] top-[9px] h-1.5 w-1.5 rounded-full bg-[var(--color-accent)] shadow-[var(--aios-glow-soft)]" />
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
              <div key={r.key} className="fade-in-up relative rounded-xl border border-[color-mix(in_srgb,var(--color-accent)_35%,transparent)] bg-[var(--color-accent-soft)] px-2.5 py-1.5 font-sans text-[11.5px] text-[var(--color-text)] shadow-[var(--aios-glow-soft)] backdrop-blur">
                <span aria-hidden className="absolute -left-[18px] top-[9px] h-1.5 w-1.5 rounded-full bg-[var(--color-highlight)] shadow-[0_0_7px_var(--color-highlight)]" />
                asked to run <span className="font-mono">{r.toolName}</span>
              </div>
            ) : r.kind === "completed" ? (
              <div key={r.key} className="relative my-2 flex items-center gap-3">
                <span className="h-px flex-1 bg-[var(--color-border)]" />
                <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-[var(--color-success)]">
                  <Check size={11} /> run completed{r.durationMs ? ` · ${fmtClock(r.durationMs)}` : ""}
                  {r.tokens ? ` · ${r.tokens.toLocaleString()} tok` : ""}
                </span>
                <span className="h-px flex-1 bg-[var(--color-border)]" />
              </div>
            ) : r.kind === "failed" ? (
              <div key={r.key} className="relative rounded-xl border border-[color-mix(in_srgb,var(--color-danger)_45%,transparent)] bg-[color-mix(in_srgb,var(--color-danger)_10%,transparent)] px-2.5 py-1.5 font-sans text-[11.5px] text-[var(--color-danger)] backdrop-blur">
                run failed — {r.message}
              </div>
            ) : (
              <div key={r.key} className="my-1 text-center font-mono text-[10.5px] text-[var(--color-faint)]">
                — interrupted —
              </div>
            ),
          )}
          {/* live playhead — a pulsing cursor at the head of the stream while playing */}
          {playing && !ended && (
            <div className="relative flex items-center gap-2 pt-0.5">
              <span aria-hidden className="absolute -left-[20px] h-2 w-2 rounded-full bg-[var(--color-accent)] shadow-[var(--aios-glow-soft)] motion-safe:animate-ping" />
              <span aria-hidden className="absolute -left-[20px] h-2 w-2 rounded-full bg-[var(--color-accent)]" />
              <span className="font-mono text-[10px] tracking-[0.14em] text-[var(--color-faint)]">▌</span>
            </div>
          )}
          {ended && (
            <div className="mt-2 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--color-faint)]">
              end of run
            </div>
          )}
        </div>
      </div>

      {/* transport — restart · step · play · speed · scrubber · clock */}
      <div className="relative flex shrink-0 items-center gap-2.5 border-t border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-panel)_55%,transparent)] px-4 py-2.5 backdrop-blur-md">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_srgb,var(--color-accent)_45%,transparent),transparent)]"
        />
        <button
          type="button"
          onClick={() => { setPlaying(false); setCursor(0); }}
          aria-label="restart (home)"
          title="restart"
          className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
        >
          <RotateCcw size={13} />
        </button>
        <button
          type="button"
          onClick={() => step(-1)}
          aria-label="step back (←)"
          title="step back"
          className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
        >
          <SkipBack size={13} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (ended) setCursor(0);
            setPlaying((p) => !p);
          }}
          aria-label={playing ? "pause (space)" : "play (space)"}
          className="press grid h-8 w-8 place-items-center rounded-full bg-[linear-gradient(135deg,var(--color-accent),color-mix(in_srgb,var(--color-accent)_50%,var(--aios-accent-2)))] text-[var(--color-accent-fg)] shadow-[0_0_18px_-4px_color-mix(in_srgb,var(--color-accent)_70%,transparent)] transition-transform hover:scale-105 active:scale-95"
        >
          {playing ? <Pause size={14} /> : <Play size={14} className="translate-x-[1px]" />}
        </button>
        <button
          type="button"
          onClick={() => step(1)}
          aria-label="step forward (→)"
          title="step forward"
          className="grid h-7 w-7 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:bg-[var(--color-panel-2)] hover:text-[var(--color-text)]"
        >
          <SkipForward size={13} />
        </button>
        <button
          type="button"
          onClick={() => setSpeed((s) => SPEEDS[(SPEEDS.indexOf(s) + 1) % SPEEDS.length])}
          className="pill press font-mono tabular-nums"
          title="playback speed"
        >
          {speed}×
        </button>
        {/* custom scrubber: glowing fill + color-coded event ticks + accent thumb */}
        <div className="relative flex min-w-0 flex-1 items-center">
          <div className="absolute inset-x-0 h-1 rounded-full bg-[var(--color-panel-2)]" />
          <div
            className="absolute left-0 h-1 rounded-full bg-[linear-gradient(90deg,var(--color-accent),var(--aios-accent-2))] shadow-[0_0_10px_-1px_color-mix(in_srgb,var(--color-accent)_70%,transparent)]"
            style={{ width: `${pct}%` }}
          />
          {ticks.map((tk, i) => (
            <span
              key={i}
              aria-hidden
              className="absolute h-2 w-px -translate-x-1/2 rounded-full opacity-70"
              style={{ left: `${tk.frac * 100}%`, background: tk.color }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={events.length}
            value={cursor}
            onChange={(e) => { setPlaying(false); setCursor(Number(e.target.value)); }}
            aria-label="scrub the run"
            className="relative h-3 min-w-0 flex-1 cursor-pointer appearance-none bg-transparent outline-none [&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[var(--color-accent)] [&::-webkit-slider-thumb]:shadow-[0_0_10px_-1px_color-mix(in_srgb,var(--color-accent)_80%,transparent)]"
          />
        </div>
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-[var(--color-faint)]">
          {fmtClock(elapsedMs)} / {fmtClock(totalMs)}
        </span>
      </div>
    </div>
  );
}
