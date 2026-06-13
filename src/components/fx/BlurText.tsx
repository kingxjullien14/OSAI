/** BlurText — adapted from ReactBits (reactbits.dev/text-animations/blur-text,
 *  2026-06-14). Changes: takes an array of ReactNode "words" (so a styled node
 *  like the gradient name can be one unit), uses our ease, and renders the
 *  final state directly under reduce-motion (no blur-in). Entrance only, once
 *  per mount — never on re-render. */
import type { ReactNode } from "react";

import { m } from "motion/react";

import { cn } from "./cn";
import { prefersReducedMotion } from "./reducedMotion";

// non-breaking space — keeps inter-word spacing across inline-block boundaries
// (a trailing ASCII space inside an inline-block collapses).
const NBSP = String.fromCharCode(0xa0);

export function BlurText({
  words,
  className,
  wordClassName,
  startDelay = 0,
  step = 0.07,
}: {
  words: ReactNode[];
  className?: string;
  wordClassName?: string;
  /** seconds before the first word resolves. */
  startDelay?: number;
  /** seconds between successive words. */
  step?: number;
}) {
  if (prefersReducedMotion()) {
    return (
      <span className={className}>
        {words.map((w, i) => (
          <span key={i} className={wordClassName}>
            {w}
            {i < words.length - 1 ? NBSP : ""}
          </span>
        ))}
      </span>
    );
  }
  return (
    <span className={className}>
      {words.map((w, i) => (
        <m.span
          key={i}
          className={cn("inline-block", wordClassName)}
          initial={{ opacity: 0, filter: "blur(8px)", y: "0.3em" }}
          animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
          transition={{ duration: 0.5, delay: startDelay + i * step, ease: [0.16, 1, 0.3, 1] }}
        >
          {w}
          {i < words.length - 1 ? NBSP : ""}
        </m.span>
      ))}
    </span>
  );
}
