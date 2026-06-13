/** Magnet — adapted from ReactBits (reactbits.dev/animations/magnet, 2026-06-14).
 *  Pulls its child a few px toward the cursor while hovered (spring x/y), then
 *  releases. Used on the ONE accent send CTA (§6) for a tactile "it wants the
 *  click" feel. Small radius — this is a cockpit, not a toy. Reduce-motion →
 *  an inert inline-flex passthrough. */
import type { ReactNode } from "react";

import { m, useSpring } from "motion/react";

import { cn } from "./cn";
import { prefersReducedMotion } from "./reducedMotion";

export function Magnet({
  children,
  radius = 4,
  className,
}: {
  children: ReactNode;
  /** max travel toward the cursor (px). */
  radius?: number;
  className?: string;
}) {
  const reduce = prefersReducedMotion();
  const x = useSpring(0, { stiffness: 300, damping: 20 });
  const y = useSpring(0, { stiffness: 300, damping: 20 });

  if (reduce) return <span className={cn("inline-flex", className)}>{children}</span>;

  return (
    <m.span
      className={cn("inline-flex", className)}
      style={{ x, y }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
        const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
        x.set(Math.max(-1, Math.min(1, dx)) * radius);
        y.set(Math.max(-1, Math.min(1, dy)) * radius);
      }}
      onMouseLeave={() => {
        x.set(0);
        y.set(0);
      }}
    >
      {children}
    </m.span>
  );
}
