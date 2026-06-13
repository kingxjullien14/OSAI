/** NumberTicker — adapted from Magic UI (magicui.design/docs/components/number-ticker,
 *  2026-06-14). Changes: it springs to the NEW value on prop change (not a
 *  one-time count-up from zero on mount — that read as "loading" for usage
 *  percentages), `tabular-nums` so the surrounding layout never shifts, and it
 *  jumps instantly under reduce-motion. Used for usage %s, the streak count,
 *  and (later waves) the chat ctx readout + Run Cinema token stat. */
import { useEffect, useState } from "react";

import { useMotionValueEvent, useSpring } from "motion/react";

import { cn } from "./cn";
import { prefersReducedMotion } from "./reducedMotion";

export function NumberTicker({
  value,
  decimals = 0,
  suffix = "",
  className,
}: {
  value: number;
  decimals?: number;
  suffix?: string;
  className?: string;
}) {
  const reduce = prefersReducedMotion();
  // initialized AT `value` → first paint shows the real number, no count-up;
  // only subsequent poll changes animate.
  const spring = useSpring(value, { stiffness: 120, damping: 26, mass: 0.6 });
  const [shown, setShown] = useState(value);

  useEffect(() => {
    if (reduce) {
      spring.jump(value);
      setShown(value);
    } else {
      spring.set(value);
    }
  }, [value, reduce, spring]);

  useMotionValueEvent(spring, "change", (v) => setShown(v));

  const text = decimals > 0 ? shown.toFixed(decimals) : Math.round(shown).toString();
  return (
    <span className={cn("tabular-nums", className)}>
      {text}
      {suffix}
    </span>
  );
}
