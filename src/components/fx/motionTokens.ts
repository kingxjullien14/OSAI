/** The Wave-5 motion vocabulary — JS choreography on the SAME clock as CSS
 *  (contract rule 6): durations/eases are read off `:root`'s `--osai-dur-*` /
 *  `--osai-ease-*` custom props once and memoized, so Framer Motion springs
 *  and CSS transitions stay in one timing family. Each helper returns the
 *  full `{ initial, animate, exit }` bundle for spreading onto an `m.` element
 *  inside `<AnimatePresence>`, and reads reduce-motion AT CALL TIME (render),
 *  so every open/exit honors the current preference (rule 2).
 *
 *  These exist so overlay/toast/pane exits keep ONE look app-wide — don't
 *  inline ad-hoc variants for those surfaces; add a helper here instead. */
import { prefersReducedMotion } from "./reducedMotion";

type Ease = [number, number, number, number];

interface Clocks {
  durFast: number;
  durBase: number;
  durSlow: number;
  easeOut: Ease;
  easeIn: Ease;
  easeSpring: Ease;
}

/** App.css :root values, duplicated as fallbacks only (tests / first paint). */
const FALLBACK: Clocks = {
  durFast: 0.14,
  durBase: 0.2,
  durSlow: 0.32,
  easeOut: [0.16, 1, 0.3, 1],
  easeIn: [0.4, 0, 1, 1],
  easeSpring: [0.34, 1.56, 0.64, 1],
};

let cache: Clocks | null = null;

function clocks(): Clocks {
  if (cache) return cache;
  if (typeof document === "undefined") return FALLBACK;
  const cs = getComputedStyle(document.documentElement);
  const dur = (prop: string, fb: number): number => {
    const v = cs.getPropertyValue(prop).trim();
    const n = parseFloat(v);
    if (!Number.isFinite(n)) return fb;
    return v.endsWith("ms") ? n / 1000 : n;
  };
  const bez = (prop: string, fb: Ease): Ease => {
    const m = cs.getPropertyValue(prop).match(/cubic-bezier\(([^)]+)\)/);
    if (!m) return fb;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return p.length === 4 && p.every(Number.isFinite) ? (p as Ease) : fb;
  };
  cache = {
    durFast: dur("--osai-dur-fast", FALLBACK.durFast),
    durBase: dur("--osai-dur-base", FALLBACK.durBase),
    durSlow: dur("--osai-dur-slow", FALLBACK.durSlow),
    easeOut: bez("--osai-ease-out", FALLBACK.easeOut),
    easeIn: bez("--osai-ease-in", FALLBACK.easeIn),
    easeSpring: bez("--osai-ease-spring", FALLBACK.easeSpring),
  };
  return cache;
}

/** The default spring for interactive choreography (tuned to FEEL like
 *  --osai-ease-out per the plan) — later waves' dock/magnet/layout work. */
export const SPRING = { type: "spring", stiffness: 380, damping: 32 } as const;

/** Overlay BACKDROP: plain fade in, faster ease-in fade out. Replaces the
 *  retired `.overlay-backdrop` + `[data-closing]` CSS pair. pointer-events
 *  cut the moment the exit starts so a dying scrim can't eat clicks. */
export function overlayFade() {
  const reduce = prefersReducedMotion();
  const c = clocks();
  return {
    initial: { opacity: 0 },
    animate: { opacity: 1, transition: { duration: reduce ? 0 : c.durBase, ease: "easeOut" as const } },
    exit: {
      opacity: 0,
      pointerEvents: "none" as const,
      transition: { duration: reduce ? 0 : c.durFast, ease: c.easeIn },
    },
  };
}

/** Overlay PANEL: the `.modal-in` / `osai-modal-out` gesture (rise + settle,
 *  faster dip-out) as interruption-safe motion props. Reduce-motion keeps a
 *  zero-duration opacity cut only. */
export function modalPop() {
  const reduce = prefersReducedMotion();
  const c = clocks();
  if (reduce) {
    return {
      initial: { opacity: 0 },
      animate: { opacity: 1, transition: { duration: 0 } },
      exit: { opacity: 0, pointerEvents: "none" as const, transition: { duration: 0 } },
    };
  }
  return {
    initial: { opacity: 0, y: 12, scale: 0.98 },
    animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.22, ease: c.easeOut } },
    exit: {
      opacity: 0,
      y: 8,
      scale: 0.98,
      pointerEvents: "none" as const,
      transition: { duration: c.durFast, ease: c.easeIn },
    },
  };
}

/** Toasts/pills anchored on `left-1/2`: x:"-50%" rides EVERY keyframe (the
 *  old `.toast-in/.toast-out` carried it inside the keyframes for the same
 *  reason) — callers must drop their `-translate-x-1/2` class so motion owns
 *  transform alone (contract rule 7). */
export function toastPop() {
  const reduce = prefersReducedMotion();
  const c = clocks();
  if (reduce) {
    return {
      initial: { opacity: 0, x: "-50%" },
      animate: { opacity: 1, x: "-50%", transition: { duration: 0 } },
      exit: { opacity: 0, x: "-50%", pointerEvents: "none" as const, transition: { duration: 0 } },
    };
  }
  return {
    initial: { opacity: 0, x: "-50%", y: 16, scale: 0.96 },
    animate: {
      opacity: 1,
      x: "-50%",
      y: 0,
      scale: 1,
      transition: { duration: c.durBase, ease: c.easeSpring },
    },
    exit: {
      opacity: 0,
      x: "-50%",
      y: 8,
      pointerEvents: "none" as const,
      transition: { duration: c.durFast, ease: c.easeIn },
    },
  };
}

/** Pane close (the old `.pane-exit` beat): shrink away under the grid's CSS
 *  track glide. Exit-only — pane ENTRANCES stay on the CSS `fade-in-up`
 *  (mount-time), so each property keeps a single owner per phase. */
export function paneExit() {
  const reduce = prefersReducedMotion();
  const c = clocks();
  return {
    exit: reduce
      ? { opacity: 0, pointerEvents: "none" as const, transition: { duration: 0 } }
      : {
          opacity: 0,
          scale: 0.96,
          pointerEvents: "none" as const,
          transition: { duration: c.durFast, ease: c.easeIn },
        },
  };
}
