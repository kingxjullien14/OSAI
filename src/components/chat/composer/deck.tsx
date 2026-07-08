/** Composer deck chrome — leaf pieces of the redesigned composer
 *  (PLAN-odysseus-feel.md W4, sketch board rev 4, decisions A–D locked).
 *  Pure presentation: the stateful composer logic stays in ChatPane. */
import { ArrowUp, Square, X } from "lucide-react";

/** Engine → dot color, the same code the resume picker speaks:
 *  claude-family = accent, codex/openai = blue, local/ollama = cyan. */
export function engineDotColor(engine: string | undefined): string {
  const e = engine ?? "claude";
  if (e === "codex" || e === "openai") return "var(--color-info)";
  if (e === "local" || e === "ollama") return "var(--osai-accent-2)";
  if (e === "openrouter") return "var(--color-warning)";
  return "var(--color-accent)";
}

const EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"];
const TICK_HEIGHTS = ["4px", "5.5px", "7px", "8.5px", "10px"];

/** Effort as five ascending tick bars inside the model pill (decision B).
 *  Ultra lights every bar with the accent→cyan gradient. */
export function EffortTicks({ effortId, ultra }: { effortId: string; ultra?: boolean }) {
  const filled = ultra ? 5 : Math.max(1, EFFORT_LEVELS.indexOf(effortId) + 1);
  return (
    <span className="flex h-[10px] shrink-0 items-end gap-[2px]" aria-hidden>
      {TICK_HEIGHTS.map((h, i) => (
        <span
          key={i}
          style={{
            height: h,
            background:
              i < filled
                ? ultra
                  ? "linear-gradient(180deg, var(--osai-accent-2), var(--color-accent))"
                  : "var(--color-accent)"
                : "oklch(1 0 0 / 14%)",
          }}
          className="w-[3px] rounded-[1px]"
        />
      ))}
    </span>
  );
}

/** The context filament (decision A): the deck's top edge IS the context
 *  meter. Fills with usage, warms toward the warning color past ~80%, runs a
 *  light-sweep while streaming. A fat invisible strip above it carries the
 *  hover card (the Context Window popover). */
export function Filament({
  pct,
  live,
  card,
  label,
}: {
  /** 0..1 context fill; 0 renders the empty track only. */
  pct: number;
  /** streaming — animate the sheen. */
  live: boolean;
  /** hover card content (the used/total popover); omit for no popover. */
  card?: React.ReactNode;
  /** accessible/hover one-liner. */
  label?: string;
}) {
  const hot = pct > 0.8;
  const filled = pct > 0;
  return (
    // sits 3px INSIDE the deck, clear of the border — fused with the border
    // line it read as a broken/boxy edge (owner-reported). No track when
    // empty: a resting hairline was more border-noise.
    <div className="group/fil absolute inset-x-4 top-[3px] z-10" title={card ? undefined : label}>
      {filled && (
        <div className="h-[2px] overflow-hidden rounded-full bg-[oklch(1_0_0_/_5%)]">
          <div
            style={{
              width: `${Math.round(Math.min(1, Math.max(0, pct)) * 100)}%`,
              background: hot
                ? "linear-gradient(90deg, var(--color-accent), var(--color-warning))"
                : "linear-gradient(90deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 45%, var(--osai-accent-2)))",
              boxShadow: hot
                ? "0 0 8px color-mix(in srgb, var(--color-warning) 60%, transparent)"
                : "0 0 8px color-mix(in srgb, var(--color-accent) 55%, transparent)",
            }}
            className="relative h-full rounded-full transition-[width] duration-500"
          >
            {live && (
              <span
                aria-hidden
                className="absolute inset-0 animate-[osai-fil-sheen_1.6s_linear_infinite] bg-[linear-gradient(90deg,transparent,oklch(1_0_0_/_0.55),transparent)]"
              />
            )}
          </div>
        </div>
      )}
      {card && (
        <>
          {/* invisible fat hover target — a 2px line is unhoverable */}
          <div aria-label={label} className="absolute inset-x-0 -top-2 h-4" />
          {/* the card opens UPWARD over the transcript — downward it clipped
              against the pane edge with the composer docked at the bottom. */}
          <div className="pointer-events-none absolute bottom-full right-0 z-40 mb-2.5 hidden w-64 flex-col gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-panel)] p-3 text-left shadow-[var(--osai-shadow-pop)] group-hover/fil:flex">
            {card}
          </div>
        </>
      )}
    </div>
  );
}

/** The morphing send orb (decision D's sibling): hollow when there's nothing
 *  to send, lit gradient when ready, breathing stop ring while a run is live. */
export function SendOrb({
  mode,
  disabled,
  title,
  onClick,
}: {
  mode: "idle" | "ready" | "stop";
  disabled?: boolean;
  title?: string;
  onClick: () => void;
}) {
  if (mode === "stop") {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title ?? "stop the run"}
        className="relative grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[color-mix(in_srgb,var(--color-accent)_50%,transparent)] bg-[var(--color-accent-soft)] text-[var(--color-accent)] transition-colors hover:bg-[color-mix(in_srgb,var(--color-accent)_24%,transparent)]"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute -inset-1 rounded-full border border-[color-mix(in_srgb,var(--color-accent)_45%,transparent)] motion-safe:animate-[osai-orb-breathe_1.8s_ease-in-out_infinite]"
        />
        <Square size={11} className="fill-current" />
      </button>
    );
  }
  const ready = mode === "ready" && !disabled;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full transition-all ${
        ready
          ? "press border border-transparent bg-[linear-gradient(135deg,var(--color-accent),color-mix(in_srgb,var(--color-accent)_55%,var(--osai-accent-2)))] text-[var(--color-accent-fg)] shadow-[0_0_18px_-4px_color-mix(in_srgb,var(--color-accent)_70%,transparent)] hover:brightness-110"
          : "border border-[var(--color-border-strong)] bg-[color-mix(in_srgb,var(--color-panel-2)_70%,transparent)] text-[var(--color-faint)]"
      } disabled:cursor-not-allowed`}
    >
      <ArrowUp size={15} strokeWidth={2.4} />
    </button>
  );
}

/** An armed strip — the receipt for anything riding the next send (plan-first,
 *  goal, live run). Sits inside the deck above the input stage. */
export function ArmedStrip({
  icon,
  children,
  onClear,
  clearTitle,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
  onClear?: () => void;
  clearTitle?: string;
}) {
  return (
    <div className="mx-3 mt-2.5 flex items-center gap-2 rounded-[10px] border border-[color-mix(in_srgb,var(--color-accent)_30%,transparent)] bg-[var(--color-accent-soft)] px-2.5 py-1.5 font-sans text-[11.5px] text-[var(--color-text)]">
      <span className="shrink-0 text-[var(--color-accent)]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {onClear && (
        <button
          type="button"
          onClick={onClear}
          title={clearTitle ?? "clear"}
          className="grid h-4 w-4 shrink-0 place-items-center rounded-full text-[var(--color-muted)] transition-colors hover:text-[var(--color-text)]"
        >
          <X size={11} />
        </button>
      )}
    </div>
  );
}
