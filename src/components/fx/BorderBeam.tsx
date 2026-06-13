/** BorderBeam — adapted from Magic UI (magicui.design/docs/components/border-beam,
 *  2026-06-14). A single accent light travels around the host's border via
 *  `offset-path: rect(... round)`, clipped to a 1px ring by the padding-box/
 *  border-box mask intersect (both standard + -webkit- for WebKit). The host
 *  must be `position: relative` with a border-radius (we use `inherit`). This
 *  is the W5-3 Activity Glow upgrade — it replaces the breathing bottom seam on
 *  a busy pane and rides the Conductor pill. Reduce-motion → a static accent
 *  ring (the "still alive, just calm" fallback the plan calls for). */
import { m } from "motion/react";

import { cn } from "./cn";
import { prefersReducedMotion } from "./reducedMotion";

export function BorderBeam({
  duration = 6,
  size = 64,
  className,
}: {
  /** seconds for one full lap. */
  duration?: number;
  /** length of the light (px). */
  size?: number;
  className?: string;
}) {
  if (prefersReducedMotion()) {
    return (
      <span
        aria-hidden
        className={cn("pointer-events-none absolute inset-0 rounded-[inherit]", className)}
        style={{ boxShadow: "inset 0 0 0 1px color-mix(in srgb, var(--color-accent) 38%, transparent)" }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 rounded-[inherit]", className)}
      style={{
        border: "1px solid transparent",
        // show paint only in the 1px border band (padding-box ∩ border-box).
        maskImage: "linear-gradient(transparent, transparent), linear-gradient(white, white)",
        WebkitMaskImage: "linear-gradient(transparent, transparent), linear-gradient(white, white)",
        maskClip: "padding-box, border-box",
        WebkitMaskClip: "padding-box, border-box",
        maskComposite: "intersect",
        WebkitMaskComposite: "source-in",
      }}
    >
      <m.div
        className="absolute aspect-square"
        style={{
          width: size,
          offsetPath: `rect(0 auto auto 0 round ${size}px)`,
          background:
            "linear-gradient(to left, var(--color-accent), color-mix(in srgb, var(--color-accent) 55%, var(--color-highlight)), transparent)",
        }}
        initial={{ offsetDistance: "0%" }}
        animate={{ offsetDistance: "100%" }}
        transition={{ repeat: Infinity, ease: "linear", duration }}
      />
    </div>
  );
}
