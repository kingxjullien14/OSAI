/** TiltCard — the CardSpotlight + 3D-card pattern (Aceternity, 2026-06-14) at
 *  cockpit intensity: a subtle pointer-driven tilt (±`max`°, default 4 — full
 *  strength is landing-page energy) plus the neutral mouse-follow glare from
 *  `.aios-spotlight` (App.css), driven by the same `--spot-x/y` vars. Reduce-
 *  motion → a plain div (the glare CSS transition is governed by the master
 *  guard regardless). Give it a rounded class so the glare clips to the corners. */
import type { ReactNode } from "react";

import { m, useSpring } from "motion/react";

import { cn } from "./cn";
import { prefersReducedMotion } from "./reducedMotion";

export function TiltCard({
  children,
  className,
  max = 4,
}: {
  children: ReactNode;
  className?: string;
  /** max tilt in degrees on each axis. */
  max?: number;
}) {
  const reduce = prefersReducedMotion();
  const rotateX = useSpring(0, { stiffness: 200, damping: 18 });
  const rotateY = useSpring(0, { stiffness: 200, damping: 18 });

  if (reduce) return <div className={cn("aios-spotlight", className)}>{children}</div>;

  return (
    <m.div
      className={cn("aios-spotlight", className)}
      style={{ rotateX, rotateY, transformPerspective: 600 }}
      onMouseMove={(e) => {
        const el = e.currentTarget;
        const r = el.getBoundingClientRect();
        const px = (e.clientX - r.left) / r.width - 0.5;
        const py = (e.clientY - r.top) / r.height - 0.5;
        rotateY.set(px * max * 2);
        rotateX.set(-py * max * 2);
        el.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
        el.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
      }}
      onMouseLeave={() => {
        rotateX.set(0);
        rotateY.set(0);
      }}
    >
      {children}
    </m.div>
  );
}
