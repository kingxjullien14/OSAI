/** useRotatingPlaceholder — the placeholder-carousel half of Aceternity's
 *  placeholders-and-vanish-input (ui.aceternity.com/components/placeholders-and-vanish-input,
 *  2026-06-14), extracted so it can drive OUR command-line chrome instead of
 *  Aceternity's input. Cycles through phrases on an interval while `active`
 *  (the line is empty); under reduce-motion it holds the first phrase (no
 *  cycling). The consumer renders the returned phrase as an animated overlay
 *  via AnimatePresence — this hook owns only the index. */
import { useEffect, useState } from "react";

import { prefersReducedMotion } from "./reducedMotion";

export function useRotatingPlaceholder(
  phrases: string[],
  active: boolean,
  intervalMs = 3200,
): { index: number; text: string } {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!active || phrases.length <= 1 || prefersReducedMotion()) return;
    const t = setInterval(() => setIndex((i) => (i + 1) % phrases.length), intervalMs);
    return () => clearInterval(t);
  }, [active, phrases.length, intervalMs]);

  // when the carousel stops (line gets content), snap back to the first phrase
  // so the next empty state starts clean.
  useEffect(() => {
    if (!active) setIndex(0);
  }, [active]);

  return { index, text: phrases[index] ?? phrases[0] ?? "" };
}
