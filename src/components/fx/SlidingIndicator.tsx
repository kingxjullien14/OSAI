/** SlidingIndicator — the Aceternity "tabs" gliding highlight (2026-06-14),
 *  implemented WITHOUT `layoutId` (which would force the heavier domMax bundle):
 *  a single absolutely-positioned element animates its `y` + `height` to the
 *  active row's measured offset. The parent measures the active row (offsetTop/
 *  offsetHeight within a `relative` container) and passes it here. More robust
 *  than shared-layout for a dynamic list, and free on the domAnimation bundle.
 *  Render it as the FIRST child of the relative container so it sits behind the
 *  rows. Reduce-motion → it jumps (no slide). */
import { m } from "motion/react";

import { cn } from "./cn";
import { SPRING } from "./motionTokens";
import { prefersReducedMotion } from "./reducedMotion";

export function SlidingIndicator({
  top,
  height,
  className,
}: {
  top: number;
  height: number;
  className?: string;
}) {
  const base = cn("pointer-events-none absolute inset-x-0 top-0", className);
  if (prefersReducedMotion()) {
    return <div aria-hidden className={base} style={{ transform: `translateY(${top}px)`, height }} />;
  }
  return (
    <m.div aria-hidden className={base} initial={false} animate={{ y: top, height }} transition={SPRING} />
  );
}
