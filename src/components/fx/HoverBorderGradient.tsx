/** HoverBorderGradient — adapted from Aceternity UI (ui.aceternity.com/components/
 *  hover-border-gradient, 2026-06-14). A 1px conic accent→highlight ring that
 *  rotates while hovered, around the surface's ONE primary CTA (§6 — never a
 *  neutral control). The `p-px` gap + transparent inner is the ring; the wrapped
 *  child keeps its own fill. Reduce-motion → an inert static accent ring. */
import { useState, type ReactNode } from "react";

import { m } from "motion/react";

import { cn } from "./cn";
import { prefersReducedMotion } from "./reducedMotion";

const RING =
  "conic-gradient(from 0deg, var(--color-accent), color-mix(in srgb, var(--color-accent) 50%, var(--color-highlight)), var(--color-accent))";

export function HoverBorderGradient({
  children,
  className,
  radius = "rounded-full",
}: {
  children: ReactNode;
  className?: string;
  /** Tailwind rounding class matched to the wrapped CTA. */
  radius?: string;
}) {
  const [hover, setHover] = useState(false);

  if (prefersReducedMotion()) {
    return (
      <div className={cn("relative inline-flex p-px", radius, className)}>
        <span
          aria-hidden
          className={cn("absolute inset-0", radius)}
          style={{ background: "color-mix(in srgb, var(--color-accent) 45%, transparent)" }}
        />
        <div className={cn("relative", radius)}>{children}</div>
      </div>
    );
  }

  return (
    <div
      className={cn("relative inline-flex p-px", radius, className)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <m.span
        aria-hidden
        className={cn("absolute inset-0", radius)}
        style={{ background: RING }}
        animate={{ rotate: hover ? 360 : 0, opacity: hover ? 1 : 0.4 }}
        transition={{
          rotate: { duration: 3, ease: "linear", repeat: hover ? Infinity : 0 },
          opacity: { duration: 0.3 },
        }}
      />
      <div className={cn("relative", radius)}>{children}</div>
    </div>
  );
}
