/** DotPattern — adapted from Magic UI (magicui.design/docs/components/dot-pattern,
 *  2026-06-14). Changes: dots fill `--color-border` instead of a hardcoded grey,
 *  a radial mask fades the grid into the center so it never competes with the
 *  hero stack, and it's pure SVG (no animation → the master reduce-motion guard
 *  has nothing to govern). Sits behind the idle hero as quiet texture. */
import { useId } from "react";

import { cn } from "./cn";

export function DotPattern({
  className,
  gap = 22,
  radius = 1,
}: {
  className?: string;
  /** spacing between dot centers (px). */
  gap?: number;
  /** dot radius (px). */
  radius?: number;
}) {
  const id = useId();
  return (
    <svg
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 h-full w-full fill-[var(--color-border)]",
        className,
      )}
      style={{
        // mask to the center so the grid dissolves before the edges + never
        // collides with the drift blobs or the command line.
        maskImage: "radial-gradient(ellipse 55% 55% at 50% 45%, black 0%, transparent 75%)",
        WebkitMaskImage: "radial-gradient(ellipse 55% 55% at 50% 45%, black 0%, transparent 75%)",
        opacity: 0.6,
      }}
    >
      <defs>
        <pattern id={id} width={gap} height={gap} patternUnits="userSpaceOnUse">
          <circle cx={gap / 2} cy={gap / 2} r={radius} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
