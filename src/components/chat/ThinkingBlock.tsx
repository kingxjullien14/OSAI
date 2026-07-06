/** ThinkingBlock — the Odysseus-style thinking card (PLAN-odysseus-feel.md,
 *  W4): a framed, collapsible card with LIVE stats in the header (elapsed
 *  while streaming, final duration after) plus a rough token count, and the
 *  thought text in a scroll-capped inner well. Extracted from ChatPane as the
 *  first slice of its component split.
 */
import { useEffect, useRef, useState } from "react";
import { Brain, ChevronDown } from "lucide-react";

import type { ChatTurn } from "../../lib/chatStream";
import { estTokens, fmtDuration } from "./format";

/** Word-cadence shimmer for live labels ("thinking", "streaming"). Also used
 *  by ChatPane's activity headers — exported with the block it decorates. */
export function CadencedShimmer({ children }: { children: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let removeTimer: number | undefined;
    const run = () => {
      setActive(false);
      window.requestAnimationFrame(() => {
        setActive(true);
        removeTimer = window.setTimeout(() => setActive(false), 1000);
      });
    };
    const startTimer = window.setTimeout(run, 600);
    const iv = window.setInterval(run, 2600);
    return () => {
      window.clearTimeout(startTimer);
      window.clearInterval(iv);
      if (removeTimer != null) window.clearTimeout(removeTimer);
    };
  }, []);

  return (
    <span ref={ref} className={active ? "aios-shimmer" : undefined}>
      {children}
    </span>
  );
}

export function ThinkingBlock({
  turn,
  forceOpen = false,
}: {
  turn: Extract<ChatTurn, { kind: "thinking" }>;
  /** find-in-chat: a hit lives in this block — reveal it regardless of toggle. */
  forceOpen?: boolean;
}) {
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const open = forceOpen || (userToggled ?? turn.streaming);
  // live elapsed while the thought streams (1s tick; final = turn.durationMs).
  const startRef = useRef(Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!turn.streaming) return;
    const iv = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [turn.streaming]);
  const elapsedMs = turn.streaming ? Math.max(0, now - startRef.current) : turn.durationMs;
  const tok = estTokens(turn.text);

  return (
    <div
      className={`overflow-hidden rounded-xl border transition-colors ${
        turn.streaming
          ? "border-[color-mix(in_srgb,var(--color-accent)_28%,transparent)]"
          : "border-[color-mix(in_srgb,var(--color-accent)_14%,transparent)]"
      } bg-[color-mix(in_srgb,var(--color-panel)_45%,transparent)]`}
    >
      <button
        type="button"
        onClick={() => setUserToggled(!open)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-sans text-[12.5px] text-[var(--color-muted)] transition-colors hover:text-[var(--color-text-2)]"
        title={open ? "collapse thinking" : "view thinking process"}
      >
        <Brain
          size={12}
          className={`shrink-0 ${turn.streaming ? "animate-pulse text-[var(--color-accent)]" : "text-[var(--color-faint)]"}`}
        />
        {turn.streaming ? (
          <CadencedShimmer>thinking</CadencedShimmer>
        ) : (
          <span>view thinking process</span>
        )}
        {/* live stats — the Odysseus header signature: duration · ~tokens */}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-[var(--color-faint)] tabular-nums">
          {elapsedMs != null && elapsedMs > 0 ? `${fmtDuration(elapsedMs)} · ` : ""}~{tok} tok
        </span>
        <ChevronDown
          size={12}
          className={`shrink-0 text-[var(--color-faint)] transition-transform ${open ? "" : "-rotate-90"}`}
        />
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto border-t border-[color-mix(in_srgb,var(--color-accent)_10%,transparent)] px-3 py-2 font-sans text-[12.5px] italic leading-relaxed whitespace-pre-wrap break-words text-[var(--color-muted)] [scrollbar-width:thin]">
          {turn.text}
        </div>
      )}
    </div>
  );
}
