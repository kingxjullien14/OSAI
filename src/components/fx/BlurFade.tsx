/** BlurFade — adapted from Magic UI (magicui.design/docs/components/blur-fade,
 *  2026-06-14). A 10px rise + 4px blur that resolves on mount — the W5-3
 *  replacement for the `.fade-in-up` entrance on settled transcript blocks
 *  (user / approval / result). Streaming surfaces stay unwrapped so token
 *  appends never re-trigger it. Forwards a ref (React-19 ref-as-prop) so the
 *  transcript's block registry + find/minimap geometry keep working. Reduce-
 *  motion → a plain div (no entrance). */
import type { ReactNode, Ref } from "react";

import { m } from "motion/react";

import { prefersReducedMotion } from "./reducedMotion";

export function BlurFade({
  children,
  className,
  ref,
}: {
  children: ReactNode;
  className?: string;
  ref?: Ref<HTMLDivElement>;
}) {
  if (prefersReducedMotion()) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }
  return (
    <m.div
      ref={ref}
      className={className}
      initial={{ opacity: 0, filter: "blur(4px)", y: 10 }}
      animate={{ opacity: 1, filter: "blur(0px)", y: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </m.div>
  );
}
