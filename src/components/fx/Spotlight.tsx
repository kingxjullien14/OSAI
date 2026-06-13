/** Spotlight — adapted from Aceternity UI (ui.aceternity.com/components/spotlight,
 *  2026-06-14). Changes: the rainbow/white sweep becomes a single low-alpha
 *  accent wash anchored to the top of the hero, it plays ONCE on arrival and
 *  settles (no infinite loop on a large surface — contract rule 5), and it
 *  reads reduce-motion at call time → a static radial. Pairs with the existing
 *  liveness drift blobs (which stay); this is the one-shot "lights up on enter"
 *  beat over them. */
import { m } from "motion/react";

import { cn } from "./cn";
import { prefersReducedMotion } from "./reducedMotion";

const WASH =
  "radial-gradient(60% 50% at 50% 0%, color-mix(in srgb, var(--color-accent) 12%, transparent), transparent 72%)";

export function Spotlight({ className }: { className?: string }) {
  const base = cn("pointer-events-none absolute inset-x-0 top-0 h-[60%]", className);
  if (prefersReducedMotion()) {
    return <div aria-hidden className={base} style={{ background: WASH, opacity: 0.55 }} />;
  }
  return (
    <m.div
      aria-hidden
      className={base}
      style={{ background: WASH }}
      initial={{ opacity: 0, y: "-8%" }}
      animate={{ opacity: [0, 0.85, 0.55], y: 0 }}
      transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1], times: [0, 0.6, 1] }}
    />
  );
}
