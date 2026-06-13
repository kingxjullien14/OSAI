/** SplitText — adapted from ReactBits (reactbits.dev/text-animations/split-text,
 *  2026-06-14). Per-word spring rise on mount (no blur — that's BlurText's job);
 *  takes ReactNode "words" so a styled node (the gradient accent word) can be a
 *  unit. Entrance only — the caller keys it so it fires once per session, never
 *  on re-render. Reduce-motion → plain render. */
import type { ReactNode } from "react";

import { m } from "motion/react";

import { cn } from "./cn";
import { prefersReducedMotion } from "./reducedMotion";

const NBSP = String.fromCharCode(0xa0);

export function SplitText({
  words,
  className,
  wordClassName,
  startDelay = 0,
  step = 0.06,
}: {
  words: ReactNode[];
  className?: string;
  wordClassName?: string;
  startDelay?: number;
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
          initial={{ opacity: 0, y: "0.5em" }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 24, delay: startDelay + i * step }}
        >
          {w}
          {i < words.length - 1 ? NBSP : ""}
        </m.span>
      ))}
    </span>
  );
}
